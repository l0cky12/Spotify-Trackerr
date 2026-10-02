import { get, all, run, now, type Row } from './db.js';
import { upsertArtist, upsertAlbum, upsertTrack, insertPlay, key } from './ingest.js';

export const SCOPES = 'user-read-recently-played user-read-currently-playing playlist-modify-private';
/** Spotify ends a link 6 months after the user authorizes; refreshing doesn't reset it. */
export const LINK_LIFETIME = 182 * 86400;

const serverApp = () =>
	process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
		? { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET }
		: null;
export const serverAppConfigured = () => !!serverApp();

/** The Spotify app a user links through: their own if they set one up, otherwise the server's. */
export function appFor(user: Row | null, ownWanted = true) {
	if (ownWanted && user?.own_client_id && user?.own_client_secret) return { id: user.own_client_id as string, secret: user.own_client_secret as string, own: true };
	const s = serverApp();
	return s ? { ...s, own: false } : null;
}

export class SpotifyError extends Error {
	constructor(
		public status: number,
		message: string,
		public retryAfter = 0
	) {
		super(message);
	}
}

async function tokenRequest(app: { id: string; secret: string }, body: Record<string, string>) {
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${app.id}:${app.secret}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(body)
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new SpotifyError(res.status, json.error ?? `token request failed (${res.status})`);
	return json as { access_token: string; refresh_token?: string; expires_in: number };
}

export function authorizeUrl(app: { id: string }, redirectUri: string, state: string) {
	return (
		'https://accounts.spotify.com/authorize?' +
		new URLSearchParams({ client_id: app.id, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, state, show_dialog: 'true' })
	);
}

export async function exchangeCode(app: { id: string; secret: string }, code: string, redirectUri: string) {
	const t = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
	const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${t.access_token}` } });
	if (me.status === 403)
		throw new SpotifyError(403, "This Spotify account isn't on the app's allowed-users list. Ask the admin to add it in the Spotify developer dashboard, or set up your own Spotify app in Settings.");
	if (!me.ok) throw new SpotifyError(me.status, `Spotify returned ${me.status} when reading your profile.`);
	const profile = (await me.json()) as { id: string; display_name?: string };
	return { tokens: t, profile };
}

export function saveLink(userId: number, spotifyId: string, t: { access_token: string; refresh_token?: string; expires_in: number }, own: boolean) {
	run(
		`UPDATE users SET spotify_id = ?, spotify_access = ?, spotify_refresh = ?, spotify_expires = ?, spotify_authorized_at = ?,
		 spotify_own_app = ?, sync_error = NULL WHERE id = ?`,
		spotifyId,
		t.access_token,
		t.refresh_token ?? null,
		now() + t.expires_in - 60,
		now(),
		own ? 1 : 0,
		userId
	);
}

export function unlink(userId: number) {
	run(
		`UPDATE users SET spotify_id = NULL, spotify_access = NULL, spotify_refresh = NULL, spotify_expires = NULL,
		 spotify_authorized_at = NULL, sync_error = NULL WHERE id = ?`,
		userId
	);
}

async function accessToken(user: Row) {
	if (user.spotify_access && user.spotify_expires > now()) return user.spotify_access as string;
	const app = appFor(user, !!user.spotify_own_app);
	if (!app || !user.spotify_refresh) throw new SpotifyError(401, 'Spotify is not linked.');
	try {
		const t = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: user.spotify_refresh });
		run(
			'UPDATE users SET spotify_access = ?, spotify_refresh = COALESCE(?, spotify_refresh), spotify_expires = ? WHERE id = ?',
			t.access_token,
			t.refresh_token ?? null,
			now() + t.expires_in - 60,
			user.id
		);
		user.spotify_access = t.access_token;
		user.spotify_expires = now() + t.expires_in - 60;
		return t.access_token;
	} catch (e) {
		if (e instanceof SpotifyError && e.message === 'invalid_grant') run("UPDATE users SET sync_error = 'reauth' WHERE id = ?", user.id);
		throw e;
	}
}

/** Calls the Web API as `user`. */
export async function api(user: Row, path: string, init: RequestInit = {}): Promise<any> {
	const token = await accessToken(user);
	const res = await fetch(`https://api.spotify.com/v1${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }
	});
	if (res.status === 204) return null;
	if (!res.ok) throw new SpotifyError(res.status, `Spotify ${path} returned ${res.status}`, Number(res.headers.get('retry-after') ?? 0));
	return res.json();
}

let appToken: { token: string; expires: number } | null = null;
/** Calls the Web API with the server app's own credentials (no user). */
export async function appApi(path: string) {
	const app = serverApp();
	if (!app) return null;
	if (!appToken || appToken.expires < now()) {
		const t = await tokenRequest(app, { grant_type: 'client_credentials' });
		appToken = { token: t.access_token, expires: now() + t.expires_in - 60 };
	}
	const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${appToken.token}` } });
	if (!res.ok) throw new SpotifyError(res.status, `Spotify ${path} returned ${res.status}`, Number(res.headers.get('retry-after') ?? 0));
	return res.json();
}

let pausedUntil = 0;

/** Pulls the latest 50 plays for every linked user. Duplicates are dropped by insertPlay. */
export async function syncAll() {
	if (Date.now() < pausedUntil) return;
	for (const user of all("SELECT * FROM users WHERE spotify_refresh IS NOT NULL AND (sync_error IS NULL OR sync_error != 'reauth')")) {
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
			run('UPDATE users SET last_sync_at = ?, sync_error = NULL WHERE id = ?', now(), user.id);
			if (added) console.log(`sync: user ${user.id} +${added}`);
		} catch (e) {
			if (e instanceof SpotifyError && e.status === 429) {
				pausedUntil = Date.now() + Math.max(e.retryAfter, 60) * 1000;
				return;
			}
			const msg = e instanceof SpotifyError && e.message === 'invalid_grant' ? 'reauth' : String((e as Error).message);
			run('UPDATE users SET sync_error = ? WHERE id = ?', msg, user.id);
		}
	}
}

const nowPlayingCache = new Map<number, { at: number; value: unknown }>();
/** Currently playing track for a user, cached 25 s so several viewers share one request. */
export async function nowPlaying(userId: number) {
	const hit = nowPlayingCache.get(userId);
	if (hit && Date.now() - hit.at < 25_000) return hit.value;
	const user = get("SELECT * FROM users WHERE id = ? AND spotify_refresh IS NOT NULL AND (sync_error IS NULL OR sync_error != 'reauth')", userId);
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

/** Creates a private playlist on the user's Spotify account; looks up each song's Spotify ID if we don't have one. */
export async function savePlaylist(user: Row, name: string, songs: { artist: string; title: string; spotifyId?: string | null }[]) {
	const uris: string[] = [];
	for (const s of songs) {
		let id = s.spotifyId;
		if (!id) {
			const q = encodeURIComponent(`track:${s.title} artist:${s.artist}`);
			const r = await api(user, `/search?type=track&limit=1&q=${q}`).catch(() => null);
			id = r?.tracks?.items?.[0]?.id;
		}
		if (id) uris.push(`spotify:track:${id}`);
	}
	if (!uris.length) throw new Error('None of these songs could be found on Spotify.');
	const pl = await api(user, '/me/playlists', {
		method: 'POST',
		body: JSON.stringify({ name, public: false, description: 'Made by Spotify Trackerr' })
	});
	await api(user, `/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(0, 100) }) });
	return { url: pl.external_urls?.spotify as string, count: uris.length };
}
