import { redirect } from '@sveltejs/kit';
import { lastfmUsername, setLastfmUser } from '#lib/server/recs.js';

export async function GET({ url, cookies, locals }) {
	const back = (msg: string) => redirect(303, `/settings?section=lastfm&error=${encodeURIComponent(msg)}`);
	let saved: { state: string; userId: number } | null = null;
	try { saved = JSON.parse(cookies.get('lastfm_oauth') ?? 'null'); } catch { /* An invalid cookie is rejected below. */ }
	cookies.delete('lastfm_oauth', { path: '/auth' });
	if (!locals.user) redirect(303, '/login');
	const token = url.searchParams.get('token');
	if (!token) back('Last.fm sign-in was cancelled.');
	if (!saved || typeof saved.state !== 'string' || !saved.state || saved.state !== url.searchParams.get('state') || saved.userId !== locals.user!.id) back('Sign-in expired or your account changed. Try again.');
	let name;
	try {
		name = await lastfmUsername(token!);
	} catch {
		back("Last.fm didn't accept the sign-in. Try again.");
	}
	setLastfmUser(locals.user!.id, name!);
	redirect(303, '/settings?section=lastfm');
}
