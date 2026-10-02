import { createHash } from 'node:crypto';
import { get, all, cached, run, now, type Row } from './db.js';
import { key } from './ingest.js';
import { lastfm, realPicture } from './enrich.js';

export const lastfmEnabled = () => !!process.env.LASTFM_API_KEY;
/** Signing in with Last.fm also needs the shared secret from the same Last.fm app page. */
export const lastfmLoginEnabled = () => lastfmEnabled() && !!process.env.LASTFM_SHARED_SECRET;

/** Last.fm's api_sig: md5 of every param as name+value, sorted by name, then the shared secret. */
export const lastfmSig = (params: Record<string, string>, secret: string) =>
	createHash('md5')
		.update(Object.keys(params).sort().map((k) => k + params[k]).join('') + secret)
		.digest('hex');

export const lastfmAuthUrl = (cb: string) => 'https://www.last.fm/api/auth/?' + new URLSearchParams({ api_key: process.env.LASTFM_API_KEY!, cb });

/** Trades the token from Last.fm's sign-in redirect for the Last.fm username it belongs to. */
export async function lastfmUsername(token: string) {
	const p = { method: 'auth.getSession', api_key: process.env.LASTFM_API_KEY!, token };
	const r = await lastfm({ ...p, api_sig: lastfmSig(p, process.env.LASTFM_SHARED_SECRET!) });
	return String(r.session.name);
}

export type Rec = {
	artist: string;
	title?: string;
	album?: string;
	image?: string | null;
	/** The seed artist or song this pick came from. */
	why?: string;
	trackId?: number | null;
	albumId?: number | null;
	artistId?: number | null;
	spotifyId?: string | null;
};

/** Links a recommendation to our own pages, and borrows our artwork, when the song, album or artist is already in the library. */
function localize(r: Rec): Rec {
	const a = get('SELECT id, COALESCE(image_override, image) image FROM artists WHERE key = ?', key(r.artist));
	if (!a) return r;
	if (r.title) {
		const t = get(
			'SELECT t.id, t.spotify_id, COALESCE(t.image_override, t.image, al.image_override, al.image) image FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.artist_id = ? AND t.key = ?',
			a.id,
			key(r.title)
		);
		return { ...r, artistId: a.id, trackId: t?.id ?? null, spotifyId: t?.spotify_id ?? null, image: r.image ?? t?.image ?? null };
	}
	if (r.album) {
		const al = get('SELECT id, COALESCE(image_override, image) image FROM albums WHERE artist_id = ? AND key = ?', a.id, key(r.album));
		return { ...r, artistId: a.id, albumId: al?.id ?? null, image: r.image ?? al?.image ?? null };
	}
	return { ...r, artistId: a.id, image: r.image ?? a.image ?? null };
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


// Last.fm's grey star, served when it has no real picture.
const LASTFM_BLANK = '2a96cbd8b46e442fc41c2b86b821562f';

async function topAlbum(artist: string): Promise<Rec | null> {
	const a = await cached(`lfm:topalbum:${key(artist)}`, WEEK, async () => {
		const r = await lastfm({ method: 'artist.gettopalbums', artist, autocorrect: '1', limit: '1' });
		const al = r.topalbums?.album?.[0];
		if (!al?.name || al.name === '(null)') return null;
		const img: string = al.image?.find((i: any) => i.size === 'extralarge')?.['#text'] ?? '';
		return { artist: al.artist?.name ?? artist, album: al.name as string, image: img && !img.includes(LASTFM_BLANK) ? img : null };
	}).catch(() => null);
	return a && localize(a);
}

/** Cover art from Deezer for picks Last.fm and our library have no picture for. */
async function deezerImage(r: Rec): Promise<string | null> {
	const [path, q] = r.title ? ['search', `${r.artist} ${r.title}`] : r.album ? ['search/album', `${r.artist} ${r.album}`] : ['search/artist', r.artist];
	const res = await fetch(`https://api.deezer.com/${path}?` + new URLSearchParams({ q, limit: '1' })).catch(() => null);
	const x = res?.ok ? (await res.json().catch(() => null))?.data?.[0] : null;
	return (r.title ? x?.album?.cover_big : r.album ? x?.cover_big : realPicture(x?.picture_big)) ?? null;
}

/** Round-robin across the seeds' lists so one seed doesn't fill the shelf; drops repeats. */
export function interleave<T>(lists: T[][], id: (x: T) => string, max: number): T[] {
	const out: T[] = [];
	const seen = new Set<string>();
	for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
		for (const l of lists) {
			const x = l[i];
			if (!x || seen.has(id(x))) continue;
			seen.add(id(x));
			out.push(x);
			if (out.length >= max) break;
		}
	}
	return out;
}

