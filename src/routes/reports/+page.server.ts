import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { viewOf } from '#lib/server/view.js';
import { periodOf, playsPerMonth } from '#lib/server/stats.js';
import { reportOf } from '#lib/server/report.js';
import { shareOf, sharedPeriods, publishReport, unpublishReport } from '#lib/server/shares.js';
import { localizer, periodId, type TimeUnit } from '#lib/time.js';

// Historical reports: any calendar month or year in the person's recorded history, with the change from the period before.
export const load: PageServerLoad = (event) => {
	const view = viewOf(event);
	const months = playsPerMonth(view.ids, view.tz).months;
	const period = periodOf(view.tz, event.url.searchParams.get('period'));
	if (!period) {
		// Default to this year, or the latest year with plays when this one has none yet.
		const thisYear = localizer(view.tz)(Date.now() / 1000).getUTCFullYear();
		const latest = months.filter((m) => m.plays).at(-1)?.y;
		const year = months.some((m) => m.y === thisYear && m.plays) || !latest ? thisYear : latest;
		redirect(307, `/reports?period=${periodId(year)}${view.readonly ? `&user=${event.url.searchParams.get('user')}` : ''}`);
	}
	return {
		...reportOf(view, period),
		view,
		years: [...new Set(months.map((m) => m.y))],
		months: months.filter((m) => m.y === period.y).map((m) => ({ ...m, id: periodId(m.y, m.m) })),
		// Only your own Report can be published; someone else's or everyone's stays on this server.
		share: view.readonly ? null : shareOf(event.locals.user!.id, period.id),
		shared: view.readonly ? [] : sharedPeriods(event.locals.user!.id),
		// Share links use the public address when one is set, since friends can't reach a Tailscale-only one.
		origin: process.env.SHARE_URL?.replace(/\/+$/, '') || event.url.origin
	};
};

/** The period a publish form names, as a Period of the signer's own time zone. */
async function periodFrom(request: Request, tz: string) {
	const period = periodOf(tz, String((await request.formData()).get('period') ?? ''));
	if (!period) error(400, 'Pick a month (YYYY-MM) or a year (YYYY).');
	return period;
}

export const actions = {
	/** Publishes (or refreshes) a frozen copy of your own Report at a link anyone can open. */
	publish: async (event) => {
		const me = event.locals.user!;
		const period = await periodFrom(event.request, me.timezone);
		// Always the signer's own plays, whatever ?user= the page was showing.
		const rankBy = me.rank_by as 'plays' | 'minutes';
		const report = reportOf({ ids: [me.id], readonly: false, label: null, name: me.display_name, tz: me.timezone, rankBy }, period);
		if (!report.totals.plays) return fail(400, { error: `No plays in ${period.label} to share.` });
		return { published: publishReport(me.id, report, me.time_unit as TimeUnit, rankBy) };
	},
	/** Stops sharing a Report; its link stops working. */
	unpublish: async (event) => {
		const me = event.locals.user!;
		unpublishReport(me.id, (await periodFrom(event.request, me.timezone)).id);
		return { unpublished: true };
	}
} satisfies Actions;
