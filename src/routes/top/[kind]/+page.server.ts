import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { scopeOf } from '#lib/server/view.js';
import { top, countDistinct, SORTS, type Kind, type Sort } from '#lib/server/stats.js';

const PER_PAGE = 50;

export const load: PageServerLoad = (event) => {
	const kind = event.params.kind as Kind;
	if (!['track', 'album', 'artist'].includes(kind)) error(404, 'Not found');
	const { view, range, scope } = scopeOf(event);
	const q = event.url.searchParams;
	// ?sort= overrides the person's rank_by setting for this page; artwork tiles show unless ?view=list asks for the list.
	const sort = (SORTS.includes(q.get('sort') as Sort) ? q.get('sort') : view.rankBy) as Sort;
	scope.sort = sort;
	const grid = q.get('view') !== 'list';
	const pageNo = Math.max(1, Math.min(2, Number(q.get('page') ?? 1)));
	const total = Math.min(100, countDistinct(kind, scope));
	return { kind, view, range, sort, grid, pageNo, pages: Math.max(1, Math.ceil(total / PER_PAGE)), offset: (pageNo - 1) * PER_PAGE, items: top(kind, scope, PER_PAGE, (pageNo - 1) * PER_PAGE) };
};
