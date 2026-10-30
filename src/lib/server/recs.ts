import { get, all, cached, run, now, type Row } from './db.js';
import { lastfmApp } from './connections.js';
import { key } from './ingest.js';
import { lastfm, realPicture, getJson, same } from './enrich.js';
import { bannedKeys, notBanned } from './bans.js';

const validName = (s: unknown): s is string => typeof s === 'string' && !!s.trim();

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
	/** The seed song's artist, when `why` is a song. */
	whyBy?: string;
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

export async function similarTracks(artist: string, title: string, limit = 15): Promise<Rec[]> {
	if (!lastfmApp()) return [];
	const list = await cached(`lfm:track:${limit}:${key(artist)}:${key(title)}`, WEEK, async () => {
		const r = await lastfm({ method: 'track.getsimilar', artist, track: title, autocorrect: '1', limit: String(limit) });
		return (r.similartracks?.track ?? []).filter((t: any) => Number(t.match) >= 0.05).map((t: any) => ({ title: t.name, artist: t.artist?.name }));
	}).catch(() => []);
	return list.filter((r: Rec) => validName(r.artist) && validName(r.title)).map(localize);
}

export async function similarArtists(artist: string, limit = 12): Promise<Rec[]> {
	if (!lastfmApp()) return [];
	const list = await cached(`lfm:artist:${limit}:${key(artist)}`, WEEK, async () => {
		const r = await lastfm({ method: 'artist.getsimilar', artist, autocorrect: '1', limit: String(limit) });
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

const AI_LIST = 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json';

/** Artists Soul Over AI lists as making AI music, fetched daily; the last good copy when GitHub can't be reached. */
async function aiArtists(): Promise<Set<string>> {
	const names: string[] = await cached('ai:artists', 86400, async () => {
		const list = await getJson(AI_LIST);
		if (!Array.isArray(list)) throw new Error('Soul Over AI did not return a list.');
		return list.filter((a: any) => !a?.removed && validName(a?.name)).map((a: any) => loose(a.name));
	}).catch(() => JSON.parse(get('SELECT value FROM cache WHERE key = ?', 'ai:artists')?.value ?? '[]'));
	return new Set(names);
}

// A remembered "not played yet" is asked again after this long, and sooner if the scrobbles since name its artist.
const HEARD_TTL = 7 * 86400;
// Scrobbles can arrive late (offline phones), so the scrobbles checked reach back this far before the last check.
const SCROBBLE_SLACK = 86400;
const RECENT_PAGES = 10;

const heardKey = (r: Rec) => [r.title ? 'track' : r.album ? 'album' : 'artist', key(r.artist), key(r.title ?? r.album ?? '')].join('\0');

/** Every artist (and collaboration member) the user scrobbled since `from`, or null when Last.fm can't say or there are too many. */
async function scrobbledArtists(username: string, from: number): Promise<Set<string> | null> {
	const artists = new Set<string>();
	for (let page = 1; page <= RECENT_PAGES; page++) {
		const r = await lastfm({ method: 'user.getrecenttracks', user: username, from: String(from), limit: '200', page: String(page) }).catch(() => null);
		if (!r?.recenttracks) return null;
		const tracks = r.recenttracks.track;
		for (const t of Array.isArray(tracks) ? tracks : tracks ? [tracks] : []) {
			const name = t?.artist?.['#text'] ?? t?.artist?.name;
			if (validName(name)) for (const m of members(name)) artists.add(loose(m));
		}
		if (page >= Number(r.recenttracks['@attr']?.totalPages ?? 1)) return artists;
	}
	return null;
}

/**
 * What Last.fm said about each candidate on earlier refreshes: played, which never changes, or not played yet as of
 * a time, kept for a week unless a scrobble since names that artist. So a refresh asks Last.fm about new candidates
 * and the few the user may have just played, not all of them again.
 */
async function rememberedPlays(username: string) {
	const store = `lfm:heard:${key(username)}`;
	const saved = get('SELECT value FROM cache WHERE key = ?', store);
	// true: played. A number: when Last.fm last said not played.
	const old = saved ? (JSON.parse(saved.value) as { at: number; plays: Record<string, true | number> }) : null;
	const at = now();
	const recent = old && at - old.at < HEARD_TTL ? await scrobbledArtists(username, old.at - SCROBBLE_SLACK) : null;
	const trusted = (k: string, v: true | number) =>
		v === true || (!!recent && at - v < HEARD_TTL && !members(k.split('\0')[1]).some((m) => recent.has(loose(m))));
	const plays = new Map(Object.entries(old?.plays ?? {}).filter(([k, v]) => trusted(k, v)));
	const used = new Map<string, true | number>();
	return {
		username,
		/** true played, false not played yet, undefined when Last.fm needs asking. */
		get: (r: Rec) => {
			const k = heardKey(r);
			const v = used.get(k) ?? plays.get(k);
			if (v === undefined) return undefined;
			used.set(k, v);
			return v === true;
		},
		set: (r: Rec, played: boolean) => void used.set(heardKey(r), played || at),
		/** Keeps just this refresh's answers, so the store stays the size of one set of picks. */
		save: () => run(
			'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
			store,
			JSON.stringify({ at, plays: Object.fromEntries(used) }),
			at
		)
	};
}
type Plays = Awaited<ReturnType<typeof rememberedPlays>>;

/**
 * Check only the candidate picks against Last.fm's lifetime user counts, rather than downloading history.
 * All at once: getJson's Last.fm queue paces the requests. `found` hears about each pick as soon as it's kept.
 */
async function unheard(list: Rec[], memory: Plays | null, found: (r: Rec) => void): Promise<Rec[]> {
	if (!memory) {
		list.forEach(found);
		return list;
	}
	const isNew = async (r: Rec) => {
		const known = memory.get(r);
		if (known !== undefined) return !known;
		// No plays of the artist means no plays of any of their songs or albums.
		if ((r.title || r.album) && memory.get({ artist: r.artist }) === false) return true;
		const kind = r.title ? 'track' : r.album ? 'album' : 'artist';
		let info;
		try {
			info = await lastfm({ method: `${kind}.getInfo`, artist: r.artist, username: memory.username, autocorrect: '1', ...(r.title ? { track: r.title } : r.album ? { album: r.album } : {}) });
		} catch (e) {
			if ((e as { code?: number }).code === 6) return false; // Unknown candidate: don't recommend unverified music.
			throw new Error('Could not check your Last.fm listening history. Try again later.');
		}
		const count = kind === 'artist' ? info.artist?.stats?.userplaycount : info[kind]?.userplaycount;
		const plays = typeof count === 'string' && /^\d+$/.test(count) ? Number(count) : typeof count === 'number' ? count : NaN;
		if (!Number.isSafeInteger(plays) || plays < 0)
			throw new Error('Last.fm did not return a listening count. Try again later.');
		memory.set(r, plays > 0);
		return plays === 0;
	};
	const keep = await Promise.all(list.map(async (r) => (await isNew(r)) && (found(r), true)));
	return list.filter((_, i) => keep[i]);
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

/** Looser than key(): ignores punctuation and spacing, so Last.fm's "breakkaway" matches Spotify's "breakk.away". */
export const loose = (s: string) => key(s).replace(/[^\p{L}\p{N}]/gu, '') || key(s);
/** A song title without its "(feat. …)", "[Live]" or " - Recorded at …" tail, so another version of a song you played counts as played. */
export const bareTitle = (s: string) =>
	loose(key(s).replace(/\s*[([][^)\]]*[)\]]/gu, '').replace(/\s+[-–]\s+.*$/u, '').replace(/\s+remix$/u, '')) || loose(s);
/** A Last.fm collaboration name and its members: "Bad Omens, Poppy" → itself, "Bad Omens", "Poppy". */
export const members = (s: string) => [...new Set([s, ...s.split(/\s*(?:,|&|\+|\s(?:x|feat\.?|ft\.?)\s)\s*/iu).filter((x) => x.trim())])];

// Last.fm's similar lists per seed, and the most picks a shelf keeps once heard music is dropped.
const PER_SEED = 50;
const MAX_PICKS = 50;

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
	const aiList = aiArtists();
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
	// Banned artists and songs never seed picks, wherever the seeds came from.
	const banned = bannedKeys(user.id);
	seedArtists = seedArtists.filter((a) => !banned.artist(a));
	seedSongs = seedSongs.filter((s) => !banned.song(s.artist, s.title));
	if (!seedArtists.length)
		seedArtists = topLocal(
			`SELECT a.name FROM plays p JOIN artists a ON a.id = p.artist_id WHERE p.user_id = ? AND p.played_at >= ?${notBanned([user.id])} GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 5`,
			user.id
		).map((r) => r.name as string);
	if (!seedSongs.length)
		seedSongs = topLocal(
			`SELECT a.name artist, t.name title FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ? AND p.played_at >= ?${notBanned([user.id])} GROUP BY t.id ORDER BY COUNT(*) DESC LIMIT 5`,
			user.id
		) as { artist: string; title: string }[];

	// Everyone credited on a song counts as heard, featured artists included; so does a song under any of its artists.
	const credited = all(
		`SELECT a.key artist, t.key title FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id WHERE p.user_id = ? GROUP BY t.id
		 UNION SELECT f.name, t.key FROM plays p JOIN tracks t ON t.id = p.track_id JOIN track_features f ON f.track_id = t.id WHERE p.user_id = ? GROUP BY t.id, f.name`,
		user.id,
		user.id
	) as { artist: string; title: string }[];
	const heardArtists = new Set([...seedArtists, ...credited.map((r) => r.artist)].map(loose));
	const isHeardArtist = (name: string) => members(name).some((m) => heardArtists.has(loose(m)));
	const songKey = (r: { artist: string; title?: string }) => loose(r.artist) + '\0' + bareTitle(r.title ?? '');
	const heardSongs = new Set([...seedSongs, ...credited].map(songKey));
	// ponytail: matched by name, so a real artist sharing an AI artist's name is left out too; match Spotify IDs if that bites.
	const ai = await aiList;
	const isAi = (name: string) => members(name).some((m) => ai.has(loose(m)));

	const memory = user.lastfm_user ? await rememberedPlays(user.lastfm_user) : null;
	// Each pick's cover loads as soon as the pick is kept, while Last.fm checks the rest.
	// One cover first: if Deezer is down that pauses it, and the rest skip instead of queueing behind the pause.
	let probe: Promise<void> | null = null;
	const covers: Promise<void>[] = [];
	const cover = async (r: Rec) => void (r.image = await deezerImage(r));
	const found = (r: Rec) => void (r.image || covers.push(probe ? probe.then(() => cover(r)) : (probe = cover(r))));

	// Artists first: songs and albums by an artist Last.fm says the user never played need no check of their own.
	const artists = await unheard(interleave(
		await Promise.all(seedArtists.map(async (s) => (await similarArtists(s, PER_SEED)).filter((r) => !isHeardArtist(r.artist) && !isAi(r.artist)).map((r) => ({ ...r, why: s })))),
		(r) => loose(r.artist),
		MAX_PICKS
	), memory, found);
	const [songs, newAlbums] = await Promise.all([
		unheard(interleave(
			await Promise.all(seedSongs.map(async (s) => (await similarTracks(s.artist, s.title, PER_SEED)).filter((r) => !heardSongs.has(songKey(r)) && !isAi(r.artist)).map((r) => ({ ...r, why: s.title, whyBy: s.artist })))),
			songKey,
			MAX_PICKS
		), memory, found),
		// Each new artist's best-known album, checked on its own: Last.fm may file it under another spelling of the artist.
		Promise.all(artists.map(async (a) => {
			const al = await topAlbum(a.artist);
			if (!al || isAi(al.artist) || (al.albumId && get('SELECT 1 FROM plays WHERE user_id = ? AND album_id = ? LIMIT 1', user.id, al.albumId))) return [];
			return unheard([{ ...al, why: a.why }], memory, found);
		})).then((albums) => albums.flat())
	]);
	memory?.save();
	await Promise.all(covers);

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
