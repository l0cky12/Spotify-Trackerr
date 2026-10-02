import { test, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('adds listenbrainz_token to an existing database, and prefers the user token over the server one', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
	// A database from before the column existed.
	new DatabaseSync(join(dir, 'trackerr.db')).exec('CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL)');
	process.env.DATA_DIR = dir;
	const db = await import('./db.js');
	const { listenbrainzToken } = await import('./recs.js');
	db.run("INSERT INTO users (id, display_name, created_at, listenbrainz_token) VALUES (1, 'a', 0, 'mine')");

	process.env.LISTENBRAINZ_TOKEN = 'server';
	expect(listenbrainzToken(db.get('SELECT * FROM users WHERE id = 1'))).toBe('mine');
	expect(listenbrainzToken({ listenbrainz_token: null })).toBe('server');
	delete process.env.LISTENBRAINZ_TOKEN;
	expect(listenbrainzToken({ listenbrainz_token: null })).toBeUndefined();
});
