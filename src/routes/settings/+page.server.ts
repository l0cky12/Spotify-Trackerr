import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { all, get, run, setting, setSetting } from '#lib/server/db.js';
import { checkPassword, createUser, endSession, hashPassword, validUsername } from '#lib/server/auth.js';
import { LINK_LIFETIME, serverAppConfigured, unlink } from '#lib/server/spotify.js';
import { importEntries, readUploads } from '#lib/server/ingest.js';

export const load: PageServerLoad = ({ locals, url }) => {
	const u = locals.user!;
	return {
		u: {
			username: u.username as string | null,
			displayName: u.display_name as string,
			hasPassword: !!u.password_hash,
			timezone: u.timezone as string,
			rankBy: u.rank_by as string,
			public: !!u.public,
			linked: !!u.spotify_refresh,
			lastSync: u.last_sync_at as number | null,
			syncError: u.sync_error as string | null,
			linkExpires: u.spotify_authorized_at ? (u.spotify_authorized_at as number) + LINK_LIFETIME : null,
			ownClientId: u.own_client_id as string | null,
			usesOwnApp: !!u.spotify_own_app,
			isAdmin: !!u.is_admin
		},
		serverApp: serverAppConfigured(),
		callback: `${url.origin}/auth/spotify/callback`,
		imports: all('SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', u.id),
		pending: get('SELECT COUNT(*) n FROM tracks WHERE enriched != 1')!.n as number,
		timezones: Intl.supportedValuesOf('timeZone'),
		error: url.searchParams.get('error'),
		linkedNow: url.searchParams.has('linked'),
		welcome: url.searchParams.has('welcome'),
		admin: u.is_admin
			? {
					allowSignup: setting('allow_signup') === '1',
					users: all('SELECT id, username, display_name, is_admin, spotify_refresh IS NOT NULL linked, (SELECT COUNT(*) FROM plays WHERE user_id = users.id) plays FROM users ORDER BY id')
				}
			: null
	};
};

const requireAdmin = (locals: App.Locals) => {
	if (!locals.user?.is_admin) throw redirect(303, '/settings');
};

export const actions = {
	prefs: async ({ request, locals }) => {
		const f = await request.formData();
		const tz = String(f.get('timezone'));
		if (!Intl.supportedValuesOf('timeZone').includes(tz) && tz !== 'UTC') return fail(400, { section: 'prefs', error: 'Pick a time zone from the list.' });
		const name = String(f.get('display_name') ?? '').trim().slice(0, 60) || locals.user!.display_name;
		run('UPDATE users SET display_name = ?, timezone = ?, rank_by = ?, public = ? WHERE id = ?', name, tz, f.get('rank_by') === 'minutes' ? 'minutes' : 'plays', f.get('public') ? 1 : 0, locals.user!.id);
		return { section: 'prefs', saved: true };
	},
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const u = locals.user!;
		const username = String(f.get('username') ?? u.username ?? '').trim();
		const pw = String(f.get('password') ?? '');
		if (u.password_hash && !checkPassword(String(f.get('current') ?? ''), u.password_hash)) return fail(400, { section: 'password', error: 'Your current password is wrong.' });
		if (!validUsername(username)) return fail(400, { section: 'password', error: 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.' });
		if (pw.length < 8) return fail(400, { section: 'password', error: 'Use a password of at least 8 characters.' });
		if (get('SELECT 1 FROM users WHERE username = ? AND id != ?', username, u.id)) return fail(400, { section: 'password', error: 'That username is taken.' });
		run('UPDATE users SET username = ?, password_hash = ? WHERE id = ?', username, hashPassword(pw), u.id);
		return { section: 'password', saved: true };
	},
	unlink: async ({ locals }) => {
		if (!locals.user!.password_hash) return fail(400, { section: 'spotify', error: 'Set a username and password first; otherwise you could no longer log in.' });
		unlink(locals.user!.id);
		return { section: 'spotify', saved: true };
	},
	ownApp: async ({ request, locals }) => {
		const f = await request.formData();
		const id = String(f.get('client_id') ?? '').trim();
		const secret = String(f.get('client_secret') ?? '').trim();
		if (f.get('clear')) {
			run('UPDATE users SET own_client_id = NULL, own_client_secret = NULL WHERE id = ?', locals.user!.id);
			return { section: 'ownApp', saved: true };
		}
		if (!/^[a-f0-9]{32}$/i.test(id) || !/^[a-f0-9]{32}$/i.test(secret)) return fail(400, { section: 'ownApp', error: 'Client ID and secret are both 32-character codes from the Spotify dashboard.' });
		// ponytail: secret stored in plain text in the server's database; encrypt at rest if the DB ever leaves this box.
		run('UPDATE users SET own_client_id = ?, own_client_secret = ? WHERE id = ?', id, secret, locals.user!.id);
		return { section: 'ownApp', saved: true };
	},
	import: async ({ request, locals }) => {
		const files = (await request.formData()).getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return fail(400, { section: 'import', error: 'Choose at least one file.' });
		try {
			const parsed = readUploads(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
			return { section: 'import', summary: importEntries(locals.user!.id, parsed) };
		} catch (e) {
			return fail(400, { section: 'import', error: (e as Error).message });
		}
	},
	deleteAccount: async ({ request, locals, cookies }) => {
		const u = locals.user!;
		if (String((await request.formData()).get('confirm')) !== 'DELETE') return fail(400, { section: 'account', error: 'Type DELETE to confirm.' });
		const otherAdmins = get('SELECT COUNT(*) n FROM users WHERE is_admin = 1 AND id != ?', u.id)!.n;
		const others = get('SELECT COUNT(*) n FROM users WHERE id != ?', u.id)!.n;
		if (u.is_admin && !otherAdmins && others) return fail(400, { section: 'account', error: 'Make someone else an admin before deleting the only admin account.' });
		endSession(cookies);
		run('DELETE FROM users WHERE id = ?', u.id);
		redirect(303, '/login');
	},
	adminSignup: async ({ request, locals }) => {
		requireAdmin(locals);
		setSetting('allow_signup', (await request.formData()).get('allow') ? '1' : '0');
		return { section: 'admin', saved: true };
	},
	adminCreate: async ({ request, locals }) => {
		requireAdmin(locals);
		const f = await request.formData();
		const username = String(f.get('username') ?? '').trim();
		const pw = String(f.get('password') ?? '');
		if (!validUsername(username)) return fail(400, { section: 'admin', error: 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.' });
		if (pw.length < 8) return fail(400, { section: 'admin', error: 'Use a password of at least 8 characters.' });
		if (get('SELECT 1 FROM users WHERE username = ?', username)) return fail(400, { section: 'admin', error: 'That username is taken.' });
		createUser({ username, password: pw, display_name: username, timezone: locals.user!.timezone });
		return { section: 'admin', saved: true };
	},
	adminToggle: async ({ request, locals }) => {
		requireAdmin(locals);
		const id = Number((await request.formData()).get('id'));
		if (id === locals.user!.id) return fail(400, { section: 'admin', error: "You can't remove your own admin access." });
		run('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?', id);
		return { section: 'admin', saved: true };
	},
	adminDelete: async ({ request, locals }) => {
		requireAdmin(locals);
		const id = Number((await request.formData()).get('id'));
		if (id === locals.user!.id) return fail(400, { section: 'admin', error: 'Delete your own account from the Account section instead.' });
		run('DELETE FROM users WHERE id = ?', id);
		return { section: 'admin', saved: true };
	}
} satisfies Actions;
