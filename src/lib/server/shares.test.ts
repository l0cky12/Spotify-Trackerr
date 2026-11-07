import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from './report.js';
import type { TopRow } from './stats.js';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
let s: typeof import('./shares.js');
let get: typeof import('./db.js').get;

beforeAll(async () => {
	const db = await import('./db.js');
	get = db.get;
	s = await import('./shares.js');
	db.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'Morgan', 'UTC', 0), (2, 'Alex', 'UTC', 0)");
});

const row: TopRow = { id: 41, name: 'Hoppípolla', artist: 'Sigur Rós', artist_id: 7, image: null, plays: 3, ms: 600_000, first: 1_760_000_000, last: 1_760_100_000 };
const report = (id: string, plays: number) =>
	({ period: { id, label: id }, totals: { plays }, tracks: [row], albums: [row], artists: [row], newArtists: [row], busiest: { label: 'Oct 14', plays, ms: 1, tracks: [row] } }) as unknown as Report;
const publish = (user: number, id: string, plays: number) => s.publishReport(user, report(id, plays), 'auto', 'plays');

test('publishing again refreshes the copy behind the same link', () => {
	const first = publish(1, '2025', 10);
	expect(s.sharedReport(first.token)?.report.totals.plays).toBe(10);
	const again = publish(1, '2025', 25);
	expect(again.token).toBe(first.token);
	expect(s.sharedReport(first.token)?.report.totals.plays).toBe(25);
	expect(s.shareOf(1, '2025')?.token).toBe(first.token);
	expect(s.sharedPeriods(1)).toContain('2025');
});

test('the shared copy has no play times or ids into this server', () => {
	const { token } = publish(1, '2025-08', 3);
	const stored = get('SELECT report FROM report_shares WHERE token = ?', token)!.report as string;
	for (const leak of ['"first"', '"last"', '"id":41', '"artist_id"', '1760000000']) expect(stored).not.toContain(leak);
	expect(s.sharedReport(token)!.report.busiest!.tracks[0]).toEqual({ name: 'Hoppípolla', artist: 'Sigur Rós', image: null, plays: 3, ms: 600_000 });
});

test("each person's and each period's link is its own", () => {
	const mine = publish(1, '2025-10', 3);
	expect(publish(2, '2025-10', 4).token).not.toBe(mine.token);
	expect(publish(1, '2025-09', 5).token).not.toBe(mine.token);
	expect(s.shareOf(2, '2025')).toBeNull();
});

test('unpublishing breaks the link, and unknown or malformed links find nothing', () => {
	const { token } = publish(1, '2024', 7);
	expect(s.unpublishReport(1, '2024')).toBe(true);
	expect(s.sharedReport(token)).toBeNull();
	expect(s.unpublishReport(1, '2024')).toBe(false);
	expect(s.sharedReport('nope')).toBeNull();
	expect(s.sharedReport("' OR 1=1 --")).toBeNull();
});
