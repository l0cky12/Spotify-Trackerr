import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { get } from '#lib/server/db.js';
import { checkPassword, createUser, loginBlocked, loginFailed, loginSucceeded, signupOpen, startSession, userCount, validUsername } from '#lib/server/auth.js';
import { serverAppConfigured } from '#lib/server/spotify.js';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/');
	return { signupOpen: signupOpen(), firstUser: userCount() === 0, spotify: serverAppConfigured(), error: url.searchParams.get('error') };
};

export const actions = {
	login: async ({ request, cookies, url, getClientAddress }) => {
		const f = await request.formData();
		const username = String(f.get('username') ?? '').trim();
		const password = String(f.get('password') ?? '');
		const throttleKey = `${getClientAddress()}|${username.toLowerCase()}`;
		if (loginBlocked(throttleKey)) return fail(429, { username, signup: false, error: 'Too many attempts. Wait 15 minutes and try again.' });
		const user = get('SELECT id, password_hash FROM users WHERE username = ?', username);
		if (!user || !checkPassword(password, user.password_hash)) {
			loginFailed(throttleKey);
			return fail(400, { username, signup: false, error: "That username and password don't match." });
		}
		loginSucceeded(throttleKey);
		startSession(cookies, user.id, url.protocol === 'https:');
		redirect(303, '/');
	},
	signup: async ({ request, cookies, url }) => {
		if (!signupOpen()) return fail(403, { username: '', signup: true, error: 'Sign-up is closed. Ask the admin to create an account for you.' });
		const f = await request.formData();
		const username = String(f.get('username') ?? '').trim();
		const password = String(f.get('password') ?? '');
		const timezone = String(f.get('timezone') ?? 'UTC');
		if (!validUsername(username)) return fail(400, { username, signup: true, error: 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.' });
		if (password.length < 8) return fail(400, { username, signup: true, error: 'Use a password of at least 8 characters.' });
		if (get('SELECT 1 FROM users WHERE username = ?', username)) return fail(400, { username, signup: true, error: 'That username is taken.' });
		const id = createUser({ username, password, display_name: username, timezone });
		startSession(cookies, id, url.protocol === 'https:');
		redirect(303, '/settings');
	}
} satisfies Actions;
