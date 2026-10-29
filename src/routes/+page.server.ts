import type { PageServerLoad } from './$types';
import { scopeOf } from '#lib/server/view.js';
import { top, totals, genres, releaseYears, timeSeries, countDistinct } from '#lib/server/stats.js';
import { get } from '#lib/server/db.js';

export const load: PageServerLoad = (event) => {
	const { view, range, scope } = scopeOf(event);
	const tracks = top('track', scope, 10);
	const albums = top('album', scope, 16);
	const artists = top('artist', scope, 10);
	const trendArtists = artists.slice(0, 8).map((a) => ({ id: a.id as number, name: a.name as string }));
	const hasAny = !!get(`SELECT 1 FROM plays WHERE user_id IN (${view.ids.join(',')}) LIMIT 1`);
	return {
		view,
		range,
		since: scope.since,
		hasAny,
		totals: totals(scope),
		albumsCount: countDistinct('album', scope),
		tracks,
		albums,
		artists,
		genres: genres(scope),
		years: releaseYears(scope),
		series: timeSeries(scope, trendArtists),
		otherViewers: !!get('SELECT 1 FROM users WHERE public = 1 AND id != ?', event.locals.user!.id)
	};
};
