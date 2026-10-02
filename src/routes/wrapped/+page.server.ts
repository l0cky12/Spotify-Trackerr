import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { localizer } from '#lib/time.js';

// /wrapped opens this year's review.
export const load: PageServerLoad = ({ url, locals }) => {
	const year = localizer(locals.user!.timezone)(Date.now() / 1000).getUTCFullYear();
	redirect(307, `/wrapped/${year}${url.search}`);
};
