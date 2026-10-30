// Run with: npm run screenshots. Uses a temporary database and blocks music-service requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), 'trackerr-screenshots-'));
const outputDir = 'docs/screenshots';
const snapshot = new Date('2026-10-29T12:00:00Z');
const now = snapshot.getTime() / 1000;
const preload = join(dataDir, 'offline.mjs');
// The demo clock starts at the snapshot and keeps ticking: a frozen Date.now() would leave the Last.fm request queue waiting forever.
writeFileSync(preload, `
const RealDate = Date;
const started = RealDate.now();
const demoNow = () => ${snapshot.getTime()} + (RealDate.now() - started);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [demoNow()])); }
  static now() { return demoNow(); }
};
globalThis.fetch = async () => new Response('Offline screenshot demo', { status: 503 });
`);

const env = {
	...process.env, DATA_DIR: dataDir, NODE_ENV: 'production', NODE_NO_WARNINGS: '1',
	SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '',
	LASTFM_API_KEY: 'screenshot-demo-only', LASTFM_SHARED_SECRET: '',
	MUSICBRAINZ_CLIENT_ID: '', MUSICBRAINZ_CLIENT_SECRET: ''
};
let server, browser, db;
try {
	const build = spawn('npm', ['run', 'build'], { env, stdio: 'inherit' });
	assert.equal((await once(build, 'exit'))[0], 0, 'Production build failed');
	const reservation = createServer();
	reservation.listen(0, '127.0.0.1');
	await once(reservation, 'listening');
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const baseURL = `http://127.0.0.1:${port}`;
	server = spawn(process.execPath, ['--import', preload, 'server.js'], {
		env: { ...env, PORT: String(port), ALLOWED_HOSTS: baseURL,
			PROTOCOL_HEADER: 'x-forwarded-proto', HOST_HEADER: 'x-forwarded-host' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	server.stdout.on('data', (chunk) => { logs += chunk; });
	server.stderr.on('data', (chunk) => { logs += chunk; });
	for (let attempt = 0; ; attempt++) {
		assert(server.exitCode === null && attempt < 100, `Demo server failed to start: ${logs}`);
		if ((await fetch(`${baseURL}/login`).catch(() => null))?.ok) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	db = new DatabaseSync(join(dataDir, 'trackerr.db'));
	const artists = [
		['Juniper Arcade', 'After the Rain', 'Window Seat', 'Slow Sunday'],
		['Paper Satellites', 'Night Bus', 'City Lights', 'Last Train Home'],
		['The Orchard Lines', 'Open Country', 'Wildflowers', 'Borrowed Time'],
		['Velvet Harbour', 'Blue Hours', 'Undertow', 'Moonlit Avenue'],
		['Sunday Static', 'Soft Focus', 'Golden Hour', 'Half Awake'],
		['Northbound Echo', 'Small Worlds', 'Coast Road', 'Familiar Places'],
		['Meadow Radio', 'Daylight Ends', 'Summer Glass', 'Passing Through'],
		['Amber District', 'Long Way Round', 'Good Company', 'Yesterday Again'],
		['Low Tide Club', 'Clear Skies', 'Open Water', 'Back to Shore'],
		['Evening Atlas', 'Far From Here', 'New Ground', 'In the Morning'],
		['Cedar & Co.', 'Quiet Streets', 'Home Again', 'Little Things'],
		['Signal Garden', 'Moving Colour', 'First Light', 'Silver Screen']
	];
	const colours = ['#d09b63', '#5a8ba5', '#80916c', '#a46d85', '#c5a95e', '#638d91'];
	const art = (id) => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><rect width="360" height="360" fill="${colours[id % colours.length]}"/><circle cx="${80 + id % 4 * 45}" cy="120" r="90" fill="#f4e6ca" opacity=".7"/><path d="M0 270L130 140L360 300V360H0Z" fill="#202a35" opacity=".65"/><path d="M0 310L240 180L360 240V360H0Z" fill="#17212c" opacity=".6"/></svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
	};
	const user = db.prepare('INSERT INTO users (id, username, display_name, is_admin, public, lastfm_user, listenbrainz_user, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)');
	user.run(1, 'demo-morgan', 'Morgan (demo)', 1, 'morgan-demo', 'morgan-demo', now);
	user.run(2, 'demo-alex', 'Alex (demo)', 0, null, null, now);
	user.run(3, 'demo-jamie', 'Jamie (demo)', 0, null, null, now);
	const token = randomBytes(32).toString('hex');
	db.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run(createHash('sha256').update(token).digest('hex'), now + 86400);
	db.exec('BEGIN');
	const catalog = artists.map(([name, album, ...songs], i) => {
		const id = i + 1, image = art(id);
		db.prepare('INSERT INTO artists (id, name, key, image, genres_done) VALUES (?, ?, ?, ?, 1)').run(id, name, name.toLowerCase(), image);
		for (const genre of [i < 10 ? 'indie rock' : 'electronic', i % 2 ? 'dream pop' : 'alternative'])
			db.prepare('INSERT INTO artist_genres VALUES (?, ?)').run(id, genre);
		db.prepare('INSERT INTO albums (id, artist_id, name, key, image, release_year) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, album, album.toLowerCase(), image, 1997 + i * 2);
		return songs.map((song, j) => {
			const track = i * 2 + j + 1;
			db.prepare('INSERT INTO tracks (id, artist_id, album_id, name, key, image, duration_ms, enriched) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run(track, id, id, song, song.toLowerCase(), image, 180000 + i * 6000);
			return { track, artist: id, ms: 180000 + i * 6000 };
		});
	});
	const play = db.prepare("INSERT INTO plays (user_id, track_id, album_id, artist_id, played_at, ms_played, source) VALUES (?, ?, ?, ?, ?, ?, 'import')");
	for (let day = Date.UTC(2025, 0, 1), d = 0; day < snapshot.getTime() - 86400000; day += 86400000, d++) {
		if (d % 13 === 0) continue;
		const newYear = day >= Date.UTC(2026, 0, 1);
		for (let p = 0; p < 8 + (d * 7 % 27); p++) {
			const i = p % 5 === 0 ? 0 : (d * 5 + p * 3) % (newYear ? artists.length : 8);
			const entry = catalog[i][(d + Math.floor(p / 3)) % 2];
			const at = day / 1000 + 8 * 3600 + p * 1500;
			play.run(1, entry.track, entry.artist, entry.artist, at, entry.ms);
			if (p % 3 === 0) play.run(2 + p % 2, entry.track, entry.artist, entry.artist, at, entry.ms);
		}
	}
	const picks = artists.slice(0, 7).map(([artist, , title, seedSong], i) => ({
		artist: `${artist} Ensemble`, title: `${title} Reprise`, album: `Sessions ${i + 1}`,
		image: art(i + 20), why: artist, seedSong
	}));
	db.prepare('INSERT INTO cache VALUES (?, ?, ?)').run('discover:1', JSON.stringify({
		seeds: picks.map(({ why }) => why), lastfmUser: 'morgan-demo', listenbrainzUser: 'morgan-demo', at: now,
		artists: picks.map(({ artist, image, why }) => ({ artist, image, why })),
		albums: picks.map(({ artist, album, image, why }) => ({ artist, album, image, why })),
		songs: picks.map(({ artist, title, image, why, seedSong }) => ({ artist, title, image, why: seedSong, whyBy: why }))
	}), now);
	// Watched artists, a home, an access key, and shows an assistant "found" (fictional venues; demo clock is Oct 29, 2026).
	db.prepare("UPDATE users SET home_location = 'Portland, OR', show_miles = 150 WHERE id = 1").run();
	for (const id of [1, 2, 3, 5, 9]) db.prepare('INSERT INTO watches VALUES (1, ?, ?)').run(id, now - id * 86400);
	db.prepare('INSERT INTO api_tokens (user_id, token_hash, name, created_at, last_used_at) VALUES (1, ?, ?, ?, ?)')
		.run(createHash('sha256').update('trk_demo').digest('hex'), 'Claude Code', now - 20 * 86400, now - 3600);
	const show = db.prepare('INSERT INTO shows (user_id, artist_id, date, venue, city, city_key, url, note, found_at, seen) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
	show.run(1, '2026-11-14', 'The Lantern Room', 'Portland, OR', 'portland', 'https://example.com/juniper-arcade', 'With Low Tide Club', now - 7200, 0);
	show.run(3, '2026-12-05', 'Harbor Hall', 'Seattle, WA', 'seattle', 'https://example.com/orchard-lines', '175 miles from home', now - 7200, 0);
	show.run(2, '2027-01-23', 'Riverside Ballroom', 'Portland, OR', 'portland', 'https://example.com/paper-satellites', 'Tickets on sale Nov 6', now - 9 * 86400, 1);
	show.run(5, '2027-02-11', 'Old Mill Theatre', 'Eugene, OR', 'eugene', 'https://example.com/sunday-static', null, now - 9 * 86400, 1);
	db.exec('COMMIT');
	assert(db.prepare('SELECT COUNT(*) n FROM plays').get().n > 10000, 'Demo history is empty');
	db.close(); db = undefined;

	browser = await chromium.launch();
	const context = await browser.newContext({ baseURL, viewport: { width: 1360, height: 900 },
		deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
	await context.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
	const page = await context.newPage();
	await page.clock.setFixedTime(snapshot);
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	mkdirSync(outputDir, { recursive: true });
	async function capture(file, path, heading, fullPage = true) {
		const response = await page.goto(path);
		assert(response.ok(), `${path} returned ${response.status()}`);
		await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		await expect(page).toHaveTitle('Spotify Trackerr');
		await page.evaluate(async () => {
			for (const img of document.images) img.loading = 'eager';
			await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
			await document.fonts.ready;
		});
		await page.waitForFunction(() => [...document.querySelectorAll('.chart > svg, .trends > svg')]
			.every((svg) => Math.abs(svg.getBoundingClientRect().width - svg.parentElement.clientWidth) < 2));
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
		if (file === 'dashboard-phone.png' && overflow > 0)
			console.warn(`Phone layout has ${overflow}px of existing horizontal overflow; preserving it in the demo capture.`);
		else assert(overflow <= 0, `${path} overflows horizontally`);
		assert(await page.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0)), `${path} has broken images`);
		await page.screenshot({ path: join(outputDir, file), fullPage, animations: 'disabled' });
		console.log(`Captured ${file}`);
	}
	await capture('login.png', '/login', 'Trackerr');
	await context.addCookies([{ name: 'session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
	await capture('dashboard.png', '/?range=30d', 'Your listening');
	await page.screenshot({ path: join(outputDir, 'dashboard-overview.png'), animations: 'disabled' });
	await capture('dashboard-all-time.png', '/?range=all', 'Your listening');
	await capture('genre.png', '/genre/indie%20rock?range=30d', 'indie rock');
	await expect(page.getByRole('heading', { name: 'Top 10 songs', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Top 10 albums', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Top 10 artists', exact: true })).toBeVisible();
	await capture('history.png', '/history?range=30d', 'History', false);
	await capture('top-artists.png', '/top/artist?range=30d', 'Top artists', false);
	await capture('song.png', '/track/1', 'Window Seat');
	await capture('artist.png', '/artist/1', 'Juniper Arcade');
	await capture('album.png', '/album/1', 'After the Rain');
	await capture('year-in-review.png', '/wrapped/2026', 'Top 5 songs');
	await expect(page.getByText('Biggest day:', { exact: false })).toContainText('Quietest day:');
	await page.getByRole('heading', { name: 'New to you in 2026', exact: false }).evaluate((heading) =>
		window.scrollTo(0, heading.closest('section').getBoundingClientRect().top + scrollY - 20));
	await page.screenshot({ path: join(outputDir, 'year-in-review-new-artists.png'), animations: 'disabled' });
	await capture('discover.png', '/discover', 'Discover');
	await expect(page.getByRole('heading', { name: 'Artists', exact: false })).toBeVisible();
	await capture('people.png', '/people', 'People');
	// Opening Shows marks its shows seen, so the badge in the menu is captured on the pages before it.
	await capture('shows.png', '/shows', 'Shows');
	await expect(page.getByText('New', { exact: true })).toHaveCount(2);
	await page.goto('/settings?section=mcp');
	await page.getByLabel('Key name').fill('Claude');
	await page.getByRole('button', { name: 'Make an access key', exact: true }).click();
	await expect(page.getByText("Your new access key. Copy it now; it won't be shown again.")).toBeVisible();
	await page.screenshot({ path: join(outputDir, 'settings-ai-assistant.png'), fullPage: true, animations: 'disabled' });
	console.log('Captured settings-ai-assistant.png');
	// Shown as linked only for this capture: the offline demo can't reach Spotify, so a real sync would fail.
	const link = new DatabaseSync(join(dataDir, 'trackerr.db'));
	link.prepare('UPDATE users SET spotify_refresh = ?, spotify_authorized_at = ?, last_sync_at = ?, sync_minutes = 15, sync_error = NULL WHERE id = 1').run('demo', now - 30 * 86400, now - 120);
	await capture('settings-spotify.png', '/settings?section=spotify', 'Settings');
	link.prepare('UPDATE users SET spotify_refresh = NULL WHERE id = 1').run();
	link.close();
	await capture('settings.png', '/settings?section=lastfm', 'Settings');
	await capture('settings-listenbrainz.png', '/settings?section=listenbrainz', 'Settings');
	await capture('settings-preferences.png', '/settings?section=prefs', 'Settings');
	await page.setViewportSize({ width: 390, height: 844 });
	await capture('dashboard-phone.png', '/?range=30d', 'Your listening', false);
	assert.deepEqual(errors, [], 'Browser JavaScript errors');
	console.log('Screenshot checks passed: current title, page content, artwork, chart sizing, desktop overflow, and browser errors.');
} finally {
	try { await browser?.close(); }
	finally {
		db?.close();
		if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
		rmSync(dataDir, { recursive: true, force: true });
	}
}
