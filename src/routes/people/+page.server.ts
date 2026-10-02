import type { PageServerLoad } from './$types';
import { all, get } from '#lib/server/db.js';
import { fromLocal, localizer } from '#lib/time.js';

export const load: PageServerLoad = ({ locals }) => {
	const me = locals.user!;
	const d = localizer(me.timezone)(Date.now() / 1000);
	const midnight = fromLocal(me.timezone, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	const people = all('SELECT id, display_name, spotify_refresh IS NOT NULL linked FROM users WHERE public = 1 AND id != ? ORDER BY display_name', me.id).map((p) => ({
		...p,
		today: get('SELECT COUNT(*) n FROM plays WHERE user_id = ? AND played_at >= ?', p.id, midnight)!.n as number
	}));
	return { people, mePublic: !!me.public };
};
