import { test, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/trackerr-`);

test('genre filter ranks only plays by artists tagged with that genre', async () => {
	const { run } = await import('./db.js');
	const { top, totals, inGenre } = await import('./stats.js');
	run("INSERT INTO users (id, display_name, created_at) VALUES (1, 'a', 0)");
	for (const [id, name, genre] of [[1, 'Rocker', 'rock'], [2, 'Popper', 'pop']] as const) {
		run('INSERT INTO artists (id, name, key) VALUES (?, ?, ?)', id, name, name);
		run('INSERT INTO artist_genres (artist_id, genre) VALUES (?, ?)', id, genre);
		run('INSERT INTO albums (id, artist_id, name, key) VALUES (?, ?, ?, ?)', id, id, `${name} LP`, `${name} lp`);
	}
	run("INSERT INTO artist_genres (artist_id, genre) VALUES (2, 'rock')");
	const songs = [[1, 1, 'Riff'], [2, 1, 'Ballad'], [3, 2, 'Hook']] as const;
	for (const [id, artist, name] of songs) run('INSERT INTO tracks (id, artist_id, album_id, name, key) VALUES (?, ?, ?, ?, ?)', id, artist, artist, name, name);
	// Riff x3, Ballad x1, Hook x2. Popper is tagged both pop and rock.
	for (const [track, n] of [[1, 3], [2, 1], [3, 2]]) {
		const artist = songs[track - 1][1];
		for (let i = 0; i < n; i++) run("INSERT INTO plays (user_id, track_id, album_id, artist_id, played_at, ms_played, source) VALUES (1, ?, ?, ?, 100, 1000, 'sync')", track, artist, artist);
	}

	const s = { ids: [1], since: 0, until: 200, rankBy: 'plays' as const, tz: 'UTC' };
	const names = (kind: 'track' | 'album' | 'artist', genre: string) => top(kind, s, 10, 0, inGenre, genre).map((r) => [r.name, r.plays]);
	expect(names('artist', 'rock')).toEqual([['Rocker', 4], ['Popper', 2]]);
	expect(names('track', 'rock')).toEqual([['Riff', 3], ['Hook', 2], ['Ballad', 1]]);
	expect(names('album', 'pop')).toEqual([['Popper LP', 2]]);
	expect(totals(s, inGenre, 'pop')).toMatchObject({ plays: 2, artists: 1, tracks: 1 });
	expect(totals(s, inGenre, 'jazz').plays).toBe(0);
});
