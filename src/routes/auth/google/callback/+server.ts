import { redirect } from '@sveltejs/kit';
import { createUser, signupOpen, startSession } from '#lib/server/auth.js';
import { connectYouTubePull, exchangeGoogleCode, googleOwner, saveGoogleLink } from '#lib/server/connections.js';

const HOME = { login: '/login', link: '/settings?section=google', youtube: '/settings?section=youtube' };

export async function GET({ url, cookies, locals }) {
	const back = (home: string, msg: string) => redirect(303, `${home}${home.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`);
	let saved: { state: string; mode: keyof typeof HOME; userId: number | null } | null = null;
	try { saved = JSON.parse(cookies.get('google_oauth') ?? 'null'); } catch { /* An invalid cookie is rejected below. */ }
	cookies.delete('google_oauth', { path: '/auth' });
	const home = HOME[saved?.mode === 'link' || saved?.mode === 'youtube' ? saved.mode : 'login'];
	if (url.searchParams.get('error')) back(home, saved?.mode === 'youtube' ? 'You cancelled on Google, so nothing was connected.' : 'Google sign-in was cancelled.');
	if (!saved || typeof saved.state !== 'string' || !saved.state || saved.state !== url.searchParams.get('state')) back(home, 'Sign-in expired. Try again.');

	if (saved!.mode === 'youtube') {
		if (!locals.user) back('/login', 'Log in first.');
		if (saved!.userId !== locals.user!.id) back(home, 'Sign-in expired or your account changed. Try again.');
		try {
			await connectYouTubePull(locals.user!.id, url.searchParams.get('code') ?? '', `${url.origin}/auth/google/callback`);
		} catch (e) {
			back(home, (e as Error).message);
		}
		redirect(303, home);
	}

	let account;
	try {
		account = await exchangeGoogleCode(url.searchParams.get('code') ?? '', `${url.origin}/auth/google/callback`);
	} catch {
		back(home, "Google didn't accept the sign-in. Try again.");
	}
	const owner = googleOwner(account!.googleId);

	if (saved!.mode === 'link') {
		if (!locals.user) back('/login', 'Log in first.');
		if (saved!.userId !== locals.user!.id) back(home, 'Sign-in expired or your account changed. Try again.');
		if (owner && owner !== locals.user!.id) back(home, 'That Google account is already linked to another user on this server.');
		saveGoogleLink(locals.user!.id, account!);
		redirect(303, home);
	}

	// This server can be reached from the internet, so an unknown Google account only gets an account while sign-up is open.
	if (!owner && !signupOpen()) back('/login', 'No account here is linked to that Google account. Sign in another way and link Google in Settings.');
	const id = owner ?? createUser({ display_name: account!.name ?? account!.email ?? 'Google user' });
	saveGoogleLink(id, account!);
	startSession(cookies, id, url.protocol === 'https:');
	redirect(303, owner ? '/' : '/settings?welcome=1');
}