/** The user's top 5 for the last 30 days, or all time if they played nothing lately. */
function topLocal(sql: string, userId: number) {
	const rows = all(sql, userId, now() - 30 * 86400);
	return rows.length ? rows : all(sql, userId, 0);
}

/**
 * Artists, albums and songs the user hasn't played, from Last.fm's similar artists and songs.
 * Seeds are their Last.fm top artists and songs of the last month when they've signed in to Last.fm,
 * otherwise what they played most here.
 */
export async function buildDiscover(user: Row) {
	let seedArtists: string[] = [];
	let seedSongs: { artist: string; title: string }[] = [];
	if (user.lastfm_user) {
		const q = { user: user.lastfm_user, period: '1month', limit: '5' };
		const [a, t] = await Promise.all([
			lastfm({ method: 'user.gettopartists', ...q }).catch(() => null),
			lastfm({ method: 'user.gettoptracks', ...q }).catch(() => null)
		]);
		seedArtists = (a?.topartists?.artist ?? []).map((x: any) => String(x.name));
		seedSongs = (t?.toptracks?.track ?? []).map((x: any) => ({ artist: String(x.artist?.name ?? ''), title: String(x.name) }));
	}
	if (!seedArtists.length)
		seedArtists = topLocal(
			'SELECT a.name FROM plays p JOIN artists a ON a.id = p.artist_id WHERE p.user_id = ? AND p.played_at >= ? GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 5',
			user.id
		).map((r) => r.name as string);
	if (!seedSongs.length)
		seedSongs = topLocal(
			'SELECT a.name artist, t.name title FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ? AND p.played_at >= ? GROUP BY t.id ORDER BY COUNT(*) DESC LIMIT 5',
			user.id
		) as { artist: string; title: string }[];

	const heardArtists = new Set([...seedArtists.map(key), ...all('SELECT DISTINCT a.key FROM plays p JOIN artists a ON a.id = p.artist_id WHERE p.user_id = ?', user.id).map((r) => r.key as string)]);
	const songKey = (r: { artist: string; title?: string }) => key(r.artist) + '\0' + key(r.title ?? '');
	const heardSongs = new Set(
		all('SELECT DISTINCT a.key ak, t.key tk FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ?', user.id).map(
			(r) => r.ak + '\0' + r.tk
		)
	);

	const artists = interleave(
		await Promise.all(seedArtists.map(async (s) => (await similarArtists(s)).filter((r) => !heardArtists.has(key(r.artist))).map((r) => ({ ...r, why: s })))),
		(r) => key(r.artist),
		12
	);
	const songs = interleave(
		await Promise.all(seedSongs.map(async (s) => (await similarTracks(s.artist, s.title)).filter((r) => !heardSongs.has(songKey(r))).map((r) => ({ ...r, why: s.title })))),
		songKey,
		30
	);
	const albums: Rec[] = [];
	for (const a of artists) {
		const al = await topAlbum(a.artist);
		if (al) albums.push({ ...al, why: a.why });
	}
	// ponytail: one Deezer search per missing picture, one at a time to stay under Deezer's 50 per 5 s.
	for (const r of [...artists, ...albums, ...songs]) if (!r.image) r.image = await deezerImage(r);

	const value = { seeds: seedArtists, fromLastfm: !!user.lastfm_user, artists, albums, songs, at: now() };
	run(
		'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
		`discover:${user.id}`,
		JSON.stringify(value),
		value.at
	);
	return value;
}

export function savedDiscover(userId: number) {
	const r = get('SELECT value FROM cache WHERE key = ?', `discover:${userId}`);
	const v = r ? (JSON.parse(r.value) as Awaited<ReturnType<typeof buildDiscover>>) : null;
	// Picks saved before Discover had shelves were a single song list.
	return v?.artists ? v : null;
}

export const spotifySearchUrl = (r: Rec) =>
	r.spotifyId
		? `https://open.spotify.com/track/${r.spotifyId}`
		: `https://open.spotify.com/search/${encodeURIComponent(`${r.artist} ${r.title ?? r.album ?? ''}`.trim())}`;
