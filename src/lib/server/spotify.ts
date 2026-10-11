import { get, type Row } from './db.js';
import { spotifyToken, spotifyAppToken, activeSpotifyLinks, activeSpotifyLink, recordSync, SpotifyError } from './connections.js';
import { upsertArtist, upsertAlbum, upsertTrack, insertPlay, key } from './ingest.js';

/** Calls the Web API as `user`. */
export async function api(user: Row, path: string, init: RequestInit = {}): Promise<any> {
	const token = await spotifyToken(user);
	const res = await fetch(`https://api.spotify.com/v1${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }
	});
	if (res.status === 204) return null;
	if (!res.ok) throw new SpotifyError(res.status, `Spotify ${path} returned ${res.status}`, Number(res.headers.get('retry-after') ?? 0));
	return res.json();
}

/** Calls the Web API with the server app's own credentials (no user). */
export async function appApi(path: string) {
	const token = await spotifyAppToken();
	if (!token) return null;
	const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new SpotifyError(res.status, `Spotify ${path} returned ${res.status}`, Number(res.headers.get('retry-after') ?? 0));
	return res.json();
}

let pausedUntil = 0;

/** Pulls the latest 50 plays for every linked user. Duplicates are dropped by insertPlay. */
export async function syncAll() {
	if (Date.now() < pausedUntil) return;
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
			if (e instanceof SpotifyError && e.status === 429) {
				pausedUntil = Date.now() + Math.max(e.retryAfter, 60) * 1000;
				return;
			}
			recordSync(user.id, e);
		}
	}
}

const nowPlayingCache = new Map<number, { at: number; value: unknown }>();
/** Currently playing track for a user, cached 25 s so several viewers share one request. */
export async function nowPlaying(userId: number) {
	const hit = nowPlayingCache.get(userId);
	if (hit && Date.now() - hit.at < 25_000) return hit.value;
	const user = activeSpotifyLink(userId);
	let value = null;
	if (user && Date.now() >= pausedUntil) {
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
