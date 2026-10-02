import { test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

// db.js opens the database on import, so point it at a scratch one first: a database from before the lastfm_user column existed.
const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
new DatabaseSync(join(dir, 'trackerr.db')).exec('CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL)');
process.env.DATA_DIR = dir;

test('Last.fm signatures sort params by name and end with the secret', async () => {
	const { lastfmSig } = await import('./recs.js');
	expect(lastfmSig({ token: 't', method: 'auth.getSession', api_key: 'k' }, 'shh')).toBe(md5('api_keykmethodauth.getSessiontokentshh'));
});

test('Discover skips what the user already played, takes seeds from Last.fm, and fills in covers', async () => {
	process.env.LASTFM_API_KEY = 'k';
	const db = await import('./db.js');
	const { buildDiscover } = await import('./recs.js');
	db.run("INSERT INTO users (id, display_name, created_at, lastfm_user) VALUES (1, 'a', 0, 'me')");
	db.run("INSERT INTO artists (id, name, key) VALUES (1, 'Heard', 'heard')");
	db.run("INSERT INTO tracks (id, artist_id, name, key) VALUES (1, 1, 'Old Song', 'old song')");
	db.run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (1, 1, 1, 0, 60000, 'sync')");

	const img = (url: string) => [{ size: 'extralarge', '#text': url }];
	const lastfm: Record<string, unknown> = {
		'user.gettopartists': { topartists: { artist: [{ name: 'Seed' }] } },
		'user.gettoptracks': { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }] } },
		'artist.getsimilar': { similarartists: { artist: [{ name: 'Heard' }, { name: 'New Band' }, { name: 'Seed' }] } },
		'track.getsimilar': { similartracks: { track: [{ name: 'Old Song', artist: { name: 'Heard' }, match: '1' }, { name: 'Fresh', artist: { name: 'Heard' }, match: '1' }] } },
		'artist.getInfo': { artist: { stats: { userplaycount: '0' } } },
		'track.getInfo': { track: { userplaycount: '0' } },
		'album.getInfo': { album: { userplaycount: '0' } },
		'artist.gettopalbums': { topalbums: { album: [{ name: 'Debut', artist: { name: 'New Band' }, image: img('https://lastfm/debut.jpg') }] } }
	};
	vi.stubGlobal('fetch', async (url: string) => {
		const u = new URL(url);
		const body = u.host === 'ws.audioscrobbler.com' ? lastfm[u.searchParams.get('method')!] : { data: [{ name: 'New Band', title: 'Fresh', artist: { name: 'Heard' }, picture_big: 'https://deezer/artist.jpg', album: { cover_big: 'https://deezer/song.jpg' } }] };
		return new Response(JSON.stringify(body));
	});

	const r = await buildDiscover(db.get('SELECT * FROM users WHERE id = 1'));
	vi.unstubAllGlobals();
	expect(r.fromLastfm).toBe(true);
	expect(r.artists.map((a) => [a.artist, a.why, a.image])).toEqual([['New Band', 'Seed', 'https://deezer/artist.jpg']]);
	expect(r.albums.map((a) => [a.album, a.image])).toEqual([['Debut', 'https://lastfm/debut.jpg']]);
	expect(r.songs.map((s) => [s.title, s.artistId, s.image])).toEqual([['Fresh', 1, 'https://deezer/song.jpg']]);
});
