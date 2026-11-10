import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const ID = '1234-abc.apps.googleusercontent.com';
let db: typeof import('./db.js');
let settings: typeof import('../../routes/settings/+page.server.js');
let login: typeof import('../../routes/login/+page.server.js');
let start: typeof import('../../routes/auth/google/+server.js');
let callback: typeof import('../../routes/auth/google/callback/+server.js');

beforeAll(async () => {
	db = await import('./db.js');
	settings = await import('../../routes/settings/+page.server.js');
	login = await import('../../routes/login/+page.server.js');
	start = await import('../../routes/auth/google/+server.js');
	callback = await import('../../routes/auth/google/callback/+server.js');
	db.run("INSERT INTO users (id, display_name, is_admin, created_at) VALUES (1, 'Admin', 1, 0), (2, 'Bo', 0, 0)");
});
afterEach(() => vi.unstubAllGlobals());

const user = (id: number) => db.get('SELECT * FROM users WHERE id = ?', id);
const googleLoginShown = () => (login.load({ locals: {}, url: new URL('https://trackerr.test/login') } as never) as { google: boolean }).google;

/** Submits the Google client form in Settings as `userId`. */
function saveClient(userId: number, client_id: string, client_secret: string) {
	const body = new FormData();
	body.set('client_id', client_id);
	body.set('client_secret', client_secret);
	const request = new Request('https://trackerr.test/settings', { method: 'POST', body });
	return Promise.resolve()
		.then(() => settings.actions.googleApp({ request, locals: { user: user(userId) }, url: new URL('https://trackerr.test/settings') } as never))
		.catch((e) => e);
}

/** Fakes Google's token endpoint: the check (a made-up code) gets `checkAnswer`; a real sign-in gets a token and a profile. */
function fakeGoogle(checkAnswer: { status: number; error: string }) {
	const sent: URLSearchParams[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (url === 'https://oauth2.googleapis.com/token') {
			const body = new URLSearchParams(String(init?.body));
			sent.push(body);
			if (body.get('code') === 'trackerr-check') return Response.json({ error: checkAnswer.error }, { status: checkAnswer.status });
			return Response.json({ access_token: 'google-access' });
		}
		return Response.json({ sub: 'g-bo', email: 'bo@example.com', name: 'Bo' });
	});
	return sent;
}

test('an admin turns on Google sign-in in Settings; everyone else then signs in with it', async () => {
	expect(googleLoginShown()).toBe(false);

	// Only an admin can set the server's Google client.
	fakeGoogle({ status: 400, error: 'invalid_grant' });
	expect(await saveClient(2, ID, 'GOCSPX-secret')).toMatchObject({ status: 303, location: '/settings' });
	expect(googleLoginShown()).toBe(false);

	// Google says the pair is wrong: nothing is saved.
	fakeGoogle({ status: 401, error: 'invalid_client' });
	expect(await saveClient(1, ID, 'GOCSPX-wrong')).toMatchObject({ status: 400, data: { error: expect.stringMatching(/didn't accept/) } });
	expect(await saveClient(1, 'not-a-client-id', 'x')).toMatchObject({ status: 400, data: { error: expect.stringContaining('ends in .apps.googleusercontent.com') } });
	expect(googleLoginShown()).toBe(false);

	const checked = fakeGoogle({ status: 400, error: 'invalid_grant' });
	expect(await saveClient(1, ID, 'GOCSPX-secret')).toEqual({ section: 'google', saved: true });
	expect(Object.fromEntries(checked[0])).toMatchObject({ client_id: ID, client_secret: 'GOCSPX-secret', redirect_uri: 'https://trackerr.test/auth/google/callback' });
	expect(db.setting('google_secret')).toMatch(/^enc:/);
	expect(googleLoginShown()).toBe(true);

	// Bo links Google with the admin's client; he never enters an ID or secret.
	const sent = fakeGoogle({ status: 400, error: 'invalid_grant' });
	const jar = new Map<string, string>();
	const cookies = { get: (k: string) => jar.get(k), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) };
	const begin = (await Promise.resolve()
		.then(() => start.GET({ url: new URL('https://trackerr.test/auth/google?mode=link'), locals: { user: user(2) }, cookies } as never))
		.catch((e) => e)) as { location: string };
	const google = new URL(begin.location);
	expect(google.searchParams.get('client_id')).toBe(ID);
	const url = new URL(`https://trackerr.test/auth/google/callback?code=abc&state=${google.searchParams.get('state')}`);
	const end = (await callback.GET({ url, locals: { user: user(2) }, cookies } as never).catch((e) => e)) as { location: string };
	expect(end.location).toBe('/settings?section=google');
	expect(Object.fromEntries(sent[0])).toMatchObject({ client_id: ID, client_secret: 'GOCSPX-secret', code: 'abc' });
	expect(user(2).google_id).toBe('g-bo');
});

test('a Google client in .env wins and the Settings form refuses to change it', async () => {
	process.env.GOOGLE_CLIENT_ID = 'env-id.apps.googleusercontent.com';
	process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
	try {
		const { googleApp } = await import('./connections.js');
		expect(googleApp()).toEqual({ id: 'env-id.apps.googleusercontent.com', secret: 'env-secret', fromEnv: true });
		expect(await saveClient(1, ID, 'GOCSPX-other')).toMatchObject({ status: 400, data: { error: expect.stringMatching(/\.env/) } });
	} finally {
		delete process.env.GOOGLE_CLIENT_ID;
		delete process.env.GOOGLE_CLIENT_SECRET;
	}
});
