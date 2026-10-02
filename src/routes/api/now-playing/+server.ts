import { get } from '#lib/server/db.js';
import { nowPlaying } from '#lib/server/spotify.js';

// Now playing for yourself, or for someone who made their stats visible.
export async function GET({ url, locals }) {
	const id = Number(url.searchParams.get('user'));
	const allowed = id === locals.user!.id || !!get('SELECT 1 FROM users WHERE id = ? AND public = 1', id);
	if (!allowed) return new Response('Not visible', { status: 404 });
	return Response.json(await nowPlaying(id));
}
