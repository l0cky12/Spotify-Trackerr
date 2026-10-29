import { all, get, run, now, type Row } from './db.js';
import { api } from './spotify.js';
import { SpotifyError } from './connections.js';
import { top, firstHeard, onThisDay, periodOf, type Scope, type TopRow } from './stats.js';
import { fromLocal } from '../time.js';

// Playlist templates: saved recipes that turn a person's own play history into a Spotify playlist.
// Three kinds, each with a small `params` object stored as JSON on the template row.

export type TemplateKind = 'top' | 'artist_first' | 'on_this_day';
export type TemplateParams = {
	/** top: the songs played most in a calendar month ('YYYY-MM'), year ('YYYY') or all time ('all'). */
	period?: string;
	n?: number;
	/** artist_first: every song by the artist that was first heard in `year`. */
	artistId?: number;
	year?: number;
};
export type Template = { id: number; user_id: number; name: string; kind: TemplateKind; params: TemplateParams; created_at: number; last_playlist_url: string | null };

export const KINDS: { id: TemplateKind; label: string; blurb: string }[] = [
	{ id: 'top', label: 'Top songs of a period', blurb: 'The songs you played most in a month, a year, or ever.' },
	{ id: 'artist_first', label: 'An artist, as you discovered them', blurb: 'Every song by one artist that you first heard in a given year.' },
	{ id: 'on_this_day', label: 'On this day across the years', blurb: "What you were playing on today's date in each earlier year." }
];

export function templatesOf(userId: number): Template[] {
	return all('SELECT * FROM playlist_templates WHERE user_id = ? ORDER BY created_at', userId).map((r) => ({ ...r, params: JSON.parse(r.params) }));
}

export function templateOf(userId: number, id: number): Template | null {
	const r = get('SELECT * FROM playlist_templates WHERE id = ? AND user_id = ?', id, userId);
	return r ? { ...r, params: JSON.parse(r.params) } : null;
}

/** Checks a template's fields; returns the clean version or a message for the person. */
export function cleanTemplate(input: { name: string; kind: string; params: TemplateParams }): { ok: Template['params'] & { name: string; kind: TemplateKind } } | { error: string } {
	const name = input.name.trim().slice(0, 80);
	if (!name) return { error: 'Give the template a name.' };
	const kind = input.kind as TemplateKind;
	if (!KINDS.some((k) => k.id === kind)) return { error: 'Pick a template type.' };
	const n = Math.min(500, Math.max(1, Math.trunc(Number(input.params.n) || 50)));
	if (kind === 'top') {
		const period = String(input.params.period ?? 'all');
		if (period !== 'all' && !/^\d{4}(-\d{2})?$/.test(period)) return { error: 'Pick a month, a year, or all time.' };
		return { ok: { name, kind, period, n } };
	}
	if (kind === 'artist_first') {
		const artistId = Math.trunc(Number(input.params.artistId));
		const year = Math.trunc(Number(input.params.year));
		if (!artistId || !get('SELECT 1 FROM artists WHERE id = ?', artistId)) return { error: 'Pick an artist.' };
		if (!(year >= 1970 && year <= 2100)) return { error: 'Pick a year.' };
		return { ok: { name, kind, artistId, year, n } };
	}
	return { ok: { name, kind, n } };
}

export function saveTemplate(userId: number, id: number | null, t: { name: string; kind: TemplateKind } & TemplateParams) {
	const { name, kind, ...params } = t;
	if (id) run('UPDATE playlist_templates SET name = ?, kind = ?, params = ? WHERE id = ? AND user_id = ?', name, kind, JSON.stringify(params), id, userId);
	else run('INSERT INTO playlist_templates (user_id, name, kind, params, created_at) VALUES (?, ?, ?, ?, ?)', userId, name, kind, JSON.stringify(params), now());
}

export function deleteTemplate(userId: number, id: number) {
	run('DELETE FROM playlist_templates WHERE id = ? AND user_id = ?', id, userId);
}

