import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { listenbrainzAuthUrl, listenbrainzLoginEnabled } from '#lib/server/recs.js';

// Starts "Sign in with ListenBrainz" from Settings, through MusicBrainz's OAuth (ListenBrainz uses MusicBrainz accounts).
export function GET({ url, locals, cookies }) {
	if (!locals.user) redirect(303, '/login');
	if (!listenbrainzLoginEnabled()) redirect(303, '/settings?section=listenbrainz');
	const state = randomBytes(16).toString('base64url');
	cookies.set('listenbrainz_oauth', JSON.stringify({ state, userId: locals.user.id }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600 });
	redirect(302, listenbrainzAuthUrl(`${url.origin}/auth/listenbrainz/callback`, state), { external: true });
}
