import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR, userColumns, all, get, run, now, tx, setting, setSetting, type Row } from './db.js';
import { lastfm, getJson, UA } from './enrich.js';
import { importEntries, readActivityArchive, type HistoryEntry } from './ingest.js';

// A person's Connections: their Spotify link (tokens, which app it went through, sync state), their Last.fm and ListenBrainz usernames
// and which one's scrobbles count as plays, the Google account they log in with, and their YouTube Music pull (its Google token,
// the export Google is preparing, when it last pulled, and its last error), plus the server's own Spotify, Last.fm and Google apps.
// Nothing outside this file reads those columns or knows they're encrypted.

// playlist-modify-private is for Playlists; links made before it was added get a 403 there until the person reconnects.
const SCOPES = 'user-read-recently-played user-read-currently-playing playlist-modify-private';
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
		listenbrainzUser: (u.listenbrainz_user as string | null) ?? null,
		scrobbleSource: (u.scrobble_source as ScrobbleSource | null) ?? null,
		scrobbleError: (u.scrobble_error as string | null) ?? null,
		scrobblesThrough: (u.scrobble_cursor as number | undefined) || null,
		googleLinked: !!u.google_id,
		googleEmail: (u.google_email as string | null) ?? null,
		youtubePull: !!u.youtube_refresh,
		youtubeJob: !!u.youtube_job,
		youtubePulledAt: (u.youtube_pulled_at as number | null) ?? null,
		youtubeError: (u.youtube_error as string | null) ?? null
	};
}

// ---- Google ----

/** The server's Google OAuth client: from .env if set there, otherwise the one an admin saved in Settings. Google sign-in only says who someone is; it reads none of their music. */
export function googleApp() {
	if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, fromEnv: true };
	const id = setting('google_client_id');
	const secret = id ? unseal(setting('google_secret')) : null;
	return id && secret ? { id, secret, fromEnv: false } : null;
}
export const googleLoginEnabled = () => !!googleApp();
/** The Google client ID an admin saved in Settings (never the secret), for showing in the form. */
export const savedGoogleClientId = () => setting('google_client_id') ?? '';

