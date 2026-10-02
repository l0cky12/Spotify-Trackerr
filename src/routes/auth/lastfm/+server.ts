import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { lastfmAuthUrl, lastfmLoginEnabled } from '#lib/server/recs.js';

// Starts "Sign in with Last.fm" from Settings. Last.fm sends the user back to the callback with ?token=.
export function GET({ url, locals, cookies }) {
	if (!locals.user) redirect(303, '/login');
	if (!lastfmLoginEnabled()) redirect(303, '/settings?section=lastfm');
	// Last.fm has no state parameter, so ours rides along in the callback address.
	const state = randomBytes(16).toString('base64url');
	cookies.set('lastfm_oauth', JSON.stringify({ state, userId: locals.user.id }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600 });
	redirect(302, lastfmAuthUrl(`${url.origin}/auth/lastfm/callback?state=${state}`), { external: true });
}
