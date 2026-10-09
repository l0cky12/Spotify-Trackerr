import { createHash } from 'node:crypto';
import { get, all, cached, run, now, tx, type Row } from './db.js';
import { key } from './ingest.js';
import { lastfm, realPicture, getJson, same, UA } from './enrich.js';

const validName = (s: unknown): s is string => typeof s === 'string' && !!s.trim();

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
	if (!validName(r.session?.name)) throw new Error('Last.fm returned an invalid username.');
	return r.session.name as string;
}

export function setLastfmUser(userId: number, username: string | null) {
	tx(() => {
		run('UPDATE users SET lastfm_user = ? WHERE id = ?', username, userId);
		run('DELETE FROM cache WHERE key = ?', `discover:${userId}`);
	});
}

/** ListenBrainz accounts are MusicBrainz accounts, so signing in goes through a MusicBrainz OAuth app. */
export const listenbrainzLoginEnabled = () => !!process.env.MUSICBRAINZ_CLIENT_ID && !!process.env.MUSICBRAINZ_CLIENT_SECRET;

export const listenbrainzAuthUrl = (redirect_uri: string, state: string) =>
	'https://musicbrainz.org/oauth2/authorize?' +
	new URLSearchParams({ response_type: 'code', client_id: process.env.MUSICBRAINZ_CLIENT_ID!, redirect_uri, scope: 'profile', state, access_type: 'online' });

/** Trades the code from MusicBrainz's sign-in redirect for the username, and checks it has a ListenBrainz account. */
export async function listenbrainzUsername(code: string, redirect_uri: string) {
	const mb = async (path: string, init: RequestInit) => {
		const res = await fetch('https://musicbrainz.org/oauth2/' + path, { ...init, headers: { 'User-Agent': UA, ...init.headers }, signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
		return res.json();
	};
	const t = await mb('token', {
		method: 'POST',
		body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri, client_id: process.env.MUSICBRAINZ_CLIENT_ID!, client_secret: process.env.MUSICBRAINZ_CLIENT_SECRET! })
	});
	const me = await mb('userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
	if (!validName(me.sub)) throw new Error('MusicBrainz returned an invalid username.');
	// 404 here means the MusicBrainz account has never opened ListenBrainz.
	await getJson(`https://api.listenbrainz.org/1/user/${encodeURIComponent(me.sub)}/listen-count`);
	return me.sub as string;
}

export function setListenbrainzUser(userId: number, username: string | null) {
	tx(() => {
		run('UPDATE users SET listenbrainz_user = ? WHERE id = ?', username, userId);
		run('DELETE FROM cache WHERE key = ?', `discover:${userId}`);
	});
}

/** ListenBrainz stats for the last month; empty when it hasn't computed them yet (204). */
async function listenbrainzTop(user: string, kind: 'artists' | 'recordings') {
	const r = await getJson(`https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(user)}/${kind}?` + new URLSearchParams({ range: 'month', count: '5' })).catch(() => null);
	return Array.isArray(r?.payload?.[kind]) ? (r.payload[kind] as any[]) : [];
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
		return { ...r, artistId: a.id, trackId: t?.id ?? null, spotifyId: t?.spotify_id ?? null, image: t?.image ?? r.image ?? null };
	}
	if (r.album) {
		const al = get('SELECT id, COALESCE(image_override, image) image FROM albums WHERE artist_id = ? AND key = ?', a.id, key(r.album));
		return { ...r, artistId: a.id, albumId: al?.id ?? null, image: al?.image ?? r.image ?? null };
	}
	return { ...r, artistId: a.id, image: a.image ?? r.image ?? null };
}

const WEEK = 7 * 86400;

export async function similarTracks(artist: string, title: string): Promise<Rec[]> {
	if (!lastfmEnabled()) return [];
	const list = await cached(`lfm:track:${key(artist)}:${key(title)}`, WEEK, async () => {
		const r = await lastfm({ method: 'track.getsimilar', artist, track: title, autocorrect: '1', limit: '15' });
		return (r.similartracks?.track ?? []).filter((t: any) => Number(t.match) >= 0.05).map((t: any) => ({ title: t.name, artist: t.artist?.name }));
	}).catch(() => []);
	return list.filter((r: Rec) => validName(r.artist) && validName(r.title)).map(localize);
}