export type Pick = { id: number; name: string; artist: string | null; image: string | null; plays: number; spotify_id: string | null; note?: string };

/** The songs a template picks right now, in playlist order, from this person's own plays. */
export function resolveTemplate(user: Row, t: { kind: TemplateKind } & TemplateParams): { title: string; description: string; picks: Pick[] } {
	const tz = user.timezone as string;
	const ids = [user.id as number];
	const nowTs = Math.floor(Date.now() / 1000);
	const n = t.n ?? 50;
	const withIds = (rows: TopRow[]) => {
		if (!rows.length) return [];
		const sp = new Map(all(`SELECT id, spotify_id FROM tracks WHERE id IN (${rows.map((r) => Math.trunc(r.id)).join(',')})`).map((r) => [r.id, r.spotify_id]));
		return rows.map((r) => ({ id: r.id, name: r.name, artist: r.artist, image: r.image, plays: r.plays, spotify_id: (sp.get(r.id) as string | null) ?? null }));
	};
	if (t.kind === 'top') {
		const period = t.period === 'all' || !t.period ? null : periodOf(tz, t.period);
		const scope: Scope = { ids, since: period?.since ?? 0, until: period?.until ?? nowTs + 1, rankBy: user.rank_by, tz };
		const label = period?.label ?? 'all time';
		return { title: `Top ${n} songs of ${label}`, description: `My ${n} most played songs of ${label}, from Spotify Trackerr.`, picks: withIds(top('track', scope, n)) };
	}
	if (t.kind === 'artist_first') {
		const artist = get('SELECT name FROM artists WHERE id = ?', t.artistId)?.name ?? 'an artist';
		const scope: Scope = { ids, since: fromLocal(tz, t.year!, 0, 1), until: fromLocal(tz, t.year! + 1, 0, 1), rankBy: user.rank_by, tz };
		const rows = firstHeard(scope, n, 0, 'AND p.artist_id = ?', t.artistId).reverse();
		return { title: `${artist}: first heard in ${t.year}`, description: `Songs by ${artist} I first played in ${t.year}, from Spotify Trackerr.`, picks: rows.map((r) => ({ ...r, spotify_id: r.spotify_id })) };
	}
	const seen = new Set<number>();
	const picks: Pick[] = [];
	for (const b of onThisDay(ids, tz, nowTs, Math.max(5, Math.ceil(n / 5)), user.rank_by))
		for (const r of withIds(b.tracks)) {
			if (seen.has(r.id) || picks.length >= n) continue;
			seen.add(r.id);
			picks.push({ ...r, note: `${b.year}${b.week ? ', that week' : ''}` });
		}
	const today = new Date().toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' });
	return { title: `On this day: ${today}`, description: `What I was playing on ${today} in earlier years, from Spotify Trackerr.`, picks };
}

/** Creates a private playlist on the person's Spotify account and fills it. Returns its Spotify page. */
export async function createSpotifyPlaylist(user: Row, title: string, description: string, spotifyIds: string[]) {
	if (!user.spotify_id || !user.spotify_refresh) throw new SpotifyError(401, 'Link Spotify in Settings first.');
	if (!spotifyIds.length) throw new Error("None of these songs have a Spotify id yet, so there's nothing to add.");
	let made;
	try {
		made = await api(user, `/users/${encodeURIComponent(user.spotify_id)}/playlists`, { name: title.slice(0, 100), description: description.slice(0, 300), public: false });
	} catch (e) {
		if (e instanceof SpotifyError && e.status === 403)
			throw new SpotifyError(403, 'Spotify needs permission to create playlists on your account. Reconnect Spotify in Settings, then try again.');
		throw e;
	}
	if (!made?.id) throw new Error("Spotify didn't return the new playlist.");
	for (let i = 0; i < spotifyIds.length; i += 100) await api(user, `/playlists/${made.id}/tracks`, { uris: spotifyIds.slice(i, i + 100).map((id) => `spotify:track:${id}`) });
	return (made.external_urls?.spotify as string | undefined) ?? `https://open.spotify.com/playlist/${made.id}`;
}
