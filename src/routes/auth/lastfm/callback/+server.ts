import { redirect } from '@sveltejs/kit';
import { run } from '#lib/server/db.js';
import { lastfmUsername } from '#lib/server/recs.js';

export async function GET({ url, cookies, locals }) {
	const back = (msg: string) => redirect(303, `/settings?section=lastfm&error=${encodeURIComponent(msg)}`);
	const state = cookies.get('lastfm_oauth');
	cookies.delete('lastfm_oauth', { path: '/auth' });
	if (!locals.user) redirect(303, '/login');
	const token = url.searchParams.get('token');
	if (!token) back('Last.fm sign-in was cancelled.');
	if (!state || state !== url.searchParams.get('state')) back('Sign-in expired. Try again.');
	let name;
	try {
		name = await lastfmUsername(token!);
	} catch {
		back("Last.fm didn't accept the sign-in. Try again.");
	}
	run('UPDATE users SET lastfm_user = ? WHERE id = ?', name!, locals.user!.id);
	redirect(303, '/settings?section=lastfm');
}
