import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Times a Discover refresh against simulated Last.fm and Deezer servers, through the app's real request pacing.
// Run with: npm run bench:discover
// Time is simulated (fake timers), so the numbers are repeatable and no real API is called.
// BENCH_OUT=picks.json also saves every refresh's picks, to check two versions pick the same music.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bench-discover-'));
process.env.LASTFM_API_KEY = 'bench-key';

// Typical response times seen from Last.fm's and Deezer's APIs.
const LASTFM_MS = 300;
const DEEZER_MS = 150;
const SEEDS = 5;
const DAY = 86_400_000;

// Deterministic "has the user played this": about 1 in 5 candidates already heard on Last.fm.
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const heardOnLastfm = new Set<string>();
const heard = (s: string) => heardOnLastfm.has(s.toLowerCase()) || hash(s) % 5 === 0;
// Scrobbles the simulated user makes between refreshes: [unix seconds, artist, track, album].
const scrobbles: [number, string, string, string][] = [];

function lastfm(u: URL): unknown {
	const p = (k: string) => u.searchParams.get(k) ?? '';
	const plays = (s: string) => (heard(s) ? '3' : '0');
	switch (p('method')) {
		case 'user.gettopartists': return { topartists: { artist: Array.from({ length: SEEDS }, (_, i) => ({ name: `Seed ${i}` })) } };
		case 'user.gettoptracks': return { toptracks: { track: Array.from({ length: SEEDS }, (_, i) => ({ name: `Seed Song ${i}`, artist: { name: `Seed ${i}` } })) } };
		case 'artist.getsimilar': return { similarartists: { artist: Array.from({ length: Number(p('limit')) }, (_, j) => ({ name: `${p('artist')} Like ${j}` })) } };
		case 'track.getsimilar': return { similartracks: { track: Array.from({ length: Number(p('limit')) }, (_, j) => ({ name: `${p('track')} Like ${j}`, artist: { name: `${p('track')} Artist ${j}` }, match: '0.5' })) } };
		case 'artist.gettopalbums': return { topalbums: { album: [{ name: `${p('artist')} LP`, artist: { name: p('artist') }, image: [] }] } };
		case 'artist.getInfo': return { artist: { stats: { userplaycount: plays(p('artist')) } } };
		case 'track.getInfo': return { track: { userplaycount: plays(`${p('artist')} - ${p('track')}`) } };
		case 'album.getInfo': return { album: { userplaycount: plays(p('artist')) } };
		case 'user.getrecenttracks': {
			const from = Number(p('from') || 0);
			const all = scrobbles.filter(([at]) => at >= from).reverse();
			const limit = Number(p('limit') || 50), page = Number(p('page') || 1);
			const track = all.slice((page - 1) * limit, page * limit).map(([at, artist, name, album]) => ({ artist: { '#text': artist }, name, album: { '#text': album }, date: { uts: String(at) } }));
			return { recenttracks: { track, '@attr': { page: String(page), totalPages: String(Math.max(1, Math.ceil(all.length / limit))), total: String(all.length) } } };
		}
	}
	return {};
}

function deezer(u: URL): unknown {
	const q = u.searchParams.get('q') ?? '';
	return { data: [{ name: q, title: q, artist: { name: q }, picture_big: 'https://deezer/a.jpg', cover_big: 'https://deezer/c.jpg', album: { cover_big: 'https://deezer/s.jpg' } }] };
}

const calls = { lastfm: 0, deezer: 0 };
function serve() {
	vi.stubGlobal('fetch', async (url: string) => {
		const u = new URL(url);
		const isLastfm = u.hostname === 'ws.audioscrobbler.com';
		calls[isLastfm ? 'lastfm' : 'deezer']++;
		await new Promise((r) => setTimeout(r, isLastfm ? LASTFM_MS : DEEZER_MS));
		return new Response(JSON.stringify(isLastfm ? lastfm(u) : deezer(u)));
	});
}

describe.skipIf(!process.env.BENCH)('Discover refresh benchmark', () => {
	test('times cold, warm and next-day refreshes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse('2026-10-01T12:00:00Z'));
		const db = await import('#lib/server/db.js');
		const { buildDiscover } = await import('#lib/server/recs.js');
		db.run("INSERT INTO users (id, display_name, created_at, lastfm_user) VALUES (1, 'Bench', 0, 'bench-fm')");
		const user = db.get('SELECT * FROM users WHERE id = 1');
		serve();

		const rows: Record<string, string | number>[] = [];
		const out: unknown[] = [];
		const refresh = async (label: string) => {
			calls.lastfm = calls.deezer = 0;
			const start = Date.now();
			const done = buildDiscover(user);
			await vi.runAllTimersAsync();
			const picks = await done;
			out.push({ refresh: label, artists: picks.artists, albums: picks.albums, songs: picks.songs });
			rows.push({ refresh: label, seconds: +((Date.now() - start) / 1000).toFixed(1), lastfm: calls.lastfm, deezer: calls.deezer, artists: picks.artists.length, albums: picks.albums.length, songs: picks.songs.length });
			return picks;
		};
		const scrobble = (artist: string, track: string, album = '') => scrobbles.push([Math.floor(Date.now() / 1000), artist, track, album]);

		const first = await refresh('First ever (nothing cached)');
		vi.advanceTimersByTime(10 * 60_000);
		await refresh('Again 10 minutes later');

		// A day of listening: 100 scrobbles of music already known, plus one of today's artist picks and one song pick.
		vi.advanceTimersByTime(DAY);
		for (let i = 0; i < 100; i++) scrobble(`Seed ${i % SEEDS}`, `Seed Song ${i % SEEDS}`);
		const artist = first.artists[0].artist, song = first.songs[0];
		heardOnLastfm.add(artist.toLowerCase()).add(`${song.artist} - ${song.title}`.toLowerCase());
		scrobble(artist, 'Some Song');
		scrobble(song.artist, song.title!);
		const nextDay = await refresh('Next day, after 102 new scrobbles');
		expect(nextDay.artists.map((a) => a.artist)).not.toContain(artist);
		expect(nextDay.songs.map((s) => s.title)).not.toContain(song.title);

		vi.advanceTimersByTime(8 * DAY);
		await refresh('8 days later (cached lists expired)');

		vi.useRealTimers();
		vi.unstubAllGlobals();
		console.table(rows);
		if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(out, null, 1));
	}, 60_000);
});
