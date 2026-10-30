import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
process.env.SPOTIFY_CLIENT_ID = 'server-id';
process.env.SPOTIFY_CLIENT_SECRET = 'server-secret';
const db = await import('./db.js');
const c = await import('./connections.js');
const { syncAll, syncDue, nowPlaying } = await import('./spotify.js');
afterEach(() => vi.unstubAllGlobals());

// Alice links through the server app, Bob through his own.
db.run("INSERT INTO users (id, display_name, created_at) VALUES (1, 'Alice', 0), (2, 'Bob', 0)");
c.saveSpotifyLink(1, { spotifyId: 'alice', tokens: { access_token: 'alice-token', refresh_token: 'r', expires_in: 3600 }, own: false });
c.setOwnApp(2, { id: 'b'.repeat(32), secret: 'c'.repeat(32) });
c.saveSpotifyLink(2, { spotifyId: 'bob', tokens: { access_token: 'bob-token', refresh_token: 'r', expires_in: 3600 }, own: true });

const played = (n: number) => ({
	items: [{ played_at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), track: { type: 'track', id: `t${n}`, name: `Song ${n}`, duration_ms: 200_000, artists: [{ id: 'a', name: 'Band' }], album: { name: 'LP' } } }]
});
/** Fakes the Web API: `reply` gets the bearer token and path of each call. */
function fakeSpotify(reply: (token: string, path: string) => Response) {
	const calls: { token: string; path: string; signal: unknown }[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
		const path = new URL(url).pathname;
		calls.push({ token, path, signal: init?.signal });
		return reply(token, path);
	});
	return calls;
}
const plays = (userId: number) => db.get('SELECT COUNT(*) n FROM plays WHERE user_id = ?', userId)!.n;

test("a rate limit pauses only that app's calls, every call has a timeout, and nobody gets a sync error for it", async () => {
	let n = 0;
	const calls = fakeSpotify((token) => (token === 'alice-token' ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : Response.json(played(++n))));
	await syncAll();
	expect(plays(2)).toBe(1);
	expect(calls.every((x) => x.signal instanceof AbortSignal)).toBe(true);

	calls.length = 0;
	await syncAll();
	expect(calls.map((x) => x.token)).toEqual(['bob-token']); // Alice's app is still paused
	expect(plays(2)).toBe(2);
	expect(await nowPlaying(1)).toBeNull();
	expect(calls.map((x) => x.token)).toEqual(['bob-token']);
	expect(db.all('SELECT sync_error FROM users').map((u) => u.sync_error)).toEqual([null, null]);
});

test('other Spotify failures are recorded per person and the rest still sync', async () => {
	db.run('UPDATE users SET spotify_own_app = 0, own_client_id = NULL WHERE id = 2'); // both on the server app, which is paused above
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(Date.now() + 3 * 3600_000); // past the pause and the stored tokens' expiry
	db.run('UPDATE users SET spotify_expires = 9999999999');
	fakeSpotify((token) => (token === 'alice-token' ? new Response('', { status: 500 }) : Response.json(played(99))));
	await syncAll();
	vi.useRealTimers();
	expect(c.connectionStatus(db.get('SELECT * FROM users WHERE id = 1')).lastError).toMatch(/returned 500/);
	expect(c.connectionStatus(db.get('SELECT * FROM users WHERE id = 2')).lastError).toBeNull();
});

test('a rate limit on the token refresh pauses that app too', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(Date.now() + 6 * 3600_000); // past earlier pauses
	db.run('UPDATE users SET spotify_expires = 0, sync_error = NULL'); // both need a refresh, both on the server app
	const calls = fakeSpotify(() => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
	await syncAll();
	await syncAll();
	vi.useRealTimers();
	expect(calls).toHaveLength(1); // one refresh hit the limit; nothing else went out through that app
	expect(db.all('SELECT sync_error FROM users').map((u) => u.sync_error)).toEqual([null, null]);
});

test('each person syncs on their own chosen interval', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	const start = Date.now() + 12 * 3600_000; // past earlier pauses
	vi.setSystemTime(start);
	db.run('UPDATE users SET spotify_expires = 9999999999, sync_error = NULL');
	db.run('UPDATE users SET sync_minutes = 30 WHERE id = 2'); // Alice keeps the 5-minute default
	const calls = fakeSpotify(() => Response.json({ items: [] }));
	await syncAll();
	const synced = async (minutes: number) => {
		calls.length = 0;
		vi.setSystemTime(start + minutes * 60_000);
		await syncDue();
		return calls.map((x) => x.token);
	};
	expect(await synced(4)).toEqual([]);
	expect(await synced(5)).toEqual(['alice-token']);
	expect(await synced(9)).toEqual([]);
	expect(await synced(30)).toEqual(['alice-token', 'bob-token']);
	vi.useRealTimers();
});
