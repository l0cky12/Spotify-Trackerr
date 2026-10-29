import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
process.env.SPOTIFY_CLIENT_ID = 'server-id';
process.env.SPOTIFY_CLIENT_SECRET = 'server-secret';
process.env.LASTFM_API_KEY = 'k';
const db = await import('./db.js');
const c = await import('./connections.js');
const { syncAll, creditStep } = await import('./spotify.js');
const { buildDiscover, members, bareTitle } = await import('./recs.js');
afterEach(() => vi.unstubAllGlobals());

db.run("INSERT INTO users (id, display_name, created_at) VALUES (1, 'Alice', 0)");
c.saveSpotifyLink(1, { spotifyId: 'alice', tokens: { access_token: 'tok', refresh_token: 'r', expires_in: 3600 }, own: false });
const features = (spotifyId: string) => db.all('SELECT f.name FROM track_features f JOIN tracks t ON t.id = f.track_id WHERE t.spotify_id = ?', spotifyId).map((r) => r.name);
const done = (spotifyId: string) => db.get('SELECT credits_done d FROM tracks WHERE spotify_id = ?', spotifyId)!.d;

test('sync saves featured artists; the backfill looks up imported songs one at a time and skips ones Spotify lost', async () => {
	vi.stubGlobal('fetch', async (url: string) => {
		const path = new URL(url).pathname;
		if (path.endsWith('/recently-played'))
			return Response.json({ items: [{ played_at: '2026-01-01T00:00:00Z', track: { type: 'track', id: 'synced', name: 'Duet', duration_ms: 1, artists: [{ name: 'Band' }, { name: 'Guest' }], album: { name: 'LP' } } }] });
		if (path.endsWith('/gone')) return new Response('', { status: 404 });
		return Response.json({ artists: [{ name: 'Rapper' }, { name: 'Royce da 5\'9"' }] });
	});
	await syncAll();
	expect(features('synced')).toEqual(['Guest']);
	expect(done('synced')).toBe(1);

	db.run("INSERT INTO artists (id, name, key) VALUES (50, 'Rapper', 'rapper')");
	db.run("INSERT INTO tracks (id, artist_id, name, key, spotify_id) VALUES (50, 50, 'Not Alike', 'not alike', 'imported'), (51, 50, 'Old', 'old', 'gone')");
	db.run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (1, 50, 50, 5, 60000, 'import')");
	await creditStep();
	await creditStep();
	expect(features('imported')).toEqual(['Royce da 5\'9"']);
	expect([done('gone'), features('gone')]).toEqual([1, []]);
	expect(await creditStep()).toBe(false);
});

test('Discover skips artists you only heard as a feature, collaborations with someone you heard, and other versions of songs you played', async () => {
	db.run("UPDATE users SET lastfm_user = 'me' WHERE id = 1");
	const lastfm: Record<string, unknown> = {
		'user.gettopartists': { topartists: { artist: [{ name: 'Seed' }] } },
		'user.gettoptracks': { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }] } },
		'artist.getsimilar': { similarartists: { artist: [{ name: "Royce da 5'9" }, { name: 'Guest & Someone' }, { name: 'New Band' }] } },
		'track.getsimilar': { similartracks: { track: [{ name: 'Not Alike - Live', artist: { name: "Royce Da 5'9\"" }, match: '1' }, { name: 'Fresh', artist: { name: 'Rapper' }, match: '1' }] } },
		'artist.getInfo': { artist: { stats: { userplaycount: '0' } } },
		'track.getInfo': { track: { userplaycount: '0' } },
		'album.getInfo': { album: { userplaycount: '0' } },
		'artist.gettopalbums': { topalbums: { album: [] } }
	};
	vi.stubGlobal('fetch', async (url: string) => {
		const u = new URL(url);
		return Response.json(u.host === 'ws.audioscrobbler.com' ? lastfm[u.searchParams.get('method')!] : { data: [] });
	});
	const r = await buildDiscover(db.get('SELECT * FROM users WHERE id = 1'));
	expect(r.artists.map((a) => a.artist)).toEqual(['New Band']);
	expect(r.songs.map((s) => s.title)).toEqual(['Fresh']);
});

test('name helpers', () => {
	expect(members('Bad Omens, Poppy')).toEqual(['Bad Omens, Poppy', 'Bad Omens', 'Poppy']);
	expect(members('Lil Nas X')).toEqual(['Lil Nas X']);
	expect(bareTitle('All Night Longer REMIX (feat. B.o.B)')).toBe(bareTitle('All Night Longer'));
});
