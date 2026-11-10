import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

let m: typeof import('./ingest.js');
let s: typeof import('./stats.js');
let enrich: typeof import('./enrich.js');
let dbm: typeof import('./db.js');

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	s = await import('./stats.js');
	enrich = await import('./enrich.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'UTC', 0), (2, 'b', 'UTC', 0), (3, 'c', 'UTC', 0)");
});
afterEach(() => vi.unstubAllGlobals());

const ytm = (title: string, channel: string, time: string, extra: Record<string, unknown> = {}) => ({
	header: 'YouTube Music',
	title: `Watched ${title}`,
	titleUrl: 'https://music.youtube.com/watch?v=4hvGypikiXo',
	subtitles: [{ name: channel, url: 'https://www.youtube.com/channel/UC1' }],
	time,
	products: ['YouTube'],
	...extra
});
const history = [
	ytm('You Got One Too', 'Idle Garden - Topic', '2025-04-28T12:23:47.000Z'),
	ytm('Northern Lights', 'Glass Harbor', '2025-04-28T12:30:00.000Z'),
	{ ...ytm('Cat video', 'Some Vlogger', '2025-04-28T13:00:00.000Z'), header: 'YouTube', titleUrl: 'https://www.youtube.com/watch?v=c4tV1d30' },
	ytm('https://music.youtube.com/watch?v=gone', '', '2025-04-28T14:00:00.000Z', { subtitles: undefined }),
	ytm('Untitled', 'x', '2025-04-28T15:00:00.000Z', { subtitles: [] })
];
const json = (entries: unknown) => strToU8(JSON.stringify(entries));
const playsOf = (userId: number) =>
	dbm.all(
		`SELECT a.name artist, t.name track, p.album_id, p.played_at, p.ms_played, p.source FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = p.artist_id
		 WHERE p.user_id = ? ORDER BY p.played_at`,
		userId
	);

test('YouTube Music plays in watch-history.json are imported and plain YouTube is skipped', () => {
	const sum = m.importEntries(1, m.readUploads([{ name: 'watch-history.json', data: json(history) }]));
	expect(sum).toMatchObject({ files: ['watch-history.json'], added: 2, duplicates: 0, skipped_short: 0, skipped_private: 0, skipped_other: 3 });
	expect(playsOf(1)).toEqual([
		{ artist: 'Idle Garden', track: 'You Got One Too', album_id: null, played_at: Date.parse('2025-04-28T12:23:47Z') / 1000, ms_played: 0, source: 'takeout' },
		{ artist: 'Glass Harbor', track: 'Northern Lights', album_id: null, played_at: Date.parse('2025-04-28T12:30:00Z') / 1000, ms_played: 0, source: 'takeout' }
	]);
	expect(dbm.get('SELECT added, skipped_other FROM imports WHERE user_id = 1')).toEqual({ added: 2, skipped_other: 3 });

	expect(m.importEntries(1, m.readUploads([{ name: 'watch-history.json', data: json(history) }])).added).toBe(0);
	expect(playsOf(1)).toHaveLength(2);
});

test('the Takeout .zip is read whatever its folders are called', () => {
	const zip = zipSync({
		'Takeout/YouTube und YouTube Music/Verlauf/watch-history.json': json([ytm('Slow Tide', 'Pale Coast - Topic', '2025-05-01T08:00:00.000Z')]),
		'Takeout/YouTube und YouTube Music/Verlauf/search-history.json': json([{ header: 'YouTube', title: 'Searched for x', time: '2025-05-01T08:00:00.000Z' }])
	});
	const files = m.readUploads([{ name: 'takeout-20250501.zip', data: zip }]);
	expect(files.map((f) => f.name)).toEqual(['watch-history.json']);
	expect(m.importEntries(2, files).added).toBe(1);
	expect(playsOf(2)).toMatchObject([{ artist: 'Pale Coast', track: 'Slow Tide', source: 'takeout' }]);
});

