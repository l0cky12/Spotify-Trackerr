import { error, type RequestEvent } from '@sveltejs/kit';
import { all, get, type Row } from './db.js';
import { parseRange, type RangeId } from '../time.js';
import type { Scope } from './stats.js';

/**
 * Whose stats a page shows, from `?user=`: yourself (default), another user who made their stats
 * visible, or `all` for everyone visible on this server combined. Display prefs are always the viewer's.
 */
export function viewOf(event: RequestEvent) {
	const me = event.locals.user!;
	const param = event.url.searchParams.get('user');
	let ids = [me.id as number];
	let target: Row | null = me;
	if (param === 'all') {
		ids = all('SELECT id FROM users WHERE public = 1 OR id = ?', me.id).map((r) => r.id);
		target = null;
	} else if (param && Number(param) !== me.id) {
		target = get('SELECT id, display_name, public FROM users WHERE id = ?', Number(param)) ?? null;
		if (!target || !target.public) error(404, "This person's stats aren't visible.");
		ids = [target.id];
	}
	return {
		ids,
		readonly: target?.id !== me.id,
		label: target ? (target.id === me.id ? null : target.display_name) : 'Everyone',
		tz: me.timezone as string,
		rankBy: me.rank_by as 'plays' | 'minutes'
	};
}

export function scopeOf(event: RequestEvent, fallback: RangeId = '7d') {
	const v = viewOf(event);
	const range = parseRange(event.url.searchParams.get('range'), fallback);
	const until = Math.floor(Date.now() / 1000) + 1;
	const scope: Scope = { ids: v.ids, since: range.secs ? until - range.secs : 0, until, rankBy: v.rankBy, tz: v.tz };
	return { view: v, range: range.id, scope };
}
