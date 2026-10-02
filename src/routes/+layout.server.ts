import type { LayoutServerLoad } from './$types';
import { LINK_LIFETIME } from '#lib/server/spotify.js';
import { get } from '#lib/server/db.js';

export const load: LayoutServerLoad = ({ locals, url }) => {
	const u = locals.user;
	if (!u) return { me: null };
	const expires = u.spotify_authorized_at ? u.spotify_authorized_at + LINK_LIFETIME : null;
	const who = url.searchParams.get('user');
	const viewing = who === 'all' ? 'Everyone on this server' : who && Number(who) !== u.id ? (get('SELECT display_name FROM users WHERE id = ? AND public = 1', Number(who))?.display_name ?? null) : null;
	return {
		me: {
			id: u.id as number,
			name: u.display_name as string,
			isAdmin: !!u.is_admin,
			tz: u.timezone as string,
			rankBy: u.rank_by as 'plays' | 'minutes',
			spotifyLinked: !!u.spotify_refresh,
			reauth: u.sync_error === 'reauth',
			linkExpires: expires,
			expiringSoon: !!expires && expires - Date.now() / 1000 < 14 * 86400
		},
		viewing
	};
};
