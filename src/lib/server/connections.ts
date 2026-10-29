import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR, userColumns, all, get, run, now, tx, setting, setSetting, type Row } from './db.js';
import { lastfm, getJson, UA } from './enrich.js';

// A person's Connections: their Spotify link (tokens, which app it went through, sync state) and their Last.fm and ListenBrainz usernames,
// plus the server's own Spotify and Last.fm apps. Nothing outside this file reads those columns or knows they're encrypted.

const SCOPES = 'user-read-recently-played user-read-currently-playing';
/** Spotify ends a link 6 months after the user authorizes; refreshing doesn't reset it. */
const LINK_LIFETIME = 182 * 86400;
/** Stored in sync_error when the link can't be used any more and the person has to link again. */
const RECONNECT = 'reauth';
/** SQL for "this user has Spotify linked", for lists of users. */
export const LINKED_SQL = 'spotify_refresh IS NOT NULL';
const ACTIVE_SQL = `${LINKED_SQL} AND (sync_error IS NULL OR sync_error != '${RECONNECT}')`;

// Secrets are encrypted with a key kept in its own file, so a copy of the database alone can't reveal them.
const keyFile = join(DATA_DIR, 'secret.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
const secretKey = readFileSync(keyFile);

function seal(text: string) {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', secretKey, iv);
	const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
	return 'enc:' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
/** Null when missing, unsealed, tampered with, or sealed with a different key file. */
function unseal(value: string | null | undefined) {
	if (!value?.startsWith('enc:')) return null;
	const b = Buffer.from(value.slice(4), 'base64');
	try {
		const d = createDecipheriv('aes-256-gcm', secretKey, b.subarray(0, 12));
		d.setAuthTag(b.subarray(12, 28));
		return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
	} catch {
		return null;
	}
}

if (userColumns.includes('spotify_refresh') && userColumns.includes('own_client_secret')) {
	// Secrets saved before encryption existed. Old copies can linger in free pages, so the files then get rewritten;
	// that's retried every start until it works, since a full disk or another reader can stop it.
	tx(() => {
		for (const col of ['own_client_secret', 'spotify_access', 'spotify_refresh'])
			for (const u of all(`SELECT id, ${col} v FROM users WHERE ${col} NOT LIKE 'enc:%'`)) {
				run(`UPDATE users SET ${col} = ? WHERE id = ?`, seal(u.v), u.id);
				setSetting('scrub_pending', '1');
			}
	});
	if (setting('scrub_pending'))
		try {
			db.exec('VACUUM');
			if ((db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }).busy) throw new Error('another process has the database open');
			run("DELETE FROM settings WHERE key = 'scrub_pending'");
		} catch (e) {
			console.warn(`connections: couldn't rewrite the database to remove old plain-text tokens (${(e as Error).message}); will retry on next start.`);
		}
	// Secrets the current key can't open (secret.key was lost or replaced): drop them so nothing falls back to another app.
	let lost = 0;
	for (const u of all('SELECT id, own_client_secret, spotify_refresh, spotify_own_app FROM users WHERE own_client_secret IS NOT NULL OR spotify_refresh IS NOT NULL')) {
		const ownLost = !!u.own_client_secret && !unseal(u.own_client_secret);
		const linkLost = !!u.spotify_refresh && (!unseal(u.spotify_refresh) || (ownLost && u.spotify_own_app));
		if (ownLost) run('UPDATE users SET own_client_id = NULL, own_client_secret = NULL WHERE id = ?', u.id);
		if (linkLost) needsReconnect(u.id);
		if (ownLost || linkLost) lost++;
	}
	if (lost) console.warn(`connections: ${lost} user(s) have saved Spotify credentials that ${keyFile} can't decrypt; they'll need to reconnect.`);
}

/** Drops the Spotify tokens but keeps spotify_id, so "Log in with Spotify" still finds the account. */
function needsReconnect(userId: number) {
	run(
		`UPDATE users SET spotify_access = NULL, spotify_refresh = NULL, spotify_expires = NULL, spotify_authorized_at = NULL, sync_error = '${RECONNECT}' WHERE id = ?`,
		userId
	);
}

// ---- Spotify apps ----

type App = { id: string; secret: string; own: boolean };

const serverApp = (): App | null =>
	process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET ? { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET, own: false } : null;
export const spotifyServerAppConfigured = () => !!serverApp();

function ownApp(user: Row | null): App | null {
	const secret = user?.own_client_id ? unseal(user.own_client_secret) : null;
	return secret ? { id: user.own_client_id, secret, own: true } : null;
}

/** Saves (or with null, removes) the person's own Spotify app. A link made through the old app has to be redone. */
export function setOwnApp(userId: number, app: { id: string; secret: string } | null) {
	tx(() => {
		const u = get('SELECT own_client_id, spotify_own_app, spotify_refresh FROM users WHERE id = ?', userId);
		run('UPDATE users SET own_client_id = ?, own_client_secret = ? WHERE id = ?', app?.id ?? null, app ? seal(app.secret) : null, userId);
		if (u?.spotify_own_app && u.spotify_refresh && u.own_client_id !== app?.id) needsReconnect(userId);
	});
}

// ---- Spotify sign-in and tokens ----

/** rateLimited: wait and retry. needsReconnect: the link is dead until the person signs in again. */
export class SpotifyError extends Error {
	constructor(
		public status: number,
		message: string,
		public retryAfter = 0,
		public kind: 'rateLimited' | 'needsReconnect' | 'failed' = status === 429 ? 'rateLimited' : message === 'invalid_grant' ? 'needsReconnect' : 'failed'
	) {
		super(message);
	}
}

/** Spotify rate-limits each app separately; this names the app `user`'s calls go through (the server app for null). */
export const spotifyAppId = (user: Row | null): string => (user?.spotify_own_app ? user.own_client_id : process.env.SPOTIFY_CLIENT_ID) ?? '';

type Tokens = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(app: { id: string; secret: string }, body: Record<string, string>) {
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${app.id}:${app.secret}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(body),
		signal: AbortSignal.timeout(10_000)
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new SpotifyError(res.status, json.error ?? `token request failed (${res.status})`, Number(res.headers.get('retry-after') ?? 0));
	return json as Tokens;
}

/** Where to send the person to sign in: through their own app when `wantOwn` and they have one, else the server app. */
export function spotifyAuthorizeUrl(user: Row | null, wantOwn: boolean, redirectUri: string, state: string) {
	const app = (wantOwn && ownApp(user)) || serverApp();
	if (!app) return null;
	const url =
		'https://accounts.spotify.com/authorize?' +
		new URLSearchParams({ client_id: app.id, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, state, show_dialog: 'true' });
	return { url, own: app.own };
}

export type SpotifyLink = { spotifyId: string; tokens: Tokens; own: boolean };

/** Finishes sign-in: trades the code from Spotify's redirect for tokens, through the same app that started it. */
export async function exchangeSpotifyCode(user: Row | null, own: boolean, code: string, redirectUri: string) {
	const app = own ? ownApp(user) : serverApp();
	if (!app) throw new SpotifyError(400, 'No Spotify app is set up.');
	const tokens = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
	const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
	if (me.status === 403)
		throw new SpotifyError(403, "This Spotify account isn't on the app's allowed-users list. Ask the admin to add it in the Spotify developer dashboard, or set up your own Spotify app in Settings.");
	if (!me.ok) throw new SpotifyError(me.status, `Spotify returned ${me.status} when reading your profile.`);
	const profile = (await me.json()) as { id: string; display_name?: string };
	return { spotifyId: profile.id, displayName: profile.display_name || profile.id, link: { spotifyId: profile.id, tokens, own } satisfies SpotifyLink };
}

export function saveSpotifyLink(userId: number, link: SpotifyLink) {
	run(
		`UPDATE users SET spotify_id = ?, spotify_access = ?, spotify_refresh = ?, spotify_expires = ?, spotify_authorized_at = ?,
		 spotify_own_app = ?, sync_error = NULL WHERE id = ?`,
		link.spotifyId,
		seal(link.tokens.access_token),
		link.tokens.refresh_token ? seal(link.tokens.refresh_token) : null,
		now() + link.tokens.expires_in - 60,
		now(),
		link.own ? 1 : 0,
		userId
	);
}

export function unlinkSpotify(userId: number) {
	run(
		`UPDATE users SET spotify_id = NULL, spotify_access = NULL, spotify_refresh = NULL, spotify_expires = NULL,
		 spotify_authorized_at = NULL, sync_error = NULL WHERE id = ?`,
		userId
	);
}

/** A working access token for `user`, refreshed and saved when it ran out. Marks the link needs-reconnect when it's dead. */
export async function spotifyToken(user: Row) {
	const current = user.spotify_expires > now() ? unseal(user.spotify_access) : null;
	if (current) return current;
	if (!user.spotify_refresh) throw new SpotifyError(401, 'Spotify is not linked.');
	// Refresh tokens only work with the app that issued them, so never swap in another one.
	const app = user.spotify_own_app ? ownApp(user) : serverApp();
	// The server app missing is a config problem the admin can fix; keep the link so sync resumes once it's back.
	if (!app && !user.spotify_own_app) throw new SpotifyError(503, "The server's Spotify app isn't configured.");
	const refresh = unseal(user.spotify_refresh);
	if (!app || !refresh) {
		needsReconnect(user.id);
		throw new SpotifyError(401, "Saved Spotify credentials can't be used any more.", 0, 'needsReconnect');
	}
	try {
		const t = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: refresh });
		run(
			'UPDATE users SET spotify_access = ?, spotify_refresh = COALESCE(?, spotify_refresh), spotify_expires = ? WHERE id = ?',
			seal(t.access_token),
			t.refresh_token ? seal(t.refresh_token) : null,
			now() + t.expires_in - 60,
			user.id
		);
		return t.access_token;
	} catch (e) {
		if (e instanceof SpotifyError && e.kind === 'needsReconnect') needsReconnect(user.id);
		throw e;
	}
}