export async function similarArtists(artist: string): Promise<Rec[]> {
	if (!lastfmEnabled()) return [];
	const list = await cached(`lfm:artist:${key(artist)}`, WEEK, async () => {
		const r = await lastfm({ method: 'artist.getsimilar', artist, autocorrect: '1', limit: '12' });
		return (r.similarartists?.artist ?? []).map((a: any) => ({ artist: a.name }));
	}).catch(() => []);
	return list.filter((r: Rec) => validName(r.artist)).map(localize);
}


// Last.fm's grey star, served when it has no real picture.
const LASTFM_BLANK = '2a96cbd8b46e442fc41c2b86b821562f';

async function topAlbum(artist: string): Promise<Rec | null> {
	const a = await cached(`lfm:topalbum:${key(artist)}`, WEEK, async () => {
		const r = await lastfm({ method: 'artist.gettopalbums', artist, autocorrect: '1', limit: '1' });
		const al = r.topalbums?.album?.[0];
		if (!validName(al?.name) || al.name === '(null)') return null;
		const img: string = al.image?.find((i: any) => i.size === 'extralarge')?.['#text'] ?? '';
		return { artist: validName(al.artist?.name) ? al.artist.name : artist, album: al.name as string, image: typeof img === 'string' && img && !img.includes(LASTFM_BLANK) ? img : null };
	}).catch(() => null);
	return a && localize(a);
}

/** Cover art from Deezer for picks Last.fm and our library have no picture for. */
async function deezerImage(r: Rec): Promise<string | null> {
	const [path, q] = r.title ? ['search', `${r.artist} ${r.title}`] : r.album ? ['search/album', `${r.artist} ${r.album}`] : ['search/artist', r.artist];
	return cached(`deezer:cover:${JSON.stringify([path, key(r.artist), key(r.title ?? r.album ?? '')])}`, WEEK, async () => {
		const res = await getJson(`https://api.deezer.com/${path}?` + new URLSearchParams({ q, limit: '15' }));
		const x = res.data?.find((x: any) => r.title
			? same(x.artist?.name, r.artist) && (same(x.title, r.title) || same(x.title_short, r.title))
			: r.album ? same(x.artist?.name, r.artist) && same(x.title, r.album) : same(x.name, r.artist));
		return (r.title ? x?.album?.cover_big : r.album ? x?.cover_big : realPicture(x?.picture_big)) ?? null;
	}).catch(() => null);
}

