import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
	testDir: './tests/e2e',
	// Keep browser tests out of Vitest's *.test / *.spec discovery.
	testMatch: '**/*.pw.ts',
	workers: 1,
	forbidOnly: !!process.env.CI,
	use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'node --import ./tests/e2e/offline.mjs server.js',
		url: `${baseURL}/login`,
		reuseExistingServer: false,
		env: {
			PORT: '4173',
			PROTOCOL_HEADER: 'x-forwarded-proto',
			HOST_HEADER: 'x-forwarded-host',
			ALLOWED_HOSTS: baseURL,
			DATA_DIR: mkdtempSync(join(tmpdir(), 'trackerr-e2e-')),
			SPOTIFY_CLIENT_ID: '',
			SPOTIFY_CLIENT_SECRET: '',
			LASTFM_API_KEY: '',
			LASTFM_SHARED_SECRET: '',
			MUSICBRAINZ_CLIENT_ID: '',
			MUSICBRAINZ_CLIENT_SECRET: ''
		}
	}
});