let appToken: { token: string; expires: number } | null = null;
/** A token for the server app itself (no user), or null when the server has no Spotify app. */
export async function spotifyAppToken() {
	const app = serverApp();
	if (!app) return null;
	if (!appToken || appToken.expires < now()) {
		const t = await tokenRequest(app, { grant_type: 'client_credentials' });
		appToken = { token: t.access_token, expires: now() + t.expires_in - 60 };
	}
	return appToken.token;
}

/** Everyone whose Spotify link can sync. */
export const activeSpotifyLinks = () => all(`SELECT * FROM users WHERE ${ACTIVE_SQL}`);
export const activeSpotifyLink = (userId: number) => get(`SELECT * FROM users WHERE id = ? AND ${ACTIVE_SQL}`, userId);

/** Records a sync attempt. A needs-reconnect state stays until the person links again. */
export function recordSync(userId: number, error?: unknown) {
	if (error === undefined) run('UPDATE users SET last_sync_at = ?, sync_error = NULL WHERE id = ?', now(), userId);
	else run(`UPDATE users SET sync_error = ? WHERE id = ? AND (sync_error IS NULL OR sync_error != '${RECONNECT}')`, String((error as Error)?.message ?? error), userId);
}

/** What the UI needs to know about a person's Connections, from their users row. */
export function connectionStatus(u: Row) {
	const expiresAt: number | null = u.spotify_authorized_at ? u.spotify_authorized_at + LINK_LIFETIME : null;
	return {
		linked: !!u.spotify_refresh,
		needsReconnect: u.sync_error === RECONNECT,
		lastError: u.sync_error === RECONNECT ? null : ((u.sync_error as string | null) ?? null),
		lastSync: (u.last_sync_at as number | null) ?? null,
		expiresAt,
		expiringSoon: !!expiresAt && expiresAt - now() < 14 * 86400,
		ownClientId: (u.own_client_id as string | null) ?? null,
		usesOwnApp: !!u.spotify_own_app,
		lastfmUser: (u.lastfm_user as string | null) ?? null,
		listenbrainzUser: (u.listenbrainz_user as string | null) ?? null
	};
}

