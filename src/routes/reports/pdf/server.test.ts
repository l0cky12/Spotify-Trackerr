import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError } from '@sveltejs/kit';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
let GET: typeof import('./+server.js').GET;
let me: Record<string, unknown>;

beforeAll(async () => {
	const { run, get } = await import('#lib/server/db.js');
	({ GET } = await import('./+server.js'));
	run("INSERT INTO users (id, display_name, timezone, time_unit, public, created_at) VALUES (1, 'Morgan', 'UTC', 'hours', 0, 0), (2, 'Alex', 'UTC', 'auto', 0, 0), (3, 'Jamie', 'UTC', 'auto', 1, 0)");
	run("INSERT INTO artists (id, name, key) VALUES (1, 'Sigur Rós', 'sigur ros')");
	run("INSERT INTO tracks (id, artist_id, name, key) VALUES (1, 1, 'Hoppípolla', 'hoppipolla')");
	run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (1, 1, 1, ?, 268000, 'sync')", Date.UTC(2025, 9, 14, 12) / 1000);
	me = get('SELECT * FROM users WHERE id = 1');
});

const call = (query: string) => GET({ locals: { user: me }, url: new URL(`http://localhost/reports/pdf?${query}`) } as unknown as Parameters<typeof GET>[0]);
const status = (query: string) =>
	Promise.resolve(call(query)).then(
		(r) => r.status,
		(e) => (isHttpError(e) ? e.status : Promise.reject(e))
	);

test('downloads the Report as a PDF named for its period', async () => {
	const res = await call('period=2025-10');
	expect(res.headers.get('content-type')).toBe('application/pdf');
	expect(res.headers.get('content-disposition')).toBe('attachment; filename="listening-report-2025-10.pdf"');
	expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
});

test("someone else's private stats can't be downloaded, public ones can", async () => {
	expect(await status('period=2025-10&user=2')).toBe(404);
	expect(await status('period=2025-10&user=3')).toBe(200);
});

test('a malformed period is refused', async () => {
	expect(await status('period=2025-13')).toBe(400);
	expect(await status('')).toBe(400);
});
