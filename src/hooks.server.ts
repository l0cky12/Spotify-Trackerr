import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { userFromSession } from '#lib/server/auth.js';
import { startJobs } from '#lib/server/jobs.js';

if (!building) startJobs();

const PUBLIC = ['/login', '/auth/'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = userFromSession(event.cookies.get('session'));
	const path = event.url.pathname;
	if (!event.locals.user && !PUBLIC.some((p) => path === p || path.startsWith(p))) {
		if (path.startsWith('/api/')) return new Response('Not signed in', { status: 401 });
		redirect(303, '/login');
	}
	return resolve(event);
};
