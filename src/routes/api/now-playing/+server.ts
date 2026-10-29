import { get } from '#lib/server/db.js';
import { nowPlaying } from '#lib/server/spotify.js';
import { bannedIds, recBanned } from '#lib/server/bans.js';

// Now playing for yourself, or for someone who made their stats visible. A song its listener banned isn't shown.
export async function GET({ url, locals }) {
	const id = Number(url.searchParams.get('user'));
	const allowed = id === locals.user!.id || !!get('SELECT 1 FROM users WHERE id = ? AND public = 1', id);
	if (!allowed) return new Response('Not visible', { status: 404 });
	const playing = (await nowPlaying(id)) as { artist: string; trackId: number | null } | null;
	return Response.json(playing && recBanned(bannedIds(id), playing) ? null : playing);
}
