import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { scopeOf } from '#lib/server/view.js';
import { top, totals, inGenre } from '#lib/server/stats.js';
import { get } from '#lib/server/db.js';
import { fromLocal } from '#lib/time.js';

export const load: PageServerLoad = (event) => {
	const name = event.params.name;
	if (!get('SELECT 1 FROM artist_genres WHERE genre = ? LIMIT 1', name)) error(404, 'Not found');
	const { view, range, scope } = scopeOf(event);
	// Year in review links here with ?year= so the genre keeps that calendar year instead of a rolling range.
	const year = Number(event.url.searchParams.get('year'));
	const inYear = Number.isInteger(year) && year >= 2000 && year <= 2100;
	if (inYear) Object.assign(scope, { since: fromLocal(view.tz, year, 0, 1), until: fromLocal(view.tz, year + 1, 0, 1) });
	return {
		name,
		view,
		range: inYear ? null : range,
		year: inYear ? year : null,
		totals: totals(scope, inGenre, name),
		tracks: top('track', scope, 10, 0, inGenre, name),
		albums: top('album', scope, 10, 0, inGenre, name),
		artists: top('artist', scope, 10, 0, inGenre, name)
	};
};
