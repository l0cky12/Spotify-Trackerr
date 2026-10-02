import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { scopeOf } from '#lib/server/view.js';
import { top, countDistinct, type Kind } from '#lib/server/stats.js';

const PER_PAGE = 50;

export const load: PageServerLoad = (event) => {
	const kind = event.params.kind as Kind;
	if (!['track', 'album', 'artist'].includes(kind)) error(404, 'Not found');
	const { view, range, scope } = scopeOf(event);
	const pageNo = Math.max(1, Math.min(2, Number(event.url.searchParams.get('page') ?? 1)));
	const total = Math.min(100, countDistinct(kind, scope));
	return { kind, view, range, pageNo, pages: Math.max(1, Math.ceil(total / PER_PAGE)), offset: (pageNo - 1) * PER_PAGE, items: top(kind, scope, PER_PAGE, (pageNo - 1) * PER_PAGE) };
};
