import { get, run } from './db.js';
import { key } from './ingest.js';
import { appApi, SpotifyError } from './spotify.js';

const UA = 'SpotifyTrackerr/1.0 (self-hosted listening stats)';

async function getJson(url: string) {
	const res = await fetch(url, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw Object.assign(new Error(`${url} -> ${res.status}`), { status: res.status });
	return res.json();
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && key(a) === key(b);
// Deezer's "no artist photo" URL has an empty image hash: /images/artist//...
export const realPicture = (url?: string) => (url && !url.includes('/artist//') ? url : null);

// Picks most-played first.
// ponytail: GROUP BY over all plays per pick; add a play-count column if this shows up in profiles.
const nextTrack = (state: number) =>
	get(
		`SELECT t.id, t.name, t.album_id, t.duration_ms, a.id artist_id, a.name artist, a.image artist_image,
		        al.name album, al.image album_image, al.release_year, al.deezer_id
		 FROM tracks t JOIN artists a ON a.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id
		 LEFT JOIN (SELECT track_id, COUNT(*) c FROM plays GROUP BY track_id) p ON p.track_id = t.id
		 WHERE t.enriched = ? ORDER BY p.c DESC NULLS LAST LIMIT 1`,
		state
	);

let deezerPausedUntil = 0;

/** One Deezer search per song gives album cover, single cover, artist photo and length. */
export async function deezerStep() {
	if (Date.now() < deezerPausedUntil) return false;
	const t = nextTrack(0);
	if (!t) return false;
	let res: any;
	try {
		res = await getJson('https://api.deezer.com/search?' + new URLSearchParams({ q: `${t.artist} ${t.name}`, limit: '15' }));
	} catch {
		deezerPausedUntil = Date.now() + 30_000;
		return false;
	}
	if (res.error) {
		// code 4 = quota; back off and retry the same song later
		deezerPausedUntil = Date.now() + (res.error.code === 4 ? 10_000 : 60_000);
		return false;
	}
	const hits: any[] = (res.data ?? []).filter((r: any) => same(r.artist?.name, t.artist));
	const songs = hits.filter((r) => same(r.title, t.name) || same(r.title_short, t.name));
	const onAlbum = songs.find((r) => same(r.album?.title, t.album));
	const single = songs.find((r) => same(r.album?.title, t.name) && !same(r.album?.title, t.album));

	if (!t.artist_image) {
		const pic = realPicture(hits[0]?.artist?.picture_xl);
		if (pic) run('UPDATE artists SET image = ? WHERE id = ?', pic, t.artist_id);
	}
	if (t.album_id && !t.album_image && onAlbum) {
		run('UPDATE albums SET image = ?, deezer_id = ? WHERE id = ?', onAlbum.album.cover_xl, onAlbum.album.id, t.album_id);
		t.album_image = onAlbum.album.cover_xl;
		t.deezer_id = onAlbum.album.id;
	}
	if (t.album_id && !t.album_image) {
		// Song search missed the album; try the album directly.
		const albums = await getJson('https://api.deezer.com/search/album?' + new URLSearchParams({ q: `${t.artist} ${t.album}`, limit: '10' })).catch(() => null);
		const a = albums?.data?.find((r: any) => same(r.title, t.album) && same(r.artist?.name, t.artist));
		if (a) {
			run('UPDATE albums SET image = ?, deezer_id = ? WHERE id = ?', a.cover_xl, a.id, t.album_id);
			t.album_image = a.cover_xl;
			t.deezer_id = a.id;
		}
	}
	if (t.album_id && t.deezer_id && !t.release_year) {
		const al = await getJson(`https://api.deezer.com/album/${t.deezer_id}`).catch(() => null);
		const y = parseInt(al?.release_date ?? '', 10);
		if (y) run('UPDATE albums SET release_year = ? WHERE id = ?', y, t.album_id);
	}
	const match = onAlbum ?? songs[0];
	run(
		'UPDATE tracks SET image = COALESCE(image, ?), duration_ms = COALESCE(duration_ms, ?), enriched = ? WHERE id = ?',
		single?.album?.cover_xl ?? null,
		match ? match.duration * 1000 : null,
		t.album_image || !t.album_id ? 1 : 2,
		t.id
	);
	return true;
}

/** iTunes fallback for songs Deezer couldn't place. Apple allows ~20 requests a minute. */
export async function itunesStep() {
	const t = nextTrack(2);
	if (!t) return false;
	const r = await getJson('https://itunes.apple.com/search?' + new URLSearchParams({ term: `${t.artist} ${t.name}`, entity: 'song', limit: '10' })).catch(() => null);
	if (!r) return false;
	const songs = (r.results ?? []).filter((s: any) => same(s.artistName, t.artist) && same(s.trackName, t.name));
	const hit = songs.find((s: any) => same(s.collectionName, t.album)) ?? songs[0];
	if (hit && t.album_id) {
		run(
			'UPDATE albums SET image = COALESCE(image, ?), release_year = COALESCE(release_year, ?) WHERE id = ?',
			hit.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
			parseInt(hit.releaseDate ?? '', 10) || null,
			t.album_id
		);
	}
	run('UPDATE tracks SET enriched = 1 WHERE id = ?', t.id);
	return true;
}

// Last.fm tags that describe the listener, not the music.
const JUNK_TAGS = new Set([
	'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'my favorite', 'love', 'loved', 'awesome', 'beautiful',
	'albums i own', 'under 2000 listeners', 'spotify', 'all', 'good', 'amazing', 'best', 'cool', 'fav', 'favs', 'male vocalists',
	'female vocalists', 'male vocalist', 'female vocalist', 'american', 'british', 'usa', 'uk', 'canadian', 'australian'
]);

let spotifyGenresPausedUntil = 0;

/** Genres for the most-played artist that has none yet: Spotify first, then Last.fm tags. */
export async function genreStep() {
	const a = get(
		`SELECT a.id, a.name, a.spotify_id FROM artists a
		 LEFT JOIN (SELECT artist_id, COUNT(*) c FROM plays GROUP BY artist_id) p ON p.artist_id = a.id
		 WHERE a.genres_done = 0 ORDER BY p.c DESC NULLS LAST LIMIT 1`
	);
	if (!a) return false;
	let genres: string[] = [];
	if (a.spotify_id && Date.now() > spotifyGenresPausedUntil) {
		try {
			const r = await appApi(`/artists/${a.spotify_id}`);
			genres = r?.genres ?? [];
		} catch (e) {
			if (e instanceof SpotifyError && e.status === 429) spotifyGenresPausedUntil = Date.now() + 3600_000;
		}
	}
	if (!genres.length && process.env.LASTFM_API_KEY) {
		const r = await lastfm({ method: 'artist.gettoptags', artist: a.name, autocorrect: '1' }).catch(() => null);
		if (!r) return false; // network trouble: retry later
		genres = (r.toptags?.tag ?? [])
			.filter((t: any) => t.count >= 10)
			.map((t: any) => String(t.name).toLowerCase().trim())
			.filter((g: string) => g && !JUNK_TAGS.has(g) && key(g) !== key(a.name))
			.slice(0, 5);
	}
	for (const g of genres.slice(0, 5)) run('INSERT OR IGNORE INTO artist_genres (artist_id, genre) VALUES (?, ?)', a.id, g.toLowerCase());
	run('UPDATE artists SET genres_done = 1 WHERE id = ?', a.id);
	return true;
}

export async function lastfm(params: Record<string, string>) {
	const r = await getJson('https://ws.audioscrobbler.com/2.0/?' + new URLSearchParams({ ...params, api_key: process.env.LASTFM_API_KEY ?? '', format: 'json' }));
	if (r.error) throw new Error(r.message);
	return r;
}
