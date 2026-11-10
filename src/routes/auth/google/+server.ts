import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { googleAuthUrl, googleLoginEnabled } from '#lib/server/connections.js';

// Starts Google sign-in. mode=login (the login page) signs in or, while sign-up is open, creates an account;
// mode=link (Settings) adds Google as a way to log in to the current account.
export function GET({ url, locals, cookies }) {
	const mode = url.searchParams.get('mode') === 'link' && locals.user ? 'link' : 'login';
	if (!googleLoginEnabled()) redirect(303, mode === 'link' ? '/settings?section=google' : '/login');
	const state = randomBytes(16).toString('base64url');
	cookies.set('google_oauth', JSON.stringify({ state, mode, userId: locals.user?.id ?? null }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600 });
	redirect(302, googleAuthUrl(`${url.origin}/auth/google/callback`, state), { external: true });
}
