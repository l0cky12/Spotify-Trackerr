import { redirect } from '@sveltejs/kit';
import { listenbrainzUsername, setListenbrainzUser } from '#lib/server/recs.js';

export async function GET({ url, cookies, locals }) {
	const back = (msg: string) => redirect(303, `/settings?section=listenbrainz&error=${encodeURIComponent(msg)}`);
	let saved: { state: string; userId: number } | null = null;
	try { saved = JSON.parse(cookies.get('listenbrainz_oauth') ?? 'null'); } catch { /* An invalid cookie is rejected below. */ }
	cookies.delete('listenbrainz_oauth', { path: '/auth' });
	if (!locals.user) redirect(303, '/login');
	const code = url.searchParams.get('code');
	if (!code) back('ListenBrainz sign-in was cancelled.');
	if (!saved || typeof saved.state !== 'string' || !saved.state || saved.state !== url.searchParams.get('state') || saved.userId !== locals.user!.id) back('Sign-in expired or your account changed. Try again.');
	let name;
	try {
		name = await listenbrainzUsername(code!, `${url.origin}/auth/listenbrainz/callback`);
	} catch (e) {
		back((e as { status?: number }).status === 404 ? "That MusicBrainz account hasn't used ListenBrainz yet. Open listenbrainz.org and sign in there once, then try again." : "MusicBrainz didn't accept the sign-in. Try again.");
	}
	setListenbrainzUser(locals.user!.id, name!);
	redirect(303, '/settings?section=listenbrainz');
}