// ---- Last.fm ----

/** The server's Last.fm app: from .env if set there, otherwise the one an admin saved in Settings. The shared secret is only needed for "Sign in with Last.fm". */
export function lastfmApp() {
	if (process.env.LASTFM_API_KEY) return { key: process.env.LASTFM_API_KEY, secret: process.env.LASTFM_SHARED_SECRET || null, fromEnv: true };
	const key = setting('lastfm_api_key');
	return key ? { key, secret: unseal(setting('lastfm_secret')), fromEnv: false } : null;
}
/** The Last.fm key an admin saved in Settings (never the secret), for showing in the form. */
export const savedLastfmKey = () => setting('lastfm_api_key') ?? '';

/** Asks Last.fm whether a key and shared secret belong together; auth.getToken fails unless both are right. */
export async function checkLastfmApp(key: string, secret: string): Promise<'ok' | 'rejected' | 'unreachable'> {
	const p = { method: 'auth.getToken', api_key: key };
	try {
		await lastfm({ ...p, api_sig: lastfmSig(p, secret) });
		return 'ok';
	} catch (e) {
		// Last.fm answers a wrong key or signature with HTTP 403 (error 10 or 13).
		const { status, code } = e as { status?: number; code?: number };
		return status === 403 || (code && code !== 29) ? 'rejected' : 'unreachable';
	}
}

