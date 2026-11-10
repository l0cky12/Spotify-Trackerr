import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
process.env.GOOGLE_CLIENT_ID = 'google-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';

let db: typeof import('./db.js');
let start: typeof import('../../routes/auth/google/+server.js');
let callback: typeof import('../../routes/auth/google/callback/+server.js');
let settings: typeof import('../../routes/settings/+page.server.js');

beforeAll(async () => {
	db = await import('./db.js');
	start = await import('../../routes/auth/google/+server.js');
	callback = await import('../../routes/auth/google/callback/+server.js');
	settings = await import('../../routes/settings/+page.server.js');
});
afterEach(() => vi.unstubAllGlobals());

/** Fakes Google's token and profile endpoints for one account, and records what the token endpoint was sent. */
function fakeGoogle(profile: { sub: string; email: string; name: string }) {
	const tokenRequests: URLSearchParams[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (url === 'https://oauth2.googleapis.com/token') {
			tokenRequests.push(new URLSearchParams(String(init?.body)));
			return Response.json({ access_token: 'google-access', id_token: 'x' });
		}
		expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
		return Response.json(profile);
	});
	return tokenRequests;
}

/** Goes through /auth/google and back through the callback as Google would; returns where the person ends up. */
async function signIn(mode: 'login' | 'link', user: unknown = null, returningUser = user) {
	const jar = new Map<string, string>();
	const cookies = { get: (k: string) => jar.get(k), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) };
	const begin = (await Promise.resolve()
		.then(() => start.GET({ url: new URL(`https://trackerr.test/auth/google?mode=${mode}`), locals: { user }, cookies } as never))
		.catch((e) => e)) as { location: string };
	const google = new URL(begin.location);
	expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
	const url = new URL(`https://trackerr.test/auth/google/callback?code=abc&state=${google.searchParams.get('state')}`);
	const end = (await callback.GET({ url, locals: { user: returningUser }, cookies } as never).catch((e) => e)) as { location: string };
	return { location: end.location, session: jar.has('session') };
}

const users = () => db.all('SELECT id, display_name, is_admin, google_id, google_email FROM users ORDER BY id');

test('Google login creates the first account, then only while sign-up is open', async () => {
	const sent = fakeGoogle({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
	expect(await signIn('login')).toEqual({ location: '/settings?welcome=1', session: true });
	expect(Object.fromEntries(sent[0])).toMatchObject({ grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://trackerr.test/auth/google/callback' });
	expect(users()).toEqual([{ id: 1, display_name: 'Ada', is_admin: 1, google_id: 'g-ada', google_email: 'ada@example.com' }]);

	// Sign-up is closed now that an account exists: a stranger's Google account gets no account.
	fakeGoogle({ sub: 'g-stranger', email: 'stranger@example.com', name: 'Stranger' });
	const refused = await signIn('login');
	expect(refused.session).toBe(false);
	expect(new URL(refused.location, 'https://x').searchParams.get('error')).toMatch(/No account here is linked to that Google account/);
	expect(users()).toHaveLength(1);

	// The linked account still signs in.
	fakeGoogle({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
	expect(await signIn('login')).toEqual({ location: '/', session: true });

	db.run("INSERT INTO settings (key, value) VALUES ('allow_signup', '1')");
	fakeGoogle({ sub: 'g-stranger', email: 'stranger@example.com', name: 'Stranger' });
	expect(await signIn('login')).toEqual({ location: '/settings?welcome=1', session: true });
	expect(users().map((u) => [u.display_name, u.is_admin, u.google_id])).toEqual([
		['Ada', 1, 'g-ada'],
		['Stranger', 0, 'g-stranger']
	]);
	db.run("DELETE FROM settings WHERE key = 'allow_signup'");
});

test("linking from Settings adds Google to your account, but never one that's someone else's", async () => {
	db.run("INSERT INTO users (id, display_name, created_at) VALUES (10, 'Bo', 0)");
	const bo = () => db.get('SELECT * FROM users WHERE id = 10');
	fakeGoogle({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
	const taken = await signIn('link', bo());
	expect(new URL(taken.location, 'https://x').searchParams.get('error')).toMatch(/already linked to another user/);
	expect(bo().google_id).toBe(null);

	// Someone else logging in during Google's consent screen doesn't get Bo's Google account.
	fakeGoogle({ sub: 'g-bo', email: 'bo@example.com', name: 'Bo' });
	const switched = await signIn('link', bo(), db.get('SELECT * FROM users WHERE id = 1'));
	expect(new URL(switched.location, 'https://x').searchParams.get('error')).toMatch(/account changed/);
	expect(db.get('SELECT google_id FROM users WHERE id = 1').google_id).toBe('g-ada');

	fakeGoogle({ sub: 'g-bo', email: 'bo@example.com', name: 'Bo' });
	expect((await signIn('link', bo())).location).toBe('/settings?section=google');
	expect(bo()).toMatchObject({ google_id: 'g-bo', google_email: 'bo@example.com' });

	// Bo has no password or Spotify, so Google is his only way in and stays linked.
	const unlink = () => settings.actions.googleUnlink({ locals: { user: bo() } } as never);
	expect(await unlink()).toMatchObject({ status: 400 });
	expect(bo().google_id).toBe('g-bo');
	db.run("UPDATE users SET spotify_id = 'sp-bo' WHERE id = 10");
	await unlink();
	expect(bo()).toMatchObject({ google_id: null, google_email: null });
});
