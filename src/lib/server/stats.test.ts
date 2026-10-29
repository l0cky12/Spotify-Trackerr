import { test, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/trackerr-`);

test("each genre carries its own top song, album and artist", async () => {
	const { run } = await import('./db.js');
	const { genres } = await import('./stats.js');
	run("INSERT INTO users (id, display_name, created_at) VALUES (1, 'a', 0)");
	for (const [id, name, genre] of [[1, 'Rocker', 'rock'], [2, 'Popper', 'pop']] as const) {
		run('INSERT INTO artists (id, name, key) VALUES (?, ?, ?)', id, name, name);
		run('INSERT INTO artist_genres (artist_id, genre) VALUES (?, ?)', id, genre);
		run('INSERT INTO albums (id, artist_id, name, key) VALUES (?, ?, ?, ?)', id, id, `${name} LP`, `${name} lp`);
	}
	run("INSERT INTO artist_genres (artist_id, genre) VALUES (2, 'rock')");
	const songs = [[1, 1, 'Riff'], [2, 1, 'Ballad'], [3, 2, 'Hook']] as const;
	for (const [id, artist, name] of songs) run('INSERT INTO tracks (id, artist_id, album_id, name, key) VALUES (?, ?, ?, ?, ?)', id, artist, artist, name, name);
	// Riff x3, Ballad x1, Hook x2: Rocker leads rock on plays (4 vs 2), Hook is pop's only song.
	for (const [track, n] of [[1, 3], [2, 1], [3, 2]]) {
		const artist = songs[track - 1][1];
		for (let i = 0; i < n; i++) run("INSERT INTO plays (user_id, track_id, album_id, artist_id, played_at, ms_played, source) VALUES (1, ?, ?, ?, 100, 1000, 'sync')", track, artist, artist);
	}

	const g = genres({ ids: [1], since: 0, until: 200, rankBy: 'plays', tz: 'UTC' });
	const by = Object.fromEntries(g.rows.map((r) => [r.name, r.tops]));
	expect(by.rock.artist).toMatchObject({ name: 'Rocker', plays: 4 });
	expect(by.rock.track).toMatchObject({ name: 'Riff', artist: 'Rocker', artist_id: 1, plays: 3 });
	expect(by.rock.album).toMatchObject({ name: 'Rocker LP', artist: 'Rocker', plays: 4 });
	expect(by.pop.track).toMatchObject({ name: 'Hook', artist: 'Popper', plays: 2 });
	expect(by.pop.album).toMatchObject({ name: 'Popper LP' });
});