export function setLastfmServerApp(key: string, secret: string) {
	tx(() => {
		setSetting('lastfm_api_key', key);
		setSetting('lastfm_secret', seal(secret));
	});
}
export const lastfmLoginEnabled = () => !!lastfmApp()?.secret;

/** Last.fm's api_sig: md5 of every param as name+value, sorted by name, then the shared secret. */
export const lastfmSig = (params: Record<string, string>, secret: string) =>
	createHash('md5')
		.update(Object.keys(params).sort().map((k) => k + params[k]).join('') + secret)
		.digest('hex');

export const lastfmAuthUrl = (cb: string) => 'https://www.last.fm/api/auth/?' + new URLSearchParams({ api_key: lastfmApp()!.key, cb });

/** Trades the token from Last.fm's sign-in redirect for the Last.fm username it belongs to. */
export async function lastfmUsername(token: string) {
	const app = lastfmApp()!;
	const p = { method: 'auth.getSession', api_key: app.key, token };
	const r = await lastfm({ ...p, api_sig: lastfmSig(p, app.secret!) });
	const name = r.session?.name;
	if (typeof name !== 'string' || !name.trim()) throw new Error('Last.fm returned an invalid username.');
	return name;
}

/** Sets (or with null, removes) the person's Last.fm username. Discover picks belong to the old one, so they go too. */
export function setLastfmUser(userId: number, username: string | null) {
	tx(() => {
		run('UPDATE users SET lastfm_user = ? WHERE id = ?', username, userId);
		run('DELETE FROM cache WHERE key = ?', `discover:${userId}`);
	});
}

// ---- ListenBrainz ----

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
	if (typeof me.sub !== 'string' || !me.sub.trim()) throw new Error('MusicBrainz returned an invalid username.');
	// 404 here means the MusicBrainz account has never opened ListenBrainz.
	await getJson(`https://api.listenbrainz.org/1/user/${encodeURIComponent(me.sub)}/listen-count`);
	return me.sub as string;
}

/** Sets (or with null, removes) the person's ListenBrainz username. Discover picks belong to the old one, so they go too. */
export function setListenbrainzUser(userId: number, username: string | null) {
	tx(() => {
		run('UPDATE users SET listenbrainz_user = ? WHERE id = ?', username, userId);
		run('DELETE FROM cache WHERE key = ?', `discover:${userId}`);
	});
}
