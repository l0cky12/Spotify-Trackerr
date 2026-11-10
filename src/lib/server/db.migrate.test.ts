import { expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A database made before Takeout and scrobble plays existed: plays only allowed 'import' and 'sync'.
const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
const old = new DatabaseSync(join(dir, 'trackerr.db'));
old.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE);
CREATE TABLE albums (id INTEGER PRIMARY KEY, artist_id INTEGER NOT NULL REFERENCES artists, name TEXT NOT NULL, key TEXT NOT NULL);
CREATE TABLE tracks (id INTEGER PRIMARY KEY, artist_id INTEGER NOT NULL REFERENCES artists, album_id INTEGER REFERENCES albums, name TEXT NOT NULL, key TEXT NOT NULL,
	spotify_id TEXT, duration_ms INTEGER, enriched INTEGER NOT NULL DEFAULT 0);
CREATE TABLE plays (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	track_id INTEGER NOT NULL REFERENCES tracks,
	album_id INTEGER REFERENCES albums,
	artist_id INTEGER NOT NULL REFERENCES artists,
	played_at INTEGER NOT NULL,
	ms_played INTEGER NOT NULL,
	source TEXT NOT NULL CHECK (source IN ('import', 'sync'))
);
CREATE INDEX plays_user_time ON plays (user_id, played_at);
INSERT INTO users VALUES (1, 'a', 0);
INSERT INTO artists VALUES (1, 'Radiohead', 'radiohead');
INSERT INTO albums VALUES (1, 1, 'Pablo Honey', 'pablo honey');
INSERT INTO tracks VALUES (1, 1, 1, 'Creep', 'creep', NULL, 240000, 1);
INSERT INTO plays VALUES (7, 1, 1, 1, 1, 1000, 240000, 'import'), (9, 1, 1, NULL, 1, 2000, 120000, 'sync');
`);
const before = old.prepare('SELECT * FROM plays ORDER BY id').all();
old.close();
process.env.DATA_DIR = dir;

const db = await import('./db.js');

test('an old plays table is rebuilt with every row kept, and takes the new sources', () => {
	expect(db.all('SELECT * FROM plays ORDER BY id')).toEqual(before);
	for (const [i, source] of ['takeout', 'scrobble'].entries())
		db.run('INSERT INTO plays (user_id, track_id, album_id, artist_id, played_at, ms_played, source) VALUES (1, 1, NULL, 1, ?, 0, ?)', 3000 + i, source);
	expect(() => db.run("INSERT INTO plays (user_id, track_id, artist_id, played_at, ms_played, source) VALUES (1, 1, 1, 4000, 0, 'bogus')")).toThrow(/CHECK/);
	const indexes = db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'plays'").map((r) => r.name);
	expect(indexes).toEqual(expect.arrayContaining(['plays_user_time', 'plays_user_track', 'plays_user_artist', 'plays_user_album', 'plays_track']));
	// Foreign keys still hold after the rebuild: deleting the person deletes their plays.
	db.run('DELETE FROM users WHERE id = 1');
	expect(db.get('SELECT COUNT(*) n FROM plays').n).toBe(0);
});
