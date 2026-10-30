import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sh: typeof import('./shows.js');
let mcp: typeof import('./mcp.js');
let auth: typeof import('./auth.js');
let m: typeof import('./ingest.js');
let dbm: typeof import('./db.js');

const user = () => dbm.get('SELECT * FROM users WHERE id = 1')!;
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
let calls = 0;
const call = (name: string, args: object = {}) => mcp.handleMcp(user(), { jsonrpc: '2.0', id: ++calls, method: 'tools/call', params: { name, arguments: args } }) as any;
const result = (r: any) => JSON.parse(r.result.content[0].text);

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	sh = await import('./shows.js');
	mcp = await import('./mcp.js');
	auth = await import('./auth.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'UTC', 0)");
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (2, 'b', 'UTC', 0)");
	const a = m.upsertArtist('Radiohead');
	const tr = m.upsertTrack(a, null, 'Creep', undefined, 200_000);
	for (let i = 0; i < 3; i++) m.insertPlay({ userId: 1, trackId: tr.id, albumId: null, artistId: a, msPlayed: 200_000, source: 'import', durationMs: 200_000, playedAt: Date.now() / 1000 - 86400 * (i + 1) });
});

test('watching is per person and only for artists that exist', () => {
	const rh = m.upsertArtist('Radiohead');
	expect(sh.watch(1, rh)).toBe(true);
	expect(sh.watch(1, rh)).toBe(true);
	expect(sh.watch(1, 99999)).toBe(false);
	expect(sh.watching(1, rh)).toBe(true);
	expect(sh.watching(2, rh)).toBe(false);
	expect(sh.watchesOf(1).map((w) => [w.name, w.plays])).toEqual([['Radiohead', 3]]);
});

test('saving shows keeps new ones, spots repeats by artist, date and city, and rejects bad ones', () => {
	const date = inDays(30);
	const first = sh.saveShows(1, 'UTC', [{ artist: 'radiohead', date, venue: 'Smoothie King Center', city: 'New Orleans, LA', url: 'https://example.com/t' }]);
	expect(first.saved).toHaveLength(1);
	// Same show written differently: venue renamed, state spelled out.
	const again = sh.saveShows(1, 'UTC', [{ artist: 'Radiohead', date, venue: 'The Smoothie King Center', city: 'New Orleans, Louisiana' }]);
	expect(again).toMatchObject({ saved: [], known: [{ artist: 'Radiohead' }], rejected: [] });
	const bad = sh.saveShows(1, 'UTC', [
		{ artist: 'Bjork', date, venue: 'X', city: 'Y' },
		{ artist: 'Radiohead', date: inDays(-2), venue: 'X', city: 'Y' },
		{ artist: 'Radiohead', date: '2026-02-30', venue: 'X', city: 'Y' },
		{ artist: 'Radiohead', date: 'next friday', venue: 'X', city: 'Y' },
		{ artist: 'Radiohead', date, venue: '', city: 'Y' },
		{ artist: 'Radiohead', date, venue: 'X', city: 'Y', url: 'javascript:alert(1)' }
	]);
	expect(bad.saved).toEqual([]);
	expect(bad.rejected.map((r) => r.reason)).toEqual([
		"Bjork isn't on the watchlist. Watch them first.",
		'That date has already passed.',
		'The date must be YYYY-MM-DD.',
		'The date must be YYYY-MM-DD.',
		'Missing the venue or city.',
		'The link must start with https://'
	]);
	// Another person can't see it, and it's new until the person opens Shows.
	expect(sh.upcomingShows(2, 'UTC')).toEqual([]);
	expect(sh.newShowCount(1, 'UTC')).toBe(1);
	expect(sh.upcomingShows(1, 'UTC')).toMatchObject([{ artist: 'Radiohead', venue: 'Smoothie King Center', seen: false }]);
	sh.markShowsSeen(1);
	expect(sh.newShowCount(1, 'UTC')).toBe(0);
});

test('past shows drop out of upcoming and the badge', () => {
	const rh = m.upsertArtist('Radiohead');
	dbm.run("INSERT INTO shows (user_id, artist_id, date, venue, city, city_key, found_at) VALUES (1, ?, '2020-01-01', 'Old', 'Gone', 'gone', 0)", rh);
	expect(sh.upcomingShows(1, 'UTC').map((s) => s.venue)).not.toContain('Old');
	expect(sh.newShowCount(1, 'UTC')).toBe(0);
});

