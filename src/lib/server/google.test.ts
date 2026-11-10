import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
process.env.GOOGLE_CLIENT_ID = 'google-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';

let db: typeof import('./db.js');
let start: typeof import('../../routes/auth/google/+server.js');
let callback: typeof import('../../routes/auth/google/callback/+server.js');
let settings: typeof import('../../routes/settings/+page.server.js');
let connections: typeof import('./connections.js');

beforeAll(async () => {
	db = await import('./db.js');
	start = await import('../../routes/auth/google/+server.js');
	callback = await import('../../routes/auth/google/callback/+server.js');
	settings = await import('../../routes/settings/+page.server.js');
	connections = await import('./connections.js');
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

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
async function signIn(mode: 'login' | 'link' | 'youtube', user: unknown = null, returningUser = user) {
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

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/dataportability.myactivity.youtube';
const PORTABILITY = 'https://dataportability.googleapis.com/v1/';
const SIGNED_URL = 'https://storage.googleapis.test/export-1.zip';

/**
 * Fakes Google for a YouTube Music pull: the token endpoint (consent code and refresh grants), the Data Portability API,
 * and the signed URL an export downloads from. Change its fields to change what Google answers; `calls` records every request.
 */
function fakePortability() {
	const google = {
		consent: { scope: YOUTUBE_SCOPE, refresh_token: 'dp-refresh-secret' } as Record<string, string | undefined>,
		deadRefresh: new Set<string>(),
		accessType: 'ACCESS_TYPE_TIME_BASED',
		state: 'IN_PROGRESS',
		stateStatus: 200,
		exportTime: '',
		archive: new Uint8Array(),
		calls: [] as { url: string; body: any }[]
	};
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const raw = init?.body ? String(init.body) : null;
		const body = raw === null ? null : url.startsWith(PORTABILITY) ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
		google.calls.push({ url, body });
		if (url === 'https://oauth2.googleapis.com/token') {
			if (body.grant_type === 'authorization_code') return Response.json({ access_token: 'dp-access', ...google.consent });
			if (google.deadRefresh.has(body.refresh_token)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
			return Response.json({ access_token: 'dp-access', scope: YOUTUBE_SCOPE });
		}
		if (url.startsWith(PORTABILITY)) expect(init?.headers).toMatchObject({ Authorization: 'Bearer dp-access' });
		if (url === PORTABILITY + 'portabilityArchive:initiate') return Response.json({ archiveJobId: 'job-1', accessType: google.accessType });
		if (url === PORTABILITY + 'archiveJobs/job-1/portabilityArchiveState') {
			if (google.stateStatus !== 200) return Response.json({ error: { message: 'Backend unavailable.' } }, { status: google.stateStatus });
			return Response.json({ name: 'archiveJobs/job-1/portabilityArchiveState', state: google.state, urls: [SIGNED_URL], exportTime: google.exportTime });
		}
		if (url === SIGNED_URL) {
			expect(init?.headers).toBeUndefined();
			return new Response(google.archive);
		}
		if (url === PORTABILITY + 'authorization:reset') return Response.json({});
		throw new Error(`unexpected request to ${url}`);
	});
	return google;
}

const activityZip = (...songs: [title: string, channel: string, time: string][]) =>
	zipSync({
		'Portability/My Activity/YouTube/MyActivity.json': strToU8(
			JSON.stringify([
				...songs.map(([title, channel, time]) => ({
					header: 'YouTube',
					title: `Watched ${title}`,
					titleUrl: 'https://music.youtube.com/watch?v=x',
					subtitles: [{ name: channel }],
					time,
					products: ['YouTube']
				})),
				{ header: 'YouTube', title: 'Searched for lo-fi', titleUrl: 'https://www.youtube.com/results?search_query=lo-fi', time: songs[0][2], products: ['YouTube'] }
			])
		)
	});

const userRow = (id: number) => db.get('SELECT * FROM users WHERE id = ?', id);
const pull = (id: number) => connections.connectionStatus(userRow(id));
const playsOf = (id: number) =>
	db.all('SELECT t.name track, p.played_at, p.source FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.user_id = ? ORDER BY p.played_at', id);
const callsTo = (google: ReturnType<typeof fakePortability>, path: string) => google.calls.filter((c) => c.url === PORTABILITY + path);

async function connectYouTube(id: number) {
	db.run('INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, ?, 0)', id, `pull-${id}`);
	return signIn('youtube', userRow(id));
}

test('connecting YouTube history asks Google only for that scope, apart from Google login, and saves the token sealed', async () => {
	const google = fakePortability();
	const jar = { get: () => undefined, set: () => {}, delete: () => {} };
	const consent = (await Promise.resolve()
		.then(() => start.GET({ url: new URL('https://trackerr.test/auth/google?mode=youtube'), locals: { user: { id: 1 } }, cookies: jar } as never))
		.catch((e) => e)) as { location: string };
	const asked = new URL(consent.location).searchParams;
	expect(Object.fromEntries(asked)).toMatchObject({ scope: YOUTUBE_SCOPE, access_type: 'offline', prompt: 'consent' });
	const login = (await Promise.resolve()
		.then(() => start.GET({ url: new URL('https://trackerr.test/auth/google?mode=login'), locals: { user: null }, cookies: jar } as never))
		.catch((e) => e)) as { location: string };
	expect(new URL(login.location).searchParams.get('scope')).toBe('openid email profile');
	const loggedOut = (await Promise.resolve()
		.then(() => start.GET({ url: new URL('https://trackerr.test/auth/google?mode=youtube'), locals: { user: null }, cookies: jar } as never))
		.catch((e) => e)) as { location: string };
	expect(loggedOut.location).toBe('/login');

	// The person unticks the YouTube box on Google's screen, or Google keeps no offline access: nothing is saved.
	for (const consent of [{ scope: '', refresh_token: 'dp-refresh-secret' }, { scope: YOUTUBE_SCOPE }]) {
		google.consent = consent;
		expect((await connectYouTube(30)).location).toMatch(/^\/settings\?section=youtube&error=/);
		expect(pull(30)).toMatchObject({ youtubePull: false });
	}

	google.consent = { scope: YOUTUBE_SCOPE, refresh_token: 'dp-refresh-secret' };
	expect((await connectYouTube(30)).location).toBe('/settings?section=youtube');
	expect(pull(30)).toMatchObject({ youtubePull: true, youtubeJob: false, youtubeError: null });
	const stored = userRow(30).youtube_refresh as string;
	expect(stored.startsWith('enc:')).toBe(true);
	expect(stored).not.toContain('dp-refresh-secret');
	await connections.stopYouTubePull(30);
});

test('the pull starts an export once a day, waits for Google, then saves its YouTube Music plays', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
	const google = fakePortability();
	await connectYouTube(31);

	await connections.youtubePullsDue();
	expect(callsTo(google, 'portabilityArchive:initiate').map((c) => c.body)).toEqual([{ resources: ['myactivity.youtube'] }]);
	expect(pull(31)).toMatchObject({ youtubeJob: true });

	// Google hiccups while preparing: the error shows and the export is still waited for.
	google.stateStatus = 503;
	await connections.youtubePullsDue();
	expect(pull(31)).toMatchObject({ youtubeJob: true, youtubeError: 'Backend unavailable.' });
	google.stateStatus = 200;
	await connections.youtubePullsDue();
	expect(playsOf(31)).toEqual([]);

	vi.setSystemTime(new Date('2026-03-01T13:00:00Z'));
	Object.assign(google, { state: 'COMPLETE', exportTime: '2026-03-01T12:30:00Z', archive: activityZip(['Glass Rain', 'Tin Lake - Topic', '2026-02-28T20:00:00Z']) });
	await connections.youtubePullsDue();
	expect(playsOf(31)).toEqual([{ track: 'Glass Rain', played_at: Date.parse('2026-02-28T20:00:00Z') / 1000, source: 'takeout' }]);
	expect(pull(31)).toMatchObject({ youtubePull: true, youtubeJob: false, youtubeError: null, youtubePulledAt: Date.parse('2026-03-01T12:30:00Z') / 1000 });
	expect(db.get("SELECT files, added, skipped_other FROM imports WHERE user_id = 31")).toEqual({ files: 'YouTube Music pull', added: 1, skipped_other: 1 });

	await connections.youtubePullsDue();
	vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));
	await connections.youtubePullsDue();
	expect(callsTo(google, 'portabilityArchive:initiate')).toHaveLength(1);

	vi.setSystemTime(new Date('2026-03-02T12:31:00Z'));
	await connections.youtubePullsDue();
	expect(callsTo(google, 'portabilityArchive:initiate').map((c) => c.body)).toEqual([
		{ resources: ['myactivity.youtube'] },
		{ resources: ['myactivity.youtube'], startTime: '2026-02-28T12:30:00.000Z' }
	]);

	// The same listen comes again in the overlapping export and counts once.
	Object.assign(google, { exportTime: '2026-03-02T12:40:00Z', archive: activityZip(['Glass Rain', 'Tin Lake - Topic', '2026-02-28T20:00:00Z'], ['Salt Hour', 'Tin Lake - Topic', '2026-03-02T08:00:00Z']) });
	await connections.youtubePullsDue();
	expect(playsOf(31).map((p) => p.track)).toEqual(['Glass Rain', 'Salt Hour']);

	await connections.stopYouTubePull(31);
	expect(callsTo(google, 'authorization:reset')).toHaveLength(1);
	expect(pull(31)).toMatchObject({ youtubePull: false, youtubeJob: false, youtubePulledAt: null, youtubeError: null });
});

