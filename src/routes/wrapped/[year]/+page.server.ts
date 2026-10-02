import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { viewOf } from '#lib/server/view.js';
import { top, totals, genres, releaseYears, yearDays, newArtistsIn, firstPlay, type Scope } from '#lib/server/stats.js';
import { fromLocal, localizer } from '#lib/time.js';

export const load: PageServerLoad = (event) => {
	const year = Number(event.params.year);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) error(404, 'Not found');
	const view = viewOf(event);
	const loc = localizer(view.tz);
	const first = firstPlay(view.ids);
	const thisYear = loc(Date.now() / 1000).getUTCFullYear();
	const years: number[] = [];
	for (let y = first ? loc(first).getUTCFullYear() : thisYear; y <= thisYear; y++) years.push(y);

	const scope: Scope = { ids: view.ids, since: fromLocal(view.tz, year, 0, 1), until: fromLocal(view.tz, year + 1, 0, 1), rankBy: view.rankBy, tz: view.tz };
	const cal = yearDays(scope, year);
	const best = Object.entries(cal.days).reduce<[string, number] | null>((a, b) => (!a || b[1] > a[1] ? b : a), null);
	return {
		view,
		year,
		years,
		totals: totals(scope),
		newArtists: newArtistsIn(scope),
		tracks: top('track', scope, 5),
		albums: top('album', scope, 5),
		artists: top('artist', scope, 5),
		genres: genres(scope, 8).rows,
		releaseYears: releaseYears(scope),
		days: cal.days,
		months: cal.months,
		bestDay: best ? { month: Number(best[0].split('-')[0]), day: Number(best[0].split('-')[1]), plays: best[1] } : null
	};
};
