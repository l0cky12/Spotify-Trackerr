import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let s: typeof import('./stats.js');
let m: typeof import('./ingest.js');
let dbm: typeof import('./db.js');

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	s = await import('./stats.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'America/Chicago', 0)");
});

const day = (iso: string) => Math.floor(Date.parse(iso) / 86400000);

test('streaks: longest run of consecutive days, and the one still going', () => {
	// 1-3 Mar, 5 Mar, 10-15 Mar; "today" is 16 Mar so the 10-15 run is still alive.
	const days = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-05', '2024-03-10', '2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15'].map((d) => day(d + 'T00:00:00Z'));
	const r = s.streaksFromDays(days, day('2024-03-16T00:00:00Z'));
	expect(r.longest).toMatchObject({ days: 6, fromLabel: 'Mar 10, 2024', toLabel: 'Mar 15, 2024' });
	expect(r.current).toMatchObject({ days: 6 });
	expect(r.daysPlayed).toBe(10);
	// Two days later the run is over.
	expect(s.streaksFromDays(days, day('2024-03-18T00:00:00Z')).current).toBeNull();
	// Duplicates and order don't matter; a single day is a streak of one.
	expect(s.streaksFromDays([5, 5, 3, 4], 9).longest).toMatchObject({ from: 3, to: 5, days: 3 });
	expect(s.streaksFromDays([], 9)).toEqual({ longest: null, current: null, daysPlayed: 0 });
});

test('heatmap buckets plays by local weekday and hour', () => {
	// 2024-03-04 is a Monday. 02:30 UTC is Sunday 20:30 in Chicago (CST, UTC-6).
	const grid = s.heatmapGrid([Date.parse('2024-03-04T02:30:00Z') / 1000, Date.parse('2024-03-04T15:00:00Z') / 1000, Date.parse('2024-03-04T15:59:00Z') / 1000], 'America/Chicago');
	expect(grid[6][20]).toBe(1); // Sunday row, 8 PM
	expect(grid[0][9]).toBe(2); // Monday row, 9 AM
	expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(3);
	expect(s.heatmapGrid([], 'UTC').flat().every((v) => v === 0)).toBe(true);
});

test('period deltas compare with the previous period', () => {
	const d = s.delta({ plays: 150, ms: 50, artists: 10, tracks: 0 }, { plays: 100, ms: 100, artists: 0, tracks: 5 });
	expect(d.plays).toEqual({ diff: 50, pct: 50 });
	expect(d.ms).toEqual({ diff: -50, pct: -50 });
	expect(d.artists).toEqual({ diff: 10, pct: null }); // nothing to compare with
	expect(d.tracks).toEqual({ diff: -5, pct: -100 });
});

test('periods: calendar months and years in the local time zone, with the one before', () => {
	const jan = s.periodOf('America/Chicago', '2024-01')!;
	expect(jan.label).toBe('Jan 2024');
	expect(jan.since).toBe(Date.parse('2024-01-01T06:00:00Z') / 1000);
	expect(jan.until).toBe(Date.parse('2024-02-01T06:00:00Z') / 1000);
	expect(jan.prev).toMatchObject({ id: '2023-12', label: 'Dec 2023' });
	const y = s.periodOf('UTC', '2023')!;
	expect(y.prev.id).toBe('2022');
	expect(y.until - y.since).toBe(365 * 86400);
	expect(s.periodOf('UTC', '2024-13')).toBeNull();
	expect(s.periodOf('UTC', 'nope')).toBeNull();
	expect(s.lastMonthId('UTC', Date.parse('2024-01-10T00:00:00Z') / 1000)).toBe('2023-12');
	expect(s.lastMonthId('UTC', Date.parse('2024-06-10T00:00:00Z') / 1000)).toBe('2024-05');
});

test('first heard, busiest day, and blasts from the past come from stored plays', () => {
	const play = (artist: string, title: string, iso: string) => {
		const a = m.upsertArtist(artist);
		const tr = m.upsertTrack(a, null, title, undefined, 200_000);
		m.insertPlay({ userId: 1, trackId: tr.id, albumId: null, artistId: a, msPlayed: 200_000, source: 'sync', durationMs: 200_000, playedAt: Date.parse(iso) / 1000 });
	};
	play('Old', 'Known', '2022-06-15T12:00:00Z');
	play('Old', 'Known', '2023-06-15T12:00:00Z');
	play('Old', 'Known', '2023-06-15T13:00:00Z');
	play('New', 'Found', '2023-06-20T12:00:00Z');
	play('New', 'Found', '2023-06-21T12:00:00Z');
	play('Later', 'Latest', '2023-06-25T12:00:00Z');

	const june23 = { ids: [1], since: Date.parse('2023-06-01T00:00:00Z') / 1000, until: Date.parse('2023-07-01T00:00:00Z') / 1000, rankBy: 'plays' as const, tz: 'UTC' };
	// Known was first heard in 2022, so only the two 2023 discoveries count; newest first.
	expect(s.firstHeard(june23).map((r) => [r.name, r.plays])).toEqual([['Latest', 1], ['Found', 2]]);
	expect(s.firstHeardCount(june23)).toBe(2);
	expect(s.busiestDay(june23)).toMatchObject({ plays: 2, label: 'Jun 15, 2023' });

	// On 15 June 2024: a year ago Known was played twice that day; two years ago once.
	const blasts = s.onThisDay([1], 'UTC', Date.parse('2024-06-15T09:00:00Z') / 1000);
	expect(blasts.map((b) => [b.yearsAgo, b.week, b.plays, b.tracks[0].name])).toEqual([[1, false, 2, 'Known'], [2, false, 1, 'Known']]);
	// On 18 June 2024 nothing was played on the day itself, so the week around it (15-21 June: 2 + 1 + 1 plays) is used.
	const wide = s.onThisDay([1], 'UTC', Date.parse('2024-06-18T09:00:00Z') / 1000);
	expect(wide[0]).toMatchObject({ year: 2023, week: true, plays: 4 });
	expect(s.onThisDay([99], 'UTC', Date.parse('2024-06-18T09:00:00Z') / 1000)).toEqual([]);
});

test('top lists can be sorted by last and first played, and report both', () => {
	const scope = { ids: [1], since: 0, until: Date.parse('2024-01-01T00:00:00Z') / 1000, rankBy: 'plays' as const, tz: 'UTC' };
	expect(s.top('track', scope, 10).map((r) => r.name)).toEqual(['Known', 'Found', 'Latest']);
	expect(s.top('track', { ...scope, sort: 'last' }, 10).map((r) => r.name)).toEqual(['Latest', 'Found', 'Known']);
	expect(s.top('track', { ...scope, sort: 'first' }, 10).map((r) => r.name)).toEqual(['Latest', 'Found', 'Known']);
	const known = s.top('track', scope, 1)[0];
	expect(known.first).toBe(Date.parse('2022-06-15T12:00:00Z') / 1000);
	expect(known.last).toBe(Date.parse('2023-06-15T13:00:00Z') / 1000);
	expect(s.playsPerMonth([1], 'UTC').months.filter((x) => x.plays).map((x) => [x.label, x.plays])).toEqual([['Jun 2022', 1], ['Jun 2023', 5]]);
});
