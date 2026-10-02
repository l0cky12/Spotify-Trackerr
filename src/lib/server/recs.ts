import { get, all, cached, run } from './db.js';
import { key } from './ingest.js';
import { lastfm } from './enrich.js';

export const lastfmEnabled = () => !!process.env.LASTFM_API_KEY;
/** The user's own ListenBrainz token from Settings, else the server-wide one from .env. */
export const listenbrainzToken = (user: App.Locals['user']): string | undefined => user?.listenbrainz_token || process.env.LISTENBRAINZ_TOKEN || undefined;

/** Asks ListenBrainz whether a token is real. Returns its username, or null if the token is invalid. */
export async function checkListenbrainzToken(token: string): Promise<string | null> {
	const res = await fetch('https://api.listenbrainz.org/1/validate-token', { headers: { Authorization: `Token ${token}`, 'User-Agent': 'SpotifyTrackerr/1.0' } });
	if (!res.ok) throw new Error(`ListenBrainz didn't answer (${res.status}). Try again later.`);
	const j = await res.json();
	return j.valid ? String(j.user_name ?? '') : null;
}

export type Rec = { title?: string; artist: string; trackId?: number | null; artistId?: number | null; spotifyId?: string | null };

/** Links a recommendation to our own pages when the song or artist is already in the library. */
function localize(r: Rec): Rec {
	const a = get('SELECT id FROM artists WHERE key = ?', key(r.artist));
	if (!a) return r;
	const t = r.title ? get('SELECT id, spotify_id FROM tracks WHERE artist_id = ? AND key = ?', a.id, key(r.title)) : null;
	return { ...r, artistId: a.id, trackId: t?.id ?? null, spotifyId: t?.spotify_id ?? null };
}

const WEEK = 7 * 86400;

export async function similarTracks(artist: string, title: string): Promise<Rec[]> {
	if (!lastfmEnabled()) return [];
	const list = await cached(`lfm:track:${key(artist)}:${key(title)}`, WEEK, async () => {
		const r = await lastfm({ method: 'track.getsimilar', artist, track: title, autocorrect: '1', limit: '15' });
		return (r.similartracks?.track ?? []).filter((t: any) => Number(t.match) >= 0.05).map((t: any) => ({ title: t.name, artist: t.artist?.name }));
	}).catch(() => []);
	return list.map(localize);
}

export async function similarArtists(artist: string): Promise<Rec[]> {
	if (!lastfmEnabled()) return [];
	const list = await cached(`lfm:artist:${key(artist)}`, WEEK, async () => {
		const r = await lastfm({ method: 'artist.getsimilar', artist, autocorrect: '1', limit: '12' });
		return (r.similarartists?.artist ?? []).map((a: any) => ({ artist: a.name }));
	}).catch(() => []);
	return list.map(localize);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ~30 songs the user hasn't played, from ListenBrainz Radio seeded with their top artists of the last 30 days.
 * One radio request per artist (1/s) so one unknown artist name doesn't sink the whole prompt.
 */
export async function buildDiscover(userId: number, token: string) {
	const since = Math.floor(Date.now() / 1000) - 30 * 86400;
	let seeds = all(
		'SELECT a.name FROM plays p JOIN artists a ON a.id = p.artist_id WHERE p.user_id = ? AND p.played_at >= ? GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 5',
		userId,
		since
	);
	if (!seeds.length) seeds = all('SELECT a.name FROM plays p JOIN artists a ON a.id = p.artist_id WHERE p.user_id = ? GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 5', userId);
	const heard = new Set(
		all('SELECT DISTINCT a.key ak, t.key tk FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ?', userId).map(
			(r) => r.ak + '\0' + r.tk
		)
	);
	const perSeed: Rec[][] = [];
	for (const s of seeds) {
		const name = String(s.name).replace(/[()]/g, '');
		const res = await fetch(
			'https://api.listenbrainz.org/1/explore/lb-radio?' + new URLSearchParams({ prompt: `artist:(${name})`, mode: 'easy' }),
			{ headers: { Authorization: `Token ${token}`, 'User-Agent': 'SpotifyTrackerr/1.0' } }
		).catch(() => null);
		const json = res?.ok ? await res.json().catch(() => null) : null;
		const tracks: any[] = json?.payload?.jspf?.playlist?.track ?? [];
		perSeed.push(
			tracks
				.map((t) => ({ title: String(t.title ?? ''), artist: String(t.creator ?? '') }))
				.filter((t) => t.title && t.artist && !heard.has(key(t.artist) + '\0' + key(t.title)))
		);
		await sleep(1100);
	}
	// Interleave seeds so one artist's radio doesn't fill the list.
	const out: Rec[] = [];
	const seen = new Set<string>();
	for (let i = 0; out.length < 30 && perSeed.some((l) => l[i]); i++) {
		for (const l of perSeed) {
			const t = l[i];
			if (!t) continue;
			const k = key(t.artist) + '\0' + key(t.title!);
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(localize(t));
			if (out.length >= 30) break;
		}
	}
	const value = { seeds: seeds.map((s) => s.name as string), songs: out, at: Math.floor(Date.now() / 1000) };
	run(
		'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
		`discover:${userId}`,
		JSON.stringify(value),
		value.at
	);
	return value;
}

export function savedDiscover(userId: number) {
	const r = get('SELECT value FROM cache WHERE key = ?', `discover:${userId}`);
	return r ? (JSON.parse(r.value) as Awaited<ReturnType<typeof buildDiscover>>) : null;
}

export const spotifySearchUrl = (r: Rec) =>
	r.spotifyId ? `https://open.spotify.com/track/${r.spotifyId}` : `https://open.spotify.com/search/${encodeURIComponent(`${r.artist} ${r.title ?? ''}`.trim())}`;