test('Takeout history exported as HTML is refused with how to get JSON', () => {
	const html = strToU8('<html><body>Watched …</body></html>');
	expect(() => m.readUploads([{ name: 'watch-history.html', data: html }])).toThrow(/JSON/);
	const zip = zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.html': html });
	expect(() => m.readUploads([{ name: 'takeout.zip', data: zip }])).toThrow(/Multiple formats/);
});

test("a song's length, once looked up, fills in its Takeout plays and counts for later ones", async () => {
	m.importEntries(3, m.readUploads([{ name: 'watch-history.json', data: json([ytm('Far Signal', 'Low Orbit - Topic', '2025-06-01T10:00:00.000Z')]) }]));
	const minutes = () => s.totals({ ids: [3], since: 0, until: 2e9, rankBy: 'minutes', tz: 'UTC' }).ms;
	expect(minutes()).toBe(0);

	vi.stubGlobal('fetch', async (url: string) => {
		expect(url).toContain('api.deezer.com/search');
		return Response.json({ data: [{ title: 'Far Signal', artist: { name: 'Low Orbit' }, album: { title: 'Far Signal', id: 1, cover_xl: 'x.jpg' }, duration: 215 }] });
	});
	while (await enrich.deezerStep());
	expect(minutes()).toBe(215_000);

	m.importEntries(3, m.readUploads([{ name: 'watch-history.json', data: json([ytm('Far Signal', 'Low Orbit - Topic', '2025-06-02T10:00:00.000Z')]) }]));
	expect(minutes()).toBe(430_000);
});

const activity = (title: string, titleUrl: string, channel: string | null, time: string) => ({
	header: 'YouTube',
	title,
	titleUrl,
	...(channel && { subtitles: [{ name: channel, url: 'https://www.youtube.com/channel/UC2' }] }),
	time,
	products: ['YouTube'],
	activityControls: ['YouTube watch history']
});

test('a YouTube Music pull keeps only the YouTube Music watches from the activity Google exports', () => {
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (4, 'd', 'UTC', 0)");
	const zip = zipSync({
		'Portability/My Activity/YouTube/MyActivity.json': json([
			activity('Watched Quiet Field', 'https://music.youtube.com/watch?v=q1', 'Moss Choir - Topic', '2025-07-01T09:00:00.000Z'),
			activity('Watched How to fix a bike', 'https://www.youtube.com/watch?v=b1', 'Fix It', '2025-07-01T09:05:00.000Z'),
			activity('Searched for moss choir', 'https://music.youtube.com/search?q=moss+choir', null, '2025-07-01T09:10:00.000Z'),
			activity('Visited Moss Choir', 'https://music.youtube.com/channel/UC2', 'Moss Choir - Topic', '2025-07-01T09:15:00.000Z')
		]),
		'Portability/archive_browser.json': json({ note: 'not a list of records' })
	});
	const sum = m.importEntries(4, [{ name: 'YouTube Music pull', entries: m.readActivityArchive(zip) }]);
	expect(sum).toMatchObject({ files: ['YouTube Music pull'], added: 1, skipped_other: 3 });
	expect(playsOf(4)).toMatchObject([{ artist: 'Moss Choir', track: 'Quiet Field', played_at: Date.parse('2025-07-01T09:00:00Z') / 1000, source: 'takeout' }]);
	expect(dbm.get("SELECT files, added FROM imports WHERE user_id = 4")).toEqual({ files: 'YouTube Music pull', added: 1 });
});

test('a YouTube Music pull also reads activity Google sends as a bare .json file', () => {
	const bare = json([activity('Watched Low Bloom', 'https://music.youtube.com/watch?v=l1', 'Ivy Static - Topic', '2025-07-02T10:00:00.000Z')]);
	expect(m.readActivityArchive(bare)).toEqual([
		{ kind: 'play', artist: 'Ivy Static', title: 'Low Bloom', album: null, playedAt: Date.parse('2025-07-02T10:00:00Z') / 1000, msPlayed: null, source: 'takeout' }
	]);
});
