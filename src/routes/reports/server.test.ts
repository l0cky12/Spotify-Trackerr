import { test, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
let page: typeof import('./+page.server.js');
let shares: typeof import('#lib/server/shares.js');
let get: typeof import('#lib/server/db.js').get;

beforeAll(async () => {
	const db = await import('#lib/server/db.js');
	get = db.get;
	page = await import('./+page.server.js');
	shares = await import('#lib/server/shares.js');
	db.run("INSERT INTO users (id, display_name, timezone, rank_by, time_unit, public, created_at) VALUES (1, 'Morgan', 'UTC', 'plays', 'hours', 0, 0), (2, 'Jamie', 'UTC', 'plays', 'auto', 1, 0), (3, 'Riley', 'UTC', 'plays', 'auto', 0, 0)");
	db.run("INSERT INTO artists (id, name, key) VALUES (1, 'Sigur Rós', 'sigur ros')");
	db.run("INSERT INTO tracks (id, artist_id, name, key) VALUES (1, 1, 'Hoppípolla', 'hoppipolla')");
	const play = (user: number, y: number) => db.run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (?, 1, 1, ?, 268000, 'sync')", user, Date.UTC(y, 3, 2) / 1000);
	play(1, 2024);
	play(1, 2026);
	play(2, 2024);
	play(2, 2024);
});

const me = (id: number) => get('SELECT * FROM users WHERE id = ?', id);
const where = (query: string, user = 1) => {
	try {
		page.load({ locals: { user: me(user) }, url: new URL(`http://localhost/reports?${query}`) } as never);
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	return null;
};

test('opens on this year when it has plays, else the latest year that does', () => {
	vi.useFakeTimers({ now: Date.UTC(2026, 10, 7), toFake: ['Date'] });
	try {
		expect(where('')).toBe('/reports?period=2026');
		expect(where('user=2')).toBe('/reports?period=2024&user=2');
		expect(where('period=2026-04')).toBeNull();
	} finally {
		vi.useRealTimers();
	}
});

test("publishing from someone else's page publishes your own Report", async () => {
	const form = new FormData();
	form.set('period', '2024');
	const event = { locals: { user: me(1) }, url: new URL('http://localhost/reports?period=2024&user=2'), request: new Request('http://localhost/', { method: 'POST', body: form }) };
	const result = (await page.actions.publish(event as never)) as { published: { token: string } };
	const shared = shares.sharedReport(result.published.token)!;
	expect(shared.report.who).toBe('Morgan');
	expect(shared.report.totals.plays).toBe(1);
	expect(shared.timeUnit).toBe('hours');
});