export function setGoogleServerApp(id: string, secret: string) {
	tx(() => {
		setSetting('google_client_id', id);
		setSetting('google_secret', seal(secret));
	});
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Read access to the person's YouTube activity through Google's Data Portability API, for a YouTube Music pull. */
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/dataportability.myactivity.youtube';

/** Google refused a token request; `code` is its OAuth error, such as invalid_grant. */
class GoogleTokenError extends Error {
	constructor(public code: string) {
		super(`Google refused the token request (${code}).`);
	}
}

/** Any grant at Google's token endpoint, as this server's Google client. */
async function googleToken(grant: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
	const app = googleApp();
	if (!app) throw new Error("This server's Google client isn't set up.");
	const res = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		body: new URLSearchParams({ ...grant, client_id: app.id, client_secret: app.secret }),
		signal: AbortSignal.timeout(10_000)
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new GoogleTokenError(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`);
	return json;
}

/** Asks Google whether a client ID and secret belong together: trading a made-up code fails with invalid_client unless both are right. */
export async function checkGoogleApp(id: string, secret: string, redirect_uri: string): Promise<'ok' | 'rejected' | 'unreachable'> {
	try {
		const res = await fetch(GOOGLE_TOKEN_URL, {
			method: 'POST',
			body: new URLSearchParams({ grant_type: 'authorization_code', code: 'trackerr-check', redirect_uri, client_id: id, client_secret: secret }),
			signal: AbortSignal.timeout(10_000)
		});
		const { error } = await res.json().catch(() => ({}));
		if (error === 'invalid_client') return 'rejected';
		return res.status === 400 ? 'ok' : 'unreachable';
	} catch {
		return 'unreachable';
	}
}

/** Where to send the person: Google login, or with `youtube` the separate consent for a YouTube Music pull, which asks only for the pull's scope. */
export const googleAuthUrl = (redirect_uri: string, state: string, youtube = false) =>
	'https://accounts.google.com/o/oauth2/v2/auth?' +
	new URLSearchParams({
		client_id: googleApp()!.id,
		redirect_uri,
		response_type: 'code',
		scope: youtube ? YOUTUBE_SCOPE : 'openid email profile',
		state,
		...(youtube ? { prompt: 'consent', access_type: 'offline' } : { prompt: 'select_account' })
	});

export type GoogleAccount = { googleId: string; email: string | null; name: string | null };

/** Trades the code from Google's sign-in redirect for the account it belongs to. */
export async function exchangeGoogleCode(code: string, redirect_uri: string): Promise<GoogleAccount> {
	const { access_token } = await googleToken({ grant_type: 'authorization_code', code, redirect_uri });
	const me = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
	if (!me.ok) throw new Error(`Google returned ${me.status}`);
	const p = await me.json();
	if (typeof p.sub !== 'string' || !p.sub) throw new Error('Google returned an invalid account.');
	return { googleId: p.sub, email: typeof p.email === 'string' ? p.email : null, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null };
}

export const googleOwner = (googleId: string) => get('SELECT id FROM users WHERE google_id = ?', googleId)?.id as number | undefined;

export function saveGoogleLink(userId: number, account: GoogleAccount) {
	run('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?', account.googleId, account.email, userId);
}

export function unlinkGoogle(userId: number) {
	run('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?', userId);
}

// ---- YouTube Music pull ----
// Google's Data Portability API exports a person's YouTube activity on request: start an export, poll until it's ready,
// then download it from signed URLs.
// The scope is Restricted, so it gets its own consent screen; on Google login's screen it would warn everyone until Google verifies the app.

const PORTABILITY = 'https://dataportability.googleapis.com/v1/';
const PULL_EVERY = 86400;
const PULL_REVOKED = 'Google stopped letting this server read your YouTube history; connect again.';
const PULL_ONE_TIME = 'Google gave access for one pull only. To keep pulling, connect again and choose to allow access for 30 or 180 days.';

/** When each person's last export was started or abandoned, so a failing one is retried at most hourly. */
const pullTried = new Map<number, number>();
/** Each person's accessType from Google when their current export started. A restart forgets it, so a one-time grant then keeps its token until Google refuses the next export. */
const pullAccess = new Map<number, string>();

/** Trades the code from the YouTube consent redirect for a refresh token and saves it. Throws a plain message when it can't. */
export async function connectYouTubePull(userId: number, code: string, redirect_uri: string) {
	let t;
	try {
		t = await googleToken({ grant_type: 'authorization_code', code, redirect_uri });
	} catch {
		throw new Error("Google didn't accept the request. Try again.");
	}
	if (!t.scope?.split(' ').includes(YOUTUBE_SCOPE)) throw new Error("Allow this server to read your YouTube history on Google's screen, then try again.");
	if (!t.refresh_token) throw new Error("Google didn't let this server keep access. Try again.");
	run('UPDATE users SET youtube_refresh = ?, youtube_job = NULL, youtube_error = NULL WHERE id = ?', seal(t.refresh_token), userId);
	pullTried.delete(userId);
}

/** Calls the Data Portability API; Google's own error message when it refuses. */
async function portability(token: string, path: string, body?: object) {
	const res = await fetch(PORTABILITY + path, {
		method: body ? 'POST' : 'GET',
		headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
		body: body && JSON.stringify(body),
		signal: AbortSignal.timeout(30_000)
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.error?.message ?? `Google returned ${res.status}.`);
	return json;
}

/** An access token from the person's saved refresh token, or null after clearing a token Google won't take any more. */
async function youtubeAccess(u: Row) {
	const refresh = unseal(u.youtube_refresh);
	try {
		if (refresh) return (await googleToken({ grant_type: 'refresh_token', refresh_token: refresh })).access_token;
	} catch (e) {
		if (!(e instanceof GoogleTokenError && e.code === 'invalid_grant')) throw e;
	}
	run('UPDATE users SET youtube_refresh = NULL, youtube_job = NULL, youtube_error = ? WHERE id = ? AND youtube_refresh = ?', PULL_REVOKED, u.id, u.youtube_refresh);
	return null;
}

/**
 * One step of a person's pull: start an export once a day, or check on the one Google is preparing and save it when ready.
 * Every write after an await is guarded by the state it started from, so stopping or reconnecting meanwhile wins.
 * A failure leaves pulled_at alone, so the next export covers the same days and the plays already saved drop out as duplicates.
 * A finished export is read at most once: if reading it fails, a new one starts within the hour.
 */
async function pullYouTube(u: Row) {
	const due = !u.youtube_job && now() - (u.youtube_pulled_at ?? 0) >= PULL_EVERY && Date.now() - (pullTried.get(u.id) ?? 0) >= 3600_000;
	if (!u.youtube_job && !due) return;
	if (due) pullTried.set(u.id, Date.now());
	const token = await youtubeAccess(u);
	if (!token) return;

	if (due) {
		// A day of overlap catches activity Google records late.
		const since = u.youtube_pulled_at ? { startTime: new Date((u.youtube_pulled_at - 86400) * 1000).toISOString() } : {};
		const job = await portability(token, 'portabilityArchive:initiate', { resources: ['myactivity.youtube'], ...since });
		pullAccess.set(u.id, job.accessType);
		run('UPDATE users SET youtube_job = ?, youtube_error = NULL WHERE id = ? AND youtube_refresh = ?', job.archiveJobId, u.id, u.youtube_refresh);
		return;
	}

	const state = await portability(token, `archiveJobs/${encodeURIComponent(u.youtube_job)}/portabilityArchiveState`);
	if (state.state === 'IN_PROGRESS') return;
	pullTried.set(u.id, Date.now());
	if (!run('UPDATE users SET youtube_job = NULL WHERE id = ? AND youtube_job = ?', u.id, u.youtube_job).changes) return;
	if (state.state !== 'COMPLETE') throw new Error(`Google couldn't prepare your YouTube history (${state.state}). It'll try again.`);
	let entries: HistoryEntry[] = [];
	for (const url of state.urls ?? []) {
		const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
		if (!res.ok) throw new Error(`Google returned ${res.status} for your exported history.`);
		entries = entries.concat(readActivityArchive(new Uint8Array(await res.arrayBuffer())));
	}
	const { added } = importEntries(u.id, [{ name: 'YouTube Music pull', entries }]);
	if (added) console.log(`youtube pull: user ${u.id} +${added}`);
	const exportedAt = Math.floor(Date.parse(state.exportTime) / 1000) || now();
	run('UPDATE users SET youtube_pulled_at = ?, youtube_error = NULL WHERE id = ? AND youtube_refresh = ?', exportedAt, u.id, u.youtube_refresh);
	if (pullAccess.get(u.id) === 'ACCESS_TYPE_ONE_TIME') {
		await portability(token, 'authorization:reset', {}).catch(() => {});
		run('UPDATE users SET youtube_refresh = NULL, youtube_error = ? WHERE id = ? AND youtube_refresh = ?', PULL_ONE_TIME, u.id, u.youtube_refresh);
	}
}

/** Runs a step of every person's YouTube Music pull. One person's failure is saved for them to see and never stops the rest. */
export async function youtubePullsDue() {
	for (const u of all('SELECT id, youtube_refresh, youtube_job, youtube_pulled_at FROM users WHERE youtube_refresh IS NOT NULL')) {
		try {
			await pullYouTube(u);
		} catch (e) {
			const error = String((e as Error)?.message ?? e);
			console.warn(`youtube pull: user ${u.id}: ${error}`);
			run('UPDATE users SET youtube_error = ? WHERE id = ? AND youtube_refresh = ?', error, u.id, u.youtube_refresh);
		}
	}
}

/** Stops the person's pull: tells Google to drop this server's access (best effort), then forgets it here. */
export async function stopYouTubePull(userId: number) {
	const u = get('SELECT id, youtube_refresh FROM users WHERE id = ?', userId);
	if (u?.youtube_refresh)
		try {
			const token = await youtubeAccess(u);
			if (token) await portability(token, 'authorization:reset', {});
		} catch {
			// Google may already have dropped it; the token is forgotten here either way.
		}
	run('UPDATE users SET youtube_refresh = NULL, youtube_job = NULL, youtube_pulled_at = NULL, youtube_error = NULL WHERE id = ?', userId);
	pullTried.delete(userId);
	pullAccess.delete(userId);
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

/** Sets (or with null, removes) the person's Last.fm username. */
export const setLastfmUser = (userId: number, username: string | null) => setScrobbleUser(userId, 'lastfm', username);

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

/** Sets (or with null, removes) the person's ListenBrainz username. */
export const setListenbrainzUser = (userId: number, username: string | null) => setScrobbleUser(userId, 'listenbrainz', username);

// ---- Scrobbles ----

export type ScrobbleSource = 'lastfm' | 'listenbrainz';
const SCROBBLE_USER: Record<ScrobbleSource, 'lastfm_user' | 'listenbrainz_user'> = { lastfm: 'lastfm_user', listenbrainz: 'listenbrainz_user' };

/** The account whose scrobbles count as this person's plays, or null when they count none. */
export function scrobbleAccount(u: Row): { source: ScrobbleSource; username: string } | null {
	const source = u.scrobble_source as ScrobbleSource | null;
	const username = source && (u[SCROBBLE_USER[source]] as string | null);
	return source && username ? { source, username } : null;
}

/**
 * Discover picks belong to the old account, so they go. When the account whose scrobbles count as plays changes,
 * counting starts over from its first scrobble (or stops, when unlinked); plays already counted stay.
 */
function setScrobbleUser(userId: number, source: ScrobbleSource, username: string | null) {
	const col = SCROBBLE_USER[source];
	tx(() => {
		const u = get(`SELECT scrobble_source, ${col} name FROM users WHERE id = ?`, userId);
		run(`UPDATE users SET ${col} = ? WHERE id = ?`, username, userId);
		if (u?.scrobble_source === source && u.name !== username)
			run('UPDATE users SET scrobble_source = ?, scrobble_cursor = 0, scrobble_error = NULL WHERE id = ?', username ? source : null, userId);
		run('DELETE FROM cache WHERE key = ?', `discover:${userId}`);
	});
}

/** Picks which linked account's scrobbles count as plays (null: none). Switching starts counting over from the new account's first scrobble. */
export function setScrobbleSource(userId: number, source: ScrobbleSource | null) {
	run('UPDATE users SET scrobble_source = ?, scrobble_cursor = 0, scrobble_error = NULL WHERE id = ? AND scrobble_source IS NOT ?', source, userId, source);
}
