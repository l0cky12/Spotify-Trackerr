import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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
	time_unit TEXT NOT NULL DEFAULT 'auto',
	public INTEGER NOT NULL DEFAULT 0,
	spotify_id TEXT UNIQUE,
	spotify_access TEXT,
	spotify_refresh TEXT,
	spotify_expires INTEGER,
	spotify_authorized_at INTEGER,
	spotify_own_app INTEGER NOT NULL DEFAULT 0,
	sync_error TEXT,
	last_sync_at INTEGER,
	sync_minutes INTEGER NOT NULL DEFAULT 5,
	own_client_id TEXT,
	own_client_secret TEXT,
	lastfm_user TEXT,
	listenbrainz_user TEXT,
	home_location TEXT,
	show_miles INTEGER NOT NULL DEFAULT 100,
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
	credits_done INTEGER NOT NULL DEFAULT 0,
	UNIQUE (artist_id, key)
);
CREATE INDEX IF NOT EXISTS tracks_spotify ON tracks (spotify_id);
CREATE INDEX IF NOT EXISTS tracks_enriched ON tracks (enriched);

-- Artists credited on a song besides its main one (Spotify's featured artists); credits_done marks songs already looked up.
CREATE TABLE IF NOT EXISTS track_features (
	track_id INTEGER NOT NULL REFERENCES tracks,
	name TEXT NOT NULL,
	PRIMARY KEY (track_id, name)
);

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

-- Saved playlist templates: kind picks the recipe, params (JSON) fills it in. See playlists.ts.
CREATE TABLE IF NOT EXISTS playlist_templates (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	params TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	last_playlist_url TEXT
);

-- Songs, albums and artists a person banned: their plays of these drop out of every page. See bans.ts.
CREATE TABLE IF NOT EXISTS bans (
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
	item_id INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, kind, item_id)
);

-- Artists a person wants to hear about shows for, and the shows an AI assistant found for them over MCP. See shows.ts.
CREATE TABLE IF NOT EXISTS watches (
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	artist_id INTEGER NOT NULL REFERENCES artists,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, artist_id)
);
-- date is the venue's local date (YYYY-MM-DD); city_key is the matching key of the city's first part, so the same
-- show found twice with a differently written venue or state is still one show. seen = 0 until the person opens Shows.
CREATE TABLE IF NOT EXISTS shows (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	artist_id INTEGER NOT NULL REFERENCES artists,
	date TEXT NOT NULL,
	venue TEXT NOT NULL,
	city TEXT NOT NULL,
	city_key TEXT NOT NULL,
	url TEXT,
	note TEXT,
	found_at INTEGER NOT NULL,
	seen INTEGER NOT NULL DEFAULT 0,
	UNIQUE (user_id, artist_id, date, city_key)
);

-- Access keys for the MCP server (/mcp); only a hash is kept. See auth.ts.
CREATE TABLE IF NOT EXISTS api_tokens (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	last_used_at INTEGER
);
`);

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to an existing database.
export const userColumns = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
if (!userColumns.includes('lastfm_user')) db.exec('ALTER TABLE users ADD COLUMN lastfm_user TEXT');
if (!userColumns.includes('listenbrainz_user')) db.exec('ALTER TABLE users ADD COLUMN listenbrainz_user TEXT');
if (!userColumns.includes('time_unit')) db.exec("ALTER TABLE users ADD COLUMN time_unit TEXT NOT NULL DEFAULT 'auto'");
// Auto became the default time unit; move everyone onto it once (they can pick a fixed unit again in Settings).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'time_unit_auto'").get()) {
	db.exec("UPDATE users SET time_unit = 'auto'; INSERT INTO settings (key, value) VALUES ('time_unit_auto', '1')");
}
// Profile picture: an /img/ upload or one of the person's top-artist pictures (see settings).
if (!userColumns.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
// Where the person lives and how far they'd travel, for finding shows near them.
if (!userColumns.includes('home_location')) db.exec('ALTER TABLE users ADD COLUMN home_location TEXT');
if (!userColumns.includes('show_miles')) db.exec('ALTER TABLE users ADD COLUMN show_miles INTEGER NOT NULL DEFAULT 100');
// How often new plays sync, picked in Settings (5–30 minutes).
if (!userColumns.includes('sync_minutes')) db.exec('ALTER TABLE users ADD COLUMN sync_minutes INTEGER NOT NULL DEFAULT 5');
if (userColumns.includes('listenbrainz_token')) db.exec('UPDATE users SET listenbrainz_token = NULL WHERE listenbrainz_token IS NOT NULL');
if (!(db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[]).some((c) => c.name === 'credits_done'))
	db.exec('ALTER TABLE tracks ADD COLUMN credits_done INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS tracks_credits ON tracks (credits_done)');

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

// Secrets saved in Settings are encrypted with a key kept in its own file, so a copy of the database alone can't reveal them.
const keyFile = join(DATA_DIR, 'secret.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
const secretKey = readFileSync(keyFile);

/** Encrypts a secret for the database (AES-256-GCM). */
export function seal(text: string) {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', secretKey, iv);
	const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
	return 'enc:' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
/** Decrypts a sealed secret; null when it's missing or the key file changed. */
export function unseal(value: string | null | undefined) {
	if (!value?.startsWith('enc:')) return null;
	const b = Buffer.from(value.slice(4), 'base64');
	try {
		const d = createDecipheriv('aes-256-gcm', secretKey, b.subarray(0, 12));
		d.setAuthTag(b.subarray(12, 28));
		return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
	} catch {
		return null;
	}
}

// Spotify app secrets saved before encryption existed.
if (userColumns.includes('own_client_secret'))
	for (const u of all("SELECT id, own_client_secret s FROM users WHERE own_client_secret NOT LIKE 'enc:%'")) run('UPDATE users SET own_client_secret = ? WHERE id = ?', seal(u.s), u.id);

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
