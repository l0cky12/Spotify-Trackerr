import { get, type Row } from './db.js';
import { spotifyAppId, spotifyToken, spotifyAppToken, activeSpotifyLinks, activeSpotifyLink, recordSync, SpotifyError } from './connections.js';
import { upsertArtist, upsertAlbum, upsertTrack, insertPlay, setFeatures, key } from './ingest.js';

const pausedUntil = new Map<string, number>();

/**
 * One Web API call through `appId`. A 429, from the API or from the token refresh before it, pauses every call
 * through that app (sync, now playing, genres) until Spotify says.
 */
async function call(appId: string, path: string, token: () => Promise<string | null>, body?: unknown) {
	if (Date.now() < (pausedUntil.get(appId) ?? 0)) throw new SpotifyError(429, 'Spotify asked us to slow down.');
	try {
		const t = await token();
		if (!t) return null;
		const res = await fetch(`https://api.spotify.com/v1${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: { Authorization: `Bearer ${t}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(10_000)
		});
		if (res.status === 204) return null;
		if (res.ok) return res.json();
		throw new SpotifyError(res.status, `Spotify ${path} returned ${res.status}`, Number(res.headers.get('retry-after') ?? 0));
	} catch (e) {
		if (e instanceof SpotifyError && e.kind === 'rateLimited') pausedUntil.set(appId, Date.now() + Math.max(e.retryAfter, 60) * 1000);
		throw e;
	}
}

/** Calls the Web API as `user`; with `body` it's a POST. */
export const api = (user: Row, path: string, body?: unknown): Promise<any> => call(spotifyAppId(user), path, () => spotifyToken(user), body);
/** Calls the Web API with the server app's own credentials (no user); null when the server has no Spotify app. */
export const appApi = (path: string): Promise<any> => call(spotifyAppId(null), path, spotifyAppToken);

/** Pulls the latest 50 plays for every linked user. Duplicates are dropped by insertPlay. */
export async function syncAll() {
	for (const user of activeSpotifyLinks()) {
		try {
			const data = await api(user, '/me/player/recently-played?limit=50');
			let added = 0;
			for (const item of data?.items ?? []) {
				const t = item.track;
				if (!t || t.type !== 'track' || !t.artists?.length) continue;
				const artistId = upsertArtist(t.artists[0].name, t.artists[0].id);
				const year = parseInt(t.album?.release_date ?? '', 10) || undefined;
				const albumId = t.album?.name ? upsertAlbum(artistId, t.album.name, { image: t.album.images?.[0]?.url, year }) : null;
				const track = upsertTrack(artistId, albumId, t.name, t.id, t.duration_ms);
				setFeatures(track.id, t.artists.slice(1).map((a: any) => a?.name).filter((n: unknown) => typeof n === 'string' && n.trim()));
				const ok = insertPlay({
					userId: user.id,
					trackId: track.id,
					albumId,
					artistId,
					playedAt: Math.floor(Date.parse(item.played_at) / 1000),
					// ponytail: recently-played has no ms_played, so a synced play counts as the full song
					msPlayed: t.duration_ms ?? 0,
					source: 'sync',
					durationMs: t.duration_ms ?? null
				});
				if (ok) added++;
			}
			recordSync(user.id);
			if (added) console.log(`sync: user ${user.id} +${added}`);
		} catch (e) {
			// Rate limits pause that app's calls (see call); the person isn't at fault, so it's not a sync error.
			if (e instanceof SpotifyError && e.kind === 'rateLimited') continue;
			recordSync(user.id, e);
		}
	}
}

/**
 * Looks up the featured artists of one song that has none recorded yet (imported history only names the main artist),
 * so Discover counts them as heard. Spotify dropped its batch track lookup in February 2026, hence one song per call.
 */
export async function creditStep() {
	const t = get('SELECT id, spotify_id FROM tracks WHERE credits_done = 0 AND spotify_id IS NOT NULL LIMIT 1');
	const user = t && activeSpotifyLinks()[0];
	if (!user) return false;
	let r;
	try {
		r = await api(user, `/tracks/${encodeURIComponent(t.spotify_id)}`);
	} catch (e) {
		// A song Spotify no longer has can't be looked up; anything else (rate limit, network) is retried later.
		if (e instanceof SpotifyError && (e.status === 400 || e.status === 404)) setFeatures(t.id, []);
		return false;
	}
	if (!Array.isArray(r?.artists)) return false;
	setFeatures(t.id, r.artists.slice(1).map((a: any) => a?.name).filter((n: unknown) => typeof n === 'string' && n.trim()));
	return true;
}

const nowPlayingCache = new Map<number, { at: number; value: unknown }>();
/** Currently playing track for a user, cached 25 s so several viewers share one request. */
export async function nowPlaying(userId: number) {
	const hit = nowPlayingCache.get(userId);
	if (hit && Date.now() - hit.at < 25_000) return hit.value;
	const user = activeSpotifyLink(userId);
	let value = null;
	if (user) {
		try {
			const d = await api(user, '/me/player/currently-playing');
			const t = d?.item;
			if (t && t.type === 'track') {
				const artist = t.artists?.[0]?.name ?? '';
				const local = get(
					'SELECT t.id FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.spotify_id = ? OR (a.key = ? AND t.key = ?)',
					t.id,
					key(artist),
					key(t.name)
				);
				value = {
					playing: !!d.is_playing,
					name: t.name,
					artist,
					image: t.album?.images?.at(-2)?.url ?? t.album?.images?.[0]?.url ?? null,
					progress: d.progress_ms ?? 0,
					duration: t.duration_ms ?? 0,
					trackId: local?.id ?? null,
					url: t.external_urls?.spotify ?? null
				};
			}
		} catch {
			value = null;
		}
	}
	nowPlayingCache.set(userId, { at: Date.now(), value });
	return value;
}
