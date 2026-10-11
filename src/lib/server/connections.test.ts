import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A database from before tokens were encrypted, opened with a different secret.key than some of its secrets were sealed with.
const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
const old = new DatabaseSync(join(dir, 'trackerr.db'));
old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, spotify_id TEXT UNIQUE, spotify_access TEXT,
	spotify_refresh TEXT, spotify_expires INTEGER, spotify_authorized_at INTEGER, spotify_own_app INTEGER NOT NULL DEFAULT 0, sync_error TEXT,
	last_sync_at INTEGER, own_client_id TEXT, own_client_secret TEXT)`);
const lostKey = 'enc:' + Buffer.alloc(40, 7).toString('base64');
old.exec(`INSERT INTO users VALUES
	(1, 'plain', 0, 'sp1', 'plain-access', 'plain-refresh', 9999999999, 0, 1, NULL, NULL, 'own1', 'plain-secret'),
	(2, 'own app lost', 0, 'sp2', 'a2', 'r2', 0, 0, 1, NULL, NULL, 'own2', '${lostKey}'),
	(3, 'token lost', 0, 'sp3', '${lostKey}', '${lostKey}', 0, 0, 0, NULL, NULL, NULL, NULL)`);
// Enough real-sized tokens that encrypting them (which makes them longer) moves rows and leaves the old copies in free pages.
const filler = old.prepare('INSERT INTO users (id, display_name, created_at, spotify_access, spotify_refresh, spotify_expires) VALUES (?, ?, 0, ?, ?, 0)');
for (let i = 1000; i < 1300; i++) filler.run(i, 'filler', 'plain-access' + 'x'.repeat(200), 'plain-refresh' + 'y'.repeat(120));
old.close();
process.env.DATA_DIR = dir;
process.env.SPOTIFY_CLIENT_ID = 'server-id';
process.env.SPOTIFY_CLIENT_SECRET = 'server-secret';

const db = await import('./db.js');
const c = await import('./connections.js');
const settings = await import('../../routes/settings/+page.server.js');
afterEach(() => vi.unstubAllGlobals());

const user = (id: number) => db.get('SELECT * FROM users WHERE id = ?', id);
const OWN_ID = 'a'.repeat(32), OWN_SECRET = 'b'.repeat(32);
const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };

/** Fakes Spotify's token endpoint and records the app each request authenticated as. */
function fakeSpotify(response: () => Response = () => Response.json({ access_token: 'fresh', expires_in: 3600 })) {
	const apps: string[] = [];
	vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
		apps.push(Buffer.from(String((init?.headers as Record<string, string>).Authorization).slice(6), 'base64').toString());
		return response();
	});
	return apps;
}
function newUser(id: number) {
	db.run("INSERT INTO users (id, display_name, created_at) VALUES (?, 'u', 0)", id);
	return user(id);
}
function saveOwnApp(id: number, form: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(form)) body.set(k, v);
	return settings.actions.ownApp({ request: new Request('http://x', { method: 'POST', body }), locals: { user: user(id) } } as never);
}
const expire = (id: number) => db.run('UPDATE users SET spotify_expires = 0 WHERE id = ?', id);

test('a refresh through your own app sends the secret you saved in Settings', async () => {
	newUser(10);
	await saveOwnApp(10, { client_id: OWN_ID, client_secret: OWN_SECRET });
	c.saveSpotifyLink(10, { spotifyId: 'sp10', tokens, own: true });
	expire(10);
	const apps = fakeSpotify();
	expect(await c.spotifyToken(user(10))).toBe('fresh');
	expect(apps).toEqual([`${OWN_ID}:${OWN_SECRET}`]);
});

test('removing your own app while linked through it needs a reconnect, and keeps the account findable by Spotify login', async () => {
	newUser(20);
	await saveOwnApp(20, { client_id: OWN_ID, client_secret: OWN_SECRET });
	c.saveSpotifyLink(20, { spotifyId: 'sp20', tokens, own: true });
	await saveOwnApp(20, { clear: '1' });
	expect(c.connectionStatus(user(20))).toMatchObject({ linked: false, needsReconnect: true, ownClientId: null });
	expect(user(20).spotify_id).toBe('sp20');
	expect(c.activeSpotifyLinks().map((u) => u.id)).not.toContain(20);
	const apps = fakeSpotify();
	await expect(c.spotifyToken(user(20))).rejects.toThrow();
	expect(apps).toEqual([]);
});

test("secrets the key can't open need a reconnect and never fall back to the server app", async () => {
	// Found on startup.
	expect(c.connectionStatus(user(2))).toMatchObject({ linked: false, needsReconnect: true, ownClientId: null });
	expect(c.connectionStatus(user(3))).toMatchObject({ linked: false, needsReconnect: true });
	// Found while running (e.g. a secret tampered with).
	newUser(30);
	await saveOwnApp(30, { client_id: OWN_ID, client_secret: OWN_SECRET });
	c.saveSpotifyLink(30, { spotifyId: 'sp30', tokens, own: true });
	expire(30);
	db.run('UPDATE users SET own_client_secret = ? WHERE id = 30', lostKey);
	const apps = fakeSpotify();
	await expect(c.spotifyToken(user(30))).rejects.toMatchObject({ kind: 'needsReconnect' });
	expect(apps).toEqual([]);
	expect(c.connectionStatus(user(30)).needsReconnect).toBe(true);
});

test('tokens and app secrets are encrypted at rest, including ones saved before encryption', async () => {
	newUser(40);
	await saveOwnApp(40, { client_id: OWN_ID, client_secret: OWN_SECRET });
	c.saveSpotifyLink(40, { spotifyId: 'sp40', tokens, own: true });
	for (const id of [1, 40]) {
		const u = user(id);
		for (const col of ['spotify_access', 'spotify_refresh', 'own_client_secret']) expect(u[col]).toMatch(/^enc:/);
		expect(JSON.stringify(u)).not.toMatch(/plain-|"access"|"refresh"|bbbb/);
	}
	// Nor anywhere in the database files, e.g. in pages the old rows used to occupy.
	for (const f of readdirSync(dir).filter((f) => f.startsWith('trackerr.db'))) expect(readFileSync(join(dir, f)).includes('plain-refresh')).toBe(false);
	expect(await c.spotifyToken(user(1))).toBe('plain-access');
	expire(1);
	const apps = fakeSpotify();
	await c.spotifyToken(user(1));
	expect(apps).toEqual(['own1:plain-secret']);
});

test('a refresh token Spotify rejects needs a reconnect, and later sync errors keep that state', async () => {
	newUser(50);
	c.saveSpotifyLink(50, { spotifyId: 'sp50', tokens, own: false });
	expire(50);
	const apps = fakeSpotify(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
	const e = await c.spotifyToken(user(50)).catch((e) => e);
	expect(apps).toEqual(['server-id:server-secret']);
	expect(e.kind).toBe('needsReconnect');
	c.recordSync(50, e);
	expect(c.connectionStatus(user(50))).toMatchObject({ needsReconnect: true, lastError: null });
	c.saveSpotifyLink(50, { spotifyId: 'sp50', tokens, own: false });
	expect(c.connectionStatus(user(50)).needsReconnect).toBe(false);
});

test("a server app missing from the environment fails the refresh but keeps the link for when it's back", async () => {
	newUser(60);
	c.saveSpotifyLink(60, { spotifyId: 'sp60', tokens, own: false });
	expire(60);
	delete process.env.SPOTIFY_CLIENT_SECRET;
	const apps = fakeSpotify();
	const e = await c.spotifyToken(user(60)).catch((e) => e);
	process.env.SPOTIFY_CLIENT_SECRET = 'server-secret';
	expect(apps).toEqual([]);
	expect(e.message).toMatch(/isn't configured/);
	expect(c.connectionStatus(user(60))).toMatchObject({ linked: true, needsReconnect: false });
	expect(await c.spotifyToken(user(60))).toBe('fresh');
});

test('connectionStatus', () => {
	const t = Math.floor(Date.now() / 1000);
	expect(c.connectionStatus({})).toMatchObject({ linked: false, needsReconnect: false, lastError: null, expiresAt: null, expiringSoon: false });
	expect(c.connectionStatus({ spotify_refresh: 'x', spotify_authorized_at: t, sync_error: 'Spotify returned 500' })).toMatchObject({
		linked: true,
		lastError: 'Spotify returned 500',
		expiringSoon: false
	});
	expect(c.connectionStatus({ spotify_refresh: 'x', spotify_authorized_at: t - 175 * 86400 }).expiringSoon).toBe(true);
	expect(c.connectionStatus({ sync_error: 'reauth' })).toMatchObject({ needsReconnect: true, lastError: null });
});
