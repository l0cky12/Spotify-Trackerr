import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { sharedReport } from '#lib/server/shares.js';

// A Report someone published, for anyone with the link: no sign-in, no links into the rest of the server.
export const load: PageServerLoad = ({ params, setHeaders }) => {
	const shared = sharedReport(params.token);
	if (!shared) error(404, 'This report isn’t shared any more, or the link is wrong.');
	setHeaders({ 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' });
	return shared;
};
