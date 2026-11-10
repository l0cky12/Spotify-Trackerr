import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8 } from 'fflate';

let dbm: typeof import('./db.js');
let c: typeof import('./connections.js');
let sc: typeof import('./scrobbles.js');
let ingest: typeof import('./ingest.js');

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	process.env.LASTFM_API_KEY = 'k'.repeat(32);
	dbm = await import('./db.js');
	c = await import('./connections.js');
	sc = await import('./scrobbles.js');
	ingest = await import('./ingest.js');
	for (const id of [1, 2, 3, 4]) dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (?, 'u', 'UTC', 0)", id);
});
afterEach(() => vi.unstubAllGlobals());

const user = (id: number) => dbm.get('SELECT * FROM users WHERE id = ?', id);
const plays = (id: number) =>
	dbm.all(
		'SELECT a.name artist, t.name track, al.name album, p.played_at, p.ms_played, p.source FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = p.artist_id LEFT JOIN albums al ON al.id = p.album_id WHERE p.user_id = ? ORDER BY p.played_at',
		id
	);

/** Fakes one service: answers each request with `respond(params)` and records the params. */
function fake(respond: (q: URLSearchParams) => unknown) {
	const calls: URLSearchParams[] = [];
	vi.stubGlobal('fetch', async (url: string) => {
		const q = new URL(url).searchParams;
		calls.push(q);
		const body = respond(q);
		return body instanceof Response ? body : Response.json(body);
	});
	return calls;
}

const lfmTrack = (artist: string, name: string, album: string, uts: number) => ({ artist: { '#text': artist }, name, album: { '#text': album }, date: { uts: String(uts) } });
const lastfmPages = (q: URLSearchParams) => {
	const page = Number(q.get('page'));
	const track =
		page === 1
			? [{ ...lfmTrack('Idle Garden', 'Playing Now', '', 0), date: undefined, '@attr': { nowplaying: 'true' } }, lfmTrack('Idle Garden', 'You Got One Too', 'Fernweh', 3000), lfmTrack('Idle Garden', 'Quiet', '', 2000)]
			: lfmTrack('Pale Coast', 'Slow Tide', 'Shoreline', 1000);
	return { recenttracks: { track, '@attr': { page: String(page), totalPages: '2' } } };
};

test('Last.fm scrobbles are saved as plays across every page, and a second run adds nothing', async () => {
	c.setLastfmUser(1, 'alice');
	c.setScrobbleSource(1, 'lastfm');
	const calls = fake(lastfmPages);
	expect(await sc.syncScrobbles(user(1))).toEqual({ added: 3 });
	expect(plays(1)).toEqual([
		{ artist: 'Pale Coast', track: 'Slow Tide', album: 'Shoreline', played_at: 1000, ms_played: 0, source: 'scrobble' },
		{ artist: 'Idle Garden', track: 'Quiet', album: null, played_at: 2000, ms_played: 0, source: 'scrobble' },
		{ artist: 'Idle Garden', track: 'You Got One Too', album: 'Fernweh', played_at: 3000, ms_played: 0, source: 'scrobble' }
	]);
	expect(calls.map((q) => [q.get('method'), q.get('user'), q.get('from'), q.get('page')])).toEqual([
		['user.getrecenttracks', 'alice', '0', '1'],
		['user.getrecenttracks', 'alice', '0', '2']
	]);
	expect(new Set(calls.map((q) => q.get('to'))).size).toBe(1);
	expect(c.connectionStatus(user(1))).toMatchObject({ scrobbleSource: 'lastfm', scrobblesThrough: 3000, scrobbleError: null });

	const again = fake(lastfmPages);
	expect(await sc.syncScrobbles(user(1))).toEqual({ added: 0 });
	expect(again[0].get('from')).toBe('0');
	expect(plays(1)).toHaveLength(3);
});

test('a failed run records the error and keeps the cursor; the next good run clears it', async () => {
	c.setLastfmUser(4, 'private-person');
	c.setScrobbleSource(4, 'lastfm');
	fake(() => Response.json({ error: 6, message: 'User not found' }, { status: 404 }));
	expect(await sc.syncScrobbles(user(4))).toHaveProperty('error');
	expect(c.connectionStatus(user(4))).toMatchObject({ scrobbleError: expect.stringContaining('404'), scrobblesThrough: null });
	fake(lastfmPages);
	expect(await sc.syncScrobbles(user(4))).toEqual({ added: 3 });
	expect(c.connectionStatus(user(4))).toMatchObject({ scrobbleError: null, scrobblesThrough: 3000 });
});

