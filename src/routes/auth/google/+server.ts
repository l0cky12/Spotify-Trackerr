import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { googleAuthUrl, googleLoginEnabled } from '#lib/server/connections.js';

// Starts Google sign-in. mode=login (the login page) signs in or, while sign-up is open, creates an account;
// mode=link (Settings) adds Google as a way to log in to the current account;
// mode=youtube (Settings) asks the current account's Google user for access to their YouTube history, for a YouTube Music pull.
export function GET({ url, locals, cookies }) {
	const asked = url.searchParams.get('mode');
	if (asked === 'youtube' && !locals.user) redirect(303, '/login');
	const mode = asked === 'youtube' ? 'youtube' : asked === 'link' && locals.user ? 'link' : 'login';
	if (!googleLoginEnabled()) redirect(303, mode === 'login' ? '/login' : `/settings?section=${mode === 'link' ? 'google' : 'youtube'}`);
	const state = randomBytes(16).toString('base64url');
	cookies.set('google_oauth', JSON.stringify({ state, mode, userId: locals.user?.id ?? null }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600 });
	redirect(302, googleAuthUrl(`${url.origin}/auth/google/callback`, state, mode === 'youtube'), { external: true });
}