/** Check only the candidate picks against Last.fm's lifetime user counts, rather than downloading history. */
async function unheard(list: Rec[], username: string | null): Promise<Rec[]> {
	if (!username) return list;
	const out: Rec[] = [];
	for (const r of list) {
		const kind = r.title ? 'track' : r.album ? 'album' : 'artist';
		let info;
		try {
			info = await lastfm({ method: `${kind}.getInfo`, artist: r.artist, username, autocorrect: '1', ...(r.title ? { track: r.title } : r.album ? { album: r.album } : {}) });
		} catch (e) {
			if ((e as { code?: number }).code === 6) continue; // Unknown candidate: don't recommend unverified music.
			throw new Error('Could not check your Last.fm listening history. Try again later.');
		}
		const count = kind === 'artist' ? info.artist?.stats?.userplaycount : info[kind]?.userplaycount;
		const plays = typeof count === 'string' && /^\d+$/.test(count) ? Number(count) : typeof count === 'number' ? count : NaN;
		if (!Number.isSafeInteger(plays) || plays < 0)
			throw new Error('Last.fm did not return a listening count. Try again later.');
		if (plays === 0) out.push(r);
	}
	return out;
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
 * else their ListenBrainz ones when they've signed in there, otherwise what they played most here.
 */
export async function buildDiscover(user: Row) {
	let seedArtists: string[] = [];
	let seedSongs: { artist: string; title: string }[] = [];
	if (user.lastfm_user) {
		const q = { user: user.lastfm_user, period: '1month', limit: '5' };
		const [a, t] = await Promise.all([
			lastfm({ method: 'user.gettopartists', ...q }),
			lastfm({ method: 'user.gettoptracks', ...q })
		]);
		seedArtists = (Array.isArray(a?.topartists?.artist) ? a.topartists.artist : []).filter((x: any) => validName(x?.name)).map((x: any) => x.name);
		seedSongs = (Array.isArray(t?.toptracks?.track) ? t.toptracks.track : []).filter((x: any) => validName(x?.name) && validName(x?.artist?.name)).map((x: any) => ({ artist: x.artist.name, title: x.name }));
	}
	if (!seedArtists.length && user.listenbrainz_user) {
		const [a, t] = await Promise.all([listenbrainzTop(user.listenbrainz_user, 'artists'), listenbrainzTop(user.listenbrainz_user, 'recordings')]);
		seedArtists = a.filter((x) => validName(x?.artist_name)).map((x) => x.artist_name);
		if (!seedSongs.length) seedSongs = t.filter((x) => validName(x?.recording_name) && validName(x?.artist_credit_name)).map((x) => ({ artist: x.artist_credit_name, title: x.recording_name }));
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
		[...seedSongs.map(songKey), ...all('SELECT DISTINCT a.key ak, t.key tk FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ?', user.id).map(
			(r) => r.ak + '\0' + r.tk
		)]
	);

	const artists = await unheard(interleave(
		await Promise.all(seedArtists.map(async (s) => (await similarArtists(s)).filter((r) => !heardArtists.has(key(r.artist))).map((r) => ({ ...r, why: s })))),
		(r) => key(r.artist),
		12
	), user.lastfm_user ?? null);
	const songs = await unheard(interleave(
		await Promise.all(seedSongs.map(async (s) => (await similarTracks(s.artist, s.title)).filter((r) => !heardSongs.has(songKey(r))).map((r) => ({ ...r, why: s.title })))),
		songKey,
		30
	), user.lastfm_user ?? null);
	const albums: Rec[] = [];
	for (const a of artists) {
		const al = await topAlbum(a.artist);
		if (al && (!al.albumId || !get('SELECT 1 FROM plays WHERE user_id = ? AND album_id = ? LIMIT 1', user.id, al.albumId))) albums.push({ ...al, why: a.why });
	}
	const newAlbums = await unheard(albums, user.lastfm_user ?? null);
	for (const r of [...artists, ...newAlbums, ...songs]) if (!r.image) r.image = await deezerImage(r);

	const value = {
		seeds: seedArtists,
		lastfmUser: user.lastfm_user ?? null,
		listenbrainzUser: user.listenbrainz_user ?? null,
		fromLastfm: !!user.lastfm_user,
		artists,
		albums: newAlbums,
		songs,
		at: now()
	};
	if (!artists.length && !songs.length) return value;
	run(
		'INSERT INTO cache (key, value, fetched_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND lastfm_user IS ? AND listenbrainz_user IS ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
		`discover:${user.id}`,
		JSON.stringify(value),
		value.at,
		user.id,
		value.lastfmUser,
		value.listenbrainzUser
	);
	return value;
}

export function savedDiscover(userId: number) {
	const r = get('SELECT value FROM cache WHERE key = ?', `discover:${userId}`);
	const v = r ? (JSON.parse(r.value) as Awaited<ReturnType<typeof buildDiscover>>) : null;
	// Picks saved before Discover had shelves were a single song list.
	const u = get('SELECT lastfm_user, listenbrainz_user FROM users WHERE id = ?', userId);
	return v?.artists && v.lastfmUser === (u?.lastfm_user ?? null) && (v.listenbrainzUser ?? null) === (u?.listenbrainz_user ?? null) ? v : null;
}

export const spotifySearchUrl = (r: Rec) =>
	r.spotifyId
		? `https://open.spotify.com/track/${r.spotifyId}`
		: `https://open.spotify.com/search/${encodeURIComponent(`${r.artist} ${r.title ?? r.album ?? ''}`.trim())}`;
