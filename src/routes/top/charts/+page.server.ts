import type { PageServerLoad } from './$types';
import { scopeOf } from '#lib/server/view.js';
import { heatmapGrid, streaks, firstHeard, firstHeardCount, userClause } from '#lib/server/stats.js';
import { all } from '#lib/server/db.js';

const PER_PAGE = 50;

// Charts that go beyond the top lists: listening heatmap, streaks, and songs by when they were first heard.
export const load: PageServerLoad = (event) => {
	const { view, range, scope } = scopeOf(event);
	const pageNo = Math.max(1, Number(event.url.searchParams.get('page') ?? 1) || 1);
	const timestamps = all(`SELECT played_at FROM plays p WHERE ${userClause(view.ids)} AND p.played_at >= ? AND p.played_at < ?`, scope.since, scope.until).map((r) => r.played_at as number);
	const found = firstHeardCount(scope);
	return {
		view,
		range,
		grid: heatmapGrid(timestamps, view.tz),
		plays: timestamps.length,
		streaks: streaks(view.ids, view.tz, Date.now() / 1000),
		firstHeard: firstHeard(scope, PER_PAGE, (pageNo - 1) * PER_PAGE),
		found,
		pageNo,
		pages: Math.max(1, Math.ceil(Math.min(found, 500) / PER_PAGE)),
		offset: (pageNo - 1) * PER_PAGE
	};
};
