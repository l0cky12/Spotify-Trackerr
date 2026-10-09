import { test, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A database from before secrets were encrypted, with a Spotify app secret saved in plain text.
const dir = mkdtempSync(join(tmpdir(), 'trackerr-'));
const old = new DatabaseSync(join(dir, 'trackerr.db'));
old.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, own_client_id TEXT, own_client_secret TEXT)');
old.exec("INSERT INTO users VALUES (1, 'a', 0, 'id', 'plain-secret')");
old.close();
process.env.DATA_DIR = dir;
delete process.env.LASTFM_API_KEY;

test('saved secrets are encrypted, old plain ones get encrypted on startup, and tampering is caught', async () => {
	const { get, seal, unseal } = await import('./db.js');
	const stored = get('SELECT own_client_secret s FROM users WHERE id = 1')!.s as string;
	expect(stored).not.toContain('plain-secret');
	expect(unseal(stored)).toBe('plain-secret');

	const a = seal('x'), b = seal('x');
	expect(a).not.toBe(b);
	expect(unseal(a)).toBe('x');
	expect(unseal(a.slice(0, -2) + (a.endsWith('A') ? 'B' : 'A') + '=')).toBeNull();
	expect(unseal('not-sealed')).toBeNull();
	expect(unseal(null)).toBeNull();
});

test('the Last.fm app saved in Settings is used when .env has none', async () => {
	const { seal, setSetting } = await import('./db.js');
	const { lastfmApp } = await import('./enrich.js');
	const { lastfmLoginEnabled } = await import('./recs.js');
	expect(lastfmLoginEnabled()).toBe(false);
	setSetting('lastfm_api_key', 'k');
	setSetting('lastfm_secret', seal('s'));
	expect(lastfmApp()).toEqual({ key: 'k', secret: 's', fromEnv: false });
	expect(lastfmLoginEnabled()).toBe(true);
	process.env.LASTFM_API_KEY = 'envk';
	expect(lastfmApp()).toEqual({ key: 'envk', secret: '', fromEnv: true });
	delete process.env.LASTFM_API_KEY;
});