test('ListenBrainz listens are walked back a full page at a time, keeping listens that share the boundary second', async () => {
	c.setListenbrainzUser(2, 'bob');
	c.setScrobbleSource(2, 'listenbrainz');
	const listen = (ts: number, track: string, info: Record<string, unknown> = {}) => ({
		listened_at: ts,
		track_metadata: { artist_name: 'Low Orbit', track_name: track, release_name: 'Signals', additional_info: info }
	});
	const history = [
		listen(10_000, 'Far Signal', { duration_ms: 215_000 }),
		listen(9_999, 'Near Signal', { duration: 180 }),
		...Array.from({ length: 997 }, (_, i) => listen(9_998 - i, `Signal ${i}`)),
		listen(100, 'Boundary A'),
		listen(100, 'Boundary B'),
		listen(100, 'Boundary C'),
		listen(50, 'No Signal')
	];
	const pages = (q: URLSearchParams) => ({ payload: { listens: history.filter((l) => l.listened_at < Number(q.get('max_ts'))).slice(0, Number(q.get('count'))) } });
	const calls = fake(pages);
	expect(await sc.syncScrobbles(user(2))).toEqual({ added: history.length });
	expect(calls.map((q) => q.get('max_ts')).slice(1)).toEqual(['101']);
	const saved = plays(2);
	expect(saved.slice(0, 4).map((p) => p.track)).toEqual(['No Signal', 'Boundary A', 'Boundary B', 'Boundary C']);
	expect(saved.slice(-2).map((p) => [p.track, p.ms_played])).toEqual([
		['Near Signal', 180_000],
		['Far Signal', 215_000]
	]);
	expect(c.connectionStatus(user(2)).scrobblesThrough).toBe(10_000);

	fake(pages);
	expect(await sc.syncScrobbles(user(2))).toEqual({ added: 0 });
});

test('a scrobble sent days late, with its real time, is still counted', async () => {
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (5, 'u', 'UTC', 0)");
	c.setLastfmUser(5, 'dana');
	c.setScrobbleSource(5, 'lastfm');
	const t = 1_750_000_000;
	const page = (...tracks: unknown[]) => () => ({ recenttracks: { track: tracks, '@attr': { totalPages: '1' } } });
	fake(page(lfmTrack('Idle Garden', 'Quiet', '', t)));
	expect(await sc.syncScrobbles(user(5))).toEqual({ added: 1 });
	const late = fake(page(lfmTrack('Idle Garden', 'Quiet', '', t), lfmTrack('Pale Coast', 'Offline', '', t - 2 * 86400)));
	expect(await sc.syncScrobbles(user(5))).toEqual({ added: 1 });
	expect(Number(late[0].get('from'))).toBeLessThan(t - 2 * 86400);
	expect(plays(5).map((p) => p.track)).toEqual(['Offline', 'Quiet']);
});

test('a scrobble of a song already in the Spotify history import is the same play', async () => {
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (6, 'u', 'UTC', 0)");
	// The export stamps the end of a play; Last.fm stamps its start, a whole 4-minute song earlier.
	const spotify = [
		{ ts: '2024-03-01T12:00:00Z', ms_played: 240_000, master_metadata_track_name: 'Creep', master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'Pablo Honey', spotify_track_uri: 'spotify:track:creep', reason_end: 'trackdone' }
	];
	ingest.importEntries(6, ingest.readUploads([{ name: 'Streaming_History_Audio_2024.json', data: strToU8(JSON.stringify(spotify)) }]));
	c.setLastfmUser(6, 'erin');
	c.setScrobbleSource(6, 'lastfm');
	fake(() => ({ recenttracks: { track: [lfmTrack('Radiohead', 'Creep', 'Pablo Honey', Date.parse('2024-03-01T11:56:00Z') / 1000)], '@attr': { totalPages: '1' } } }));
	expect(await sc.syncScrobbles(user(6))).toEqual({ added: 0 });
	expect(plays(6)).toMatchObject([{ track: 'Creep', source: 'import' }]);
});

test('a scrobble of a song already imported from Takeout is the same play', async () => {
	const at = Date.parse('2025-04-28T12:23:47Z') / 1000;
	const takeout = [
		{ header: 'YouTube Music', title: 'Watched You Got One Too', titleUrl: 'https://music.youtube.com/watch?v=x', subtitles: [{ name: 'Idle Garden - Topic' }], time: '2025-04-28T12:23:47.000Z' }
	];
	ingest.importEntries(3, ingest.readUploads([{ name: 'watch-history.json', data: strToU8(JSON.stringify(takeout)) }]));
	c.setLastfmUser(3, 'carol');
	c.setScrobbleSource(3, 'lastfm');
	fake(() => ({ recenttracks: { track: [lfmTrack('Idle Garden', 'You Got One Too', 'Fernweh', at + 20)], '@attr': { totalPages: '1' } } }));
	expect(await sc.syncScrobbles(user(3))).toEqual({ added: 0 });
	expect(plays(3)).toMatchObject([{ track: 'You Got One Too', source: 'takeout' }]);
});

test('a new account starts counting over, and unlinking the counted account stops counting', () => {
	expect(user(1)).toMatchObject({ scrobble_source: 'lastfm', scrobble_cursor: 3000 });
	c.setLastfmUser(1, 'alice');
	expect(user(1).scrobble_cursor).toBe(3000);
	c.setListenbrainzUser(1, 'someone');
	expect(user(1).scrobble_cursor).toBe(3000);
	c.setLastfmUser(1, 'alice2');
	expect(user(1)).toMatchObject({ scrobble_source: 'lastfm', scrobble_cursor: 0 });
	dbm.run('UPDATE users SET scrobble_cursor = 9 WHERE id = 1');
	c.setScrobbleSource(1, 'listenbrainz');
	expect(user(1)).toMatchObject({ scrobble_source: 'listenbrainz', scrobble_cursor: 0 });
	c.setListenbrainzUser(1, null);
	expect(user(1)).toMatchObject({ scrobble_source: null, listenbrainz_user: null });
	expect(plays(1)).toHaveLength(3);
});
