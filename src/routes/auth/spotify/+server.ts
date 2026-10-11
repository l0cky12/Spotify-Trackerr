import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { spotifyAuthorizeUrl } from '#lib/server/connections.js';

// Starts Spotify sign-in. mode=login uses the server's Spotify app; mode=link (from Settings)
// uses the user's own Spotify app if they set one up.
export function GET({ url, locals, cookies }) {
	const mode = url.searchParams.get('mode') === 'link' && locals.user ? 'link' : 'login';
	const state = randomBytes(16).toString('base64url');
	const app = spotifyAuthorizeUrl(locals.user, mode === 'link', `${url.origin}/auth/spotify/callback`, state);
	if (!app) redirect(303, mode === 'link' ? '/settings?error=' + encodeURIComponent('No Spotify app is set up. Add your own in Settings or ask the admin.') : '/login');
	cookies.set('oauth', JSON.stringify({ state, mode, own: app.own }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600 });
	redirect(302, app.url, { external: true });
}
