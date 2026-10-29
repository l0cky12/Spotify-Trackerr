import { expect, test, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A database with plain-text tokens from before encryption, and another process reading it while the app starts.
const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
const file = join(dir, 'trackerr.db');
const old = new DatabaseSync(file);
old.exec(`PRAGMA journal_mode = WAL; CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL,
	spotify_access TEXT, spotify_refresh TEXT, spotify_own_app INTEGER NOT NULL DEFAULT 0, own_client_secret TEXT)`);
const insert = old.prepare('INSERT INTO users VALUES (?, ?, 0, ?, ?, 0, NULL)');
for (let i = 1; i <= 300; i++) insert.run(i, 'u', 'plain-access' + 'x'.repeat(200), 'plain-refresh' + 'y'.repeat(120));
old.close();
process.env.DATA_DIR = dir;
const plainInFiles = () => readdirSync(dir).filter((f) => f.startsWith('trackerr.db')).some((f) => readFileSync(join(dir, f)).includes('plain-refresh'));

test('rewriting the files is retried on the next start when another reader blocks it', async () => {
	const reader = new DatabaseSync(file);
	reader.exec('PRAGMA busy_timeout = 0; BEGIN');
	reader.prepare('SELECT COUNT(*) FROM users').get();
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	const db = await import('./db.js');
	await import('./connections.js');
	expect(warn).toHaveBeenCalledWith(expect.stringMatching(/will retry/));
	expect(db.setting('scrub_pending')).toBe('1');
	expect(db.get("SELECT COUNT(*) n FROM users WHERE spotify_refresh NOT LIKE 'enc:%'")!.n).toBe(0);

	reader.exec('ROLLBACK');
	reader.close();
	db.db.close();
	vi.resetModules();
	const restarted = await import('./db.js');
	await import('./connections.js');
	expect(restarted.setting('scrub_pending')).toBeUndefined();
	expect(plainInFiles()).toBe(false);
}, 20_000);
