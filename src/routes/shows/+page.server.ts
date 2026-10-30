import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { get } from '#lib/server/db.js';
import { top } from '#lib/server/stats.js';
import { homeOf, markShowsSeen, removeShow, setHome, unwatch, upcomingShows, watch, watchesOf } from '#lib/server/shows.js';

// Shows are the signed-in person's own: their watchlist, their home, what their assistant found. No ?user= view.
export const load: PageServerLoad = ({ locals }) => {
	const u = locals.user!;
	// Read the shows before marking them seen, so this visit can still point out the new ones.
	const shows = upcomingShows(u.id, u.timezone);
	markShowsSeen(u.id);
	const watches = watchesOf(u.id);
	const watched = new Set(watches.map((w) => w.id));
	return {
		home: homeOf(u.id),
		shows,
		watches,
		// Top artists not watched yet, to add with one click.
		suggestions: top('artist', { ids: [u.id], since: 0, until: Math.floor(Date.now() / 1000) + 1, rankBy: 'plays', tz: u.timezone }, 60)
			.filter((a) => !watched.has(a.id))
			.slice(0, 40)
			.map((a) => ({ id: a.id, name: a.name })),
		hasKey: !!get('SELECT 1 FROM api_tokens WHERE user_id = ?', u.id)
	};
};

export const actions = {
	home: async ({ request, locals }) => {
		const f = await request.formData();
		const miles = Number(f.get('miles'));
		if (!Number.isFinite(miles) || miles < 1 || miles > 3000) return fail(400, { homeError: 'Pick a distance from 1 to 3,000 miles.' });
		setHome(locals.user!.id, String(f.get('location') ?? ''), miles);
		return { homeSaved: true };
	},
	watch: async ({ request, locals }) => {
		if (!watch(locals.user!.id, Number((await request.formData()).get('id')))) return fail(404, { watchError: 'Pick an artist from the list.' });
		return { watched: true };
	},
	unwatch: async ({ request, locals }) => {
		unwatch(locals.user!.id, Number((await request.formData()).get('id')));
		return { watched: false };
	},
	remove: async ({ request, locals }) => {
		removeShow(locals.user!.id, Number((await request.formData()).get('id')));
		return { removed: true };
	}
} satisfies Actions;