test('home location is trimmed and travel distance is kept in range', () => {
	sh.setHome(1, '  New Orleans, LA ', 99999);
	expect(sh.homeOf(1)).toEqual({ location: 'New Orleans, LA', miles: 3000 });
	sh.setHome(1, 'New Orleans, LA');
	expect(sh.homeOf(1).miles).toBe(3000);
	sh.setHome(1, 'New Orleans, LA', 150);
	expect(sh.homeOf(1)).toEqual({ location: 'New Orleans, LA', miles: 150 });
});

test('MCP: initialize, list tools, and notifications', () => {
	const init = mcp.handleMcp(user(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) as any;
	expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'spotify-trackerr' } });
	expect((mcp.handleMcp(user(), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }) as any).result.protocolVersion).toBe('2025-11-25');
	expect(mcp.handleMcp(user(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
	const list = mcp.handleMcp(user(), { jsonrpc: '2.0', id: 3, method: 'tools/list' }) as any;
	expect(list.result.tools.map((t: any) => t.name)).toEqual(['get_show_watchlist', 'save_shows', 'watch_artist', 'unwatch_artist', 'set_home', 'top_artists']);
	expect(list.result.tools[0]).not.toHaveProperty('run');
	expect((mcp.handleMcp(user(), { jsonrpc: '2.0', id: 4, method: 'nope' }) as any).error.code).toBe(-32601);
	expect((mcp.handleMcp(user(), { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }) as any).error.code).toBe(-32602);
	const batch = mcp.handleMcp(user(), [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]) as any;
	expect(batch).toEqual([{ jsonrpc: '2.0', id: 6, result: {} }]);
});

test('MCP: an assistant can watch an artist, find a show, and only hears about it once', () => {
	expect(result(call('watch_artist', { artist: 'Big Thief' }))).toEqual({ watching: 'Big Thief' });
	const list = result(call('get_show_watchlist'));
	expect(list.home).toEqual({ location: 'New Orleans, LA', travel_miles: 150 });
	expect(list.watched_artists.map((a: any) => a.name)).toEqual(['Radiohead', 'Big Thief']);
	expect(list.known_upcoming_shows).toHaveLength(1);
	const show = { artist: 'Big Thief', date: inDays(10), venue: "Tipitina's", city: 'New Orleans, LA' };
	expect(result(call('save_shows', { shows: [show] })).new).toEqual([{ ...show, url: null, note: null }]);
	expect(result(call('save_shows', { shows: [show] }))).toMatchObject({ new: [], already_known: [show] });
	expect(call('save_shows', { shows: 'oops' }).result).toMatchObject({ isError: true });
	expect(result(call('top_artists', { limit: 5 }))).toEqual([{ name: 'Radiohead', plays: 3, watched: true }]);
	expect(result(call('unwatch_artist', { artist: 'big thief' }))).toEqual({ stopped_watching: 'Big Thief' });
	expect(call('unwatch_artist', { artist: 'Big Thief' }).result).toMatchObject({ isError: true });
	expect(result(call('set_home', { location: 'Austin, TX', travel_miles: 50 }))).toEqual({ location: 'Austin, TX', travel_miles: 50 });
});

test('access keys sign in as their owner until revoked', () => {
	const key = auth.createApiToken(1, ' Claude ');
	expect(key).toMatch(/^trk_/);
	expect(auth.userFromApiToken(key)?.id).toBe(1);
	expect(auth.userFromApiToken('trk_wrong')).toBeNull();
	expect(auth.userFromApiToken(undefined)).toBeNull();
	const [row] = auth.apiTokensOf(1);
	expect(row).toMatchObject({ name: 'Claude' });
	expect(row.last_used_at).not.toBeNull();
	expect(auth.revokeApiToken(2, row.id)).toBe(false);
	expect(auth.revokeApiToken(1, row.id)).toBe(true);
	expect(auth.userFromApiToken(key)).toBeNull();
});

test('deleting a person deletes their watches, shows and keys', () => {
	auth.createApiToken(1, 'x');
	dbm.run('DELETE FROM users WHERE id = 1');
	for (const t of ['watches', 'shows', 'api_tokens']) expect(dbm.get(`SELECT COUNT(*) n FROM ${t}`)!.n).toBe(0);
});
