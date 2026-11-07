import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { viewOf } from '#lib/server/view.js';
import { periodOf } from '#lib/server/stats.js';
import { reportOf } from '#lib/server/report.js';
import { renderReportPdf } from '#lib/server/report-pdf.js';
import type { TimeUnit } from '#lib/time.js';

// The Report for one month or year as a PDF download, for whoever ?user= names, like the Reports page.
export const GET: RequestHandler = async (event) => {
	const view = viewOf(event);
	const period = periodOf(view.tz, event.url.searchParams.get('period'));
	if (!period) error(400, 'Pick a month (YYYY-MM) or a year (YYYY).');
	const pdf = await renderReportPdf(reportOf(view, period), event.locals.user!.time_unit as TimeUnit);
	return new Response(new Uint8Array(pdf), {
		headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="listening-report-${period.id}.pdf"` }
	});
};
