import { test, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
const tz = 'America/New_York';
const view = { ids: [1], readonly: false, label: null, name: 'Morgan', tz, rankBy: 'plays' as const };
let r: typeof import('./report.js');
let s: typeof import('./stats.js');

beforeAll(async () => {
	const { run } = await import('./db.js');
	const { fromLocal } = await import('../time.js');
	r = await import('./report.js');
	s = await import('./stats.js');
	run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'Morgan', ?, 0), (2, 'Alex', ?, 0)", tz, tz);
	for (const [id, name] of [[1, 'Aurora Lane'], [2, 'Bright Fields'], [3, 'Cold Harbour']] as const) run('INSERT INTO artists (id, name, key) VALUES (?, ?, ?)', id, name, name);
	const songs = { Riff: [1, 1], Hook: [2, 2], Drift: [3, 3], Echo: [4, 2] } as const;
	for (const [name, [id, artist]] of Object.entries(songs)) run('INSERT INTO tracks (id, artist_id, name, key) VALUES (?, ?, ?, ?)', id, artist, name, name);
	const play = (user: number, song: keyof typeof songs, m: number, d: number, h: number, ms = 200_000) =>
		run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (?, ?, ?, ?, ?, 'sync')", user, songs[song][0], songs[song][1], fromLocal(tz, 2025, m, d, h), ms);
	play(1, 'Riff', 8, 10, 12);
	play(2, 'Drift', 8, 11, 12);
	// Oct 14 late evening in New York is already Oct 15 in UTC.
	play(1, 'Hook', 9, 14, 21, 100_000);
	play(1, 'Hook', 9, 14, 22, 100_000);
	play(1, 'Drift', 9, 14, 23, 100_000);
	play(1, 'Riff', 9, 15, 9);
	play(1, 'Echo', 9, 15, 10);
	play(1, 'Riff', 9, 20, 10);
});

const report = (id: string) => r.reportOf(view, s.periodOf(tz, id)!);

test('new artists are the ones this person never played before the period, ranked', () => {
	const oct = report('2025-10');
	expect(oct.newArtists.map((a) => [a.name, a.plays])).toEqual([['Bright Fields', 3], ['Cold Harbour', 1]]);
	expect(oct.totals.newArtists).toBe(2);
	expect(oct.delta.newArtists).toEqual({ diff: 1, pct: 100 });
});

test('only the top 10 new artists are listed, and the count covers all of them', async () => {
	const { run } = await import('./db.js');
	const { fromLocal } = await import('../time.js');
	run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (9, 'Sam', ?, 0)", tz);
	for (let i = 0; i < 12; i++) {
		run('INSERT INTO artists (id, name, key) VALUES (?, ?, ?)', 100 + i, `Newcomer ${i}`, `newcomer ${i}`);
		run('INSERT INTO tracks (id, artist_id, name, key) VALUES (?, ?, ?, ?)', 100 + i, 100 + i, `Song ${i}`, `song ${i}`);
		for (let n = 0; n <= i; n++)
			run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (9, ?, ?, ?, 1000, 'sync')", 100 + i, 100 + i, fromLocal(tz, 2025, 5, 1 + n));
	}
	const june = r.reportOf({ ...view, ids: [9] }, s.periodOf(tz, '2025-06')!);
	expect(june.totals.newArtists).toBe(12);
	expect(june.newArtists.map((a) => a.name)).toEqual(Array.from({ length: 10 }, (_, k) => `Newcomer ${11 - k}`));
});

test('a period still under way is compared with the same stretch of the one before', () => {
	vi.useFakeTimers({ now: Date.UTC(2026, 0, 5, 12), toFake: ['Date'] });
	try {
		const soFar = report('2026');
		expect(soFar.period.partial).toBe(true);
		// 2025 had plays, but none in its first five days.
		expect(soFar.delta.plays).toEqual({ diff: 0, pct: null });
		expect(report('2025').period.partial).toBe(false);
	} finally {
		vi.useRealTimers();
	}
});

test('busiest day is a local calendar day, with its time listened and top songs', () => {
	expect(report('2025-10').busiest).toMatchObject({ label: 'Oct 14, 2025', plays: 3, ms: 300_000 });
	expect(report('2025-10').busiest!.tracks.map((t) => [t.name, t.plays])).toEqual([['Hook', 2], ['Drift', 1]]);
});

test('weekday and hour totals add up to the plays, in local time', () => {
	const oct = report('2025-10');
	expect(oct.totals.plays).toBe(6);
	expect(oct.weekdays).toEqual([1, 3, 2, 0, 0, 0, 0]);
	expect(oct.hours.reduce((a, b) => a + b)).toBe(6);
	expect([oct.hours[9], oct.hours[10], oct.hours[21], oct.hours[22], oct.hours[23]]).toEqual([1, 2, 1, 1, 1]);
	expect(report('2025').weekdays.reduce((a, b) => a + b)).toBe(report('2025').totals.plays);
});

test('a period without plays reports nothing', () => {
	const empty = report('2024-03');
	expect(empty.totals).toMatchObject({ plays: 0, newArtists: 0 });
	expect(empty.busiest).toBeNull();
	expect(empty.newArtists).toEqual([]);
	expect(empty.series.cur.every((n) => n === 0)).toBe(true);
});
