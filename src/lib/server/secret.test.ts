import { test, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
delete process.env.LASTFM_API_KEY;

test('the Last.fm app saved in Settings is used when .env has none, with its secret encrypted', async () => {
	const { setting } = await import('./db.js');
	const { lastfmApp, lastfmLoginEnabled, setLastfmServerApp } = await import('./connections.js');
	expect(lastfmApp()).toBeNull();
	expect(lastfmLoginEnabled()).toBe(false);
	setLastfmServerApp('k', 's');
	expect(setting('lastfm_secret')).toMatch(/^enc:/);
	expect(lastfmApp()).toEqual({ key: 'k', secret: 's', fromEnv: false });
	expect(lastfmLoginEnabled()).toBe(true);
	process.env.LASTFM_API_KEY = 'envk';
	expect(lastfmApp()).toEqual({ key: 'envk', secret: null, fromEnv: true });
	delete process.env.LASTFM_API_KEY;
});
