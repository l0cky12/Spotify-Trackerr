import { redirect } from '@sveltejs/kit';
import { get } from '#lib/server/db.js';
import { createUser, startSession } from '#lib/server/auth.js';
import { appFor, exchangeCode, saveLink, SpotifyError } from '#lib/server/spotify.js';

export async function GET({ url, cookies, locals }) {
	const back = (path: string, msg: string) => redirect(303, `${path}?error=${encodeURIComponent(msg)}`);
	const saved = JSON.parse(cookies.get('oauth') ?? 'null') as { state: string; mode: 'login' | 'link'; own: boolean } | null;
	cookies.delete('oauth', { path: '/auth' });
	const home = saved?.mode === 'link' ? '/settings' : '/login';
	if (url.searchParams.get('error')) back(home, 'Spotify sign-in was cancelled.');
	if (!saved || saved.state !== url.searchParams.get('state')) back(home, 'Sign-in expired. Try again.');

	const app = appFor(locals.user, saved!.own);
	if (!app) back(home, 'No Spotify app is set up.');
	let result;
	try {
		result = await exchangeCode(app!, url.searchParams.get('code') ?? '', `${url.origin}/auth/spotify/callback`);
	} catch (e) {
		back(home, e instanceof SpotifyError ? e.message : 'Could not reach Spotify. Try again.');
	}
	const { tokens, profile } = result!;
	const owner = get('SELECT id FROM users WHERE spotify_id = ?', profile.id);

	if (saved!.mode === 'link') {
		if (!locals.user) back('/login', 'Log in first.');
		if (owner && owner.id !== locals.user!.id) back('/settings', 'That Spotify account is already linked to another user on this server.');
		saveLink(locals.user!.id, profile.id, tokens, app!.own);
		redirect(303, '/settings?linked=1');
	}

	// Log in with Spotify: existing link signs in; otherwise create an account (the first one is admin).
	const id = owner?.id ?? createUser({ display_name: profile.display_name || profile.id });
	saveLink(id, profile.id, tokens, app!.own);
	startSession(cookies, id, url.protocol === 'https:');
	redirect(303, owner ? '/' : '/settings?welcome=1');
}
