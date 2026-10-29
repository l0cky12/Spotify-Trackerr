import type { LayoutServerLoad } from './$types';
import { connectionStatus } from '#lib/server/connections.js';
import { get } from '#lib/server/db.js';
import type { TimeUnit } from '#lib/time.js';

export const load: LayoutServerLoad = ({ locals, url }) => {
	const u = locals.user;
	if (!u) return { me: null };
	const who = url.searchParams.get('user');
	const viewing = who === 'all' ? 'Everyone on this server' : who && Number(who) !== u.id ? (get('SELECT display_name FROM users WHERE id = ? AND public = 1', Number(who))?.display_name ?? null) : null;
	return {
		me: {
			id: u.id as number,
			name: u.display_name as string,
			avatar: (u.avatar as string | null) ?? null,
			isAdmin: !!u.is_admin,
			tz: u.timezone as string,
			rankBy: u.rank_by as 'plays' | 'minutes',
			timeUnit: u.time_unit as TimeUnit,
			spotify: connectionStatus(u)
		},
		viewing
	};
};
