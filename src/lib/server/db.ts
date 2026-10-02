import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? './data';
mkdirSync(join(DATA_DIR, 'uploads'), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'trackerr.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY,
	username TEXT UNIQUE COLLATE NOCASE,
	password_hash TEXT,
	display_name TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	timezone TEXT NOT NULL DEFAULT 'UTC',
	rank_by TEXT NOT NULL DEFAULT 'plays' CHECK (rank_by IN ('plays', 'minutes')),
	public INTEGER NOT NULL DEFAULT 0,
	spotify_id TEXT UNIQUE,
	spotify_access TEXT,
	spotify_refresh TEXT,
	spotify_expires INTEGER,
	spotify_authorized_at INTEGER,
	spotify_own_app INTEGER NOT NULL DEFAULT 0,
	sync_error TEXT,
	last_sync_at INTEGER,
	own_client_id TEXT,
	own_client_secret TEXT,
	lastfm_user TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS artists (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	key TEXT NOT NULL UNIQUE,
	spotify_id TEXT,
	image TEXT,
	image_override TEXT,
	genres_done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS artist_genres (
	artist_id INTEGER NOT NULL REFERENCES artists ON DELETE CASCADE,
	genre TEXT NOT NULL,
	PRIMARY KEY (artist_id, genre)
);

CREATE TABLE IF NOT EXISTS albums (
	id INTEGER PRIMARY KEY,
	artist_id INTEGER NOT NULL REFERENCES artists,
	name TEXT NOT NULL,
	key TEXT NOT NULL,
	image TEXT,
	image_override TEXT,
	release_year INTEGER,
	deezer_id INTEGER,
	UNIQUE (artist_id, key)
);

-- enriched: 0 = waiting for Deezer, 1 = done, 2 = waiting for iTunes fallback
CREATE TABLE IF NOT EXISTS tracks (
	id INTEGER PRIMARY KEY,
	artist_id INTEGER NOT NULL REFERENCES artists,
	album_id INTEGER REFERENCES albums,
	name TEXT NOT NULL,
	key TEXT NOT NULL,
	spotify_id TEXT,
	duration_ms INTEGER,
	image TEXT,
	image_override TEXT,
	enriched INTEGER NOT NULL DEFAULT 0,
	UNIQUE (artist_id, key)
);
CREATE INDEX IF NOT EXISTS tracks_spotify ON tracks (spotify_id);
CREATE INDEX IF NOT EXISTS tracks_enriched ON tracks (enriched);

CREATE TABLE IF NOT EXISTS plays (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	track_id INTEGER NOT NULL REFERENCES tracks,
	album_id INTEGER REFERENCES albums,
	artist_id INTEGER NOT NULL REFERENCES artists,
	played_at INTEGER NOT NULL, -- unix seconds, UTC, end of playback
	ms_played INTEGER NOT NULL,
	source TEXT NOT NULL CHECK (source IN ('import', 'sync'))
);
CREATE INDEX IF NOT EXISTS plays_user_time ON plays (user_id, played_at);
CREATE INDEX IF NOT EXISTS plays_user_track ON plays (user_id, track_id, played_at);
CREATE INDEX IF NOT EXISTS plays_user_artist ON plays (user_id, artist_id, played_at);
CREATE INDEX IF NOT EXISTS plays_user_album ON plays (user_id, album_id, played_at);
CREATE INDEX IF NOT EXISTS plays_track ON plays (track_id);

CREATE TABLE IF NOT EXISTS imports (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	files TEXT NOT NULL,
	added INTEGER NOT NULL,
	duplicates INTEGER NOT NULL,
	skipped_short INTEGER NOT NULL,
	skipped_private INTEGER NOT NULL,
	skipped_other INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);
`);

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to an existing database.
const userColumns = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
if (!userColumns.includes('lastfm_user')) db.exec('ALTER TABLE users ADD COLUMN lastfm_user TEXT');
if (userColumns.includes('listenbrainz_token')) db.exec('UPDATE users SET listenbrainz_token = NULL WHERE listenbrainz_token IS NOT NULL');

export const now = () => Math.floor(Date.now() / 1000);

// Rows come straight from SQLite; typed loosely on purpose.
export type Row = any;
export const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
export const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export function tx<T>(fn: () => T): T {
	db.exec('BEGIN');
	try {
		const r = fn();
		db.exec('COMMIT');
		return r;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export function setting(key: string): string | undefined {
	return get('SELECT value FROM settings WHERE key = ?', key)?.value;
}
export function setSetting(key: string, value: string) {
	run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

/** JSON cache for third-party lookups. */
export async function cached<T>(key: string, maxAgeSec: number, fn: () => Promise<T>): Promise<T> {
	const hit = get('SELECT value, fetched_at FROM cache WHERE key = ?', key);
	if (hit && now() - hit.fetched_at < maxAgeSec) return JSON.parse(hit.value);
	const value = await fn();
	run(
		'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
		key,
		JSON.stringify(value),
		now()
	);
	return value;
}
