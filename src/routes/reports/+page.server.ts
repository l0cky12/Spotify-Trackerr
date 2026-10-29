import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { viewOf } from '#lib/server/view.js';
import { top, totals, genres, busiestDay, delta, periodOf, playsPerMonth, lastMonthId, timeSeries, newArtists, type Scope } from '#lib/server/stats.js';
import { periodId } from '#lib/time.js';

// Historical reports: any calendar month or year in the person's recorded history, with the change from the period before.
export const load: PageServerLoad = (event) => {
	const view = viewOf(event);
	const months = playsPerMonth(view.ids, view.tz).months;
	const period = periodOf(view.tz, event.url.searchParams.get('period'));
	if (!period) {
		// Default to the last finished month, or the latest month with plays when that one is empty.
		const last = lastMonthId(view.tz, Date.now() / 1000);
		const latest = months.filter((m) => m.plays).at(-1);
		const id = months.some((m) => periodId(m.y, m.m) === last && m.plays) || !latest ? last : periodId(latest.y, latest.m);
		redirect(307, `/reports?period=${id}${view.readonly ? `&user=${event.url.searchParams.get('user')}` : ''}`);
	}
	const scope: Scope = { ids: view.ids, since: period.since, until: period.until, rankBy: view.rankBy, tz: view.tz };
	const prev: Scope = { ...scope, since: period.prev.since, until: period.prev.until };
	const cur = totals(scope);
	const years = [...new Set(months.map((m) => m.y))];
	return {
		view,
		period: { id: period.id, label: period.label, y: period.y, m: period.m ?? null, prev: period.prev },
		years,
		months: months.filter((m) => m.y === period.y).map((m) => ({ ...m, id: periodId(m.y, m.m) })),
		totals: cur,
		delta: delta(cur, totals(prev)),
		tracks: top('track', scope, 10),
		albums: top('album', scope, 10),
		artists: top('artist', scope, 10),
		genres: genres(scope, 10).rows,
		newArtists: newArtists(scope, 5),
		busiest: busiestDay(scope),
		series: cur.plays ? timeSeries(scope, []) : null
	};
};