test("when Google won't refresh someone's access, their pull stops and says so, and everyone else's still runs", async () => {
	const google = fakePortability();
	google.consent = { scope: YOUTUBE_SCOPE, refresh_token: 'revoked-refresh' };
	await connectYouTube(32);
	google.consent = { scope: YOUTUBE_SCOPE, refresh_token: 'good-refresh' };
	await connectYouTube(33);
	google.deadRefresh.add('revoked-refresh');

	await expect(connections.youtubePullsDue()).resolves.toBeUndefined();
	expect(pull(32)).toMatchObject({ youtubePull: false, youtubeJob: false, youtubeError: expect.stringMatching(/connect again/) });
	expect(pull(33)).toMatchObject({ youtubePull: true, youtubeJob: true, youtubeError: null });
	await connections.stopYouTubePull(33);
});

test('access for one time pulls once, then tells the person how to keep pulling', async () => {
	const google = fakePortability();
	Object.assign(google, { accessType: 'ACCESS_TYPE_ONE_TIME', state: 'COMPLETE', exportTime: '2026-04-01T00:00:00Z', archive: activityZip(['Pale Arc', 'Ninefold - Topic', '2026-03-31T10:00:00Z']) });
	await connectYouTube(34);

	await connections.youtubePullsDue();
	await connections.youtubePullsDue();
	expect(playsOf(34).map((p) => p.track)).toEqual(['Pale Arc']);
	expect(callsTo(google, 'authorization:reset')).toHaveLength(1);
	expect(pull(34)).toMatchObject({ youtubePull: false, youtubeError: expect.stringMatching(/30 or 180 days/) });

	const before = google.calls.length;
	await connections.youtubePullsDue();
	expect(google.calls).toHaveLength(before);
});
