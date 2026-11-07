import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { viewOf } from '#lib/server/view.js';
import { periodOf, playsPerMonth, lastMonthId } from '#lib/server/stats.js';
import { reportOf } from '#lib/server/report.js';
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
	const report = reportOf(view, period);
	return {
		...report,
		view,
		years: [...new Set(months.map((m) => m.y))],
		months: months.filter((m) => m.y === period.y).map((m) => ({ ...m, id: periodId(m.y, m.m) })),
		// The page shows the first few; the PDF lists them all.
		newArtists: report.newArtists.slice(0, 5)
	};
};
