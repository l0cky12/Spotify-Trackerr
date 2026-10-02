import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { buildDiscover, savedDiscover, lastfmEnabled, spotifySearchUrl, type Rec } from '#lib/server/recs.js';

const withUrl = (l: Rec[]) => l.map((r) => ({ ...r, url: spotifySearchUrl(r) }));

export const load: PageServerLoad = ({ locals }) => {
	const saved = savedDiscover(locals.user!.id);
	return {
		enabled: lastfmEnabled(),
		lastfmUser: locals.user!.lastfm_user as string | null,
		picks: saved && { ...saved, artists: withUrl(saved.artists), albums: withUrl(saved.albums), songs: withUrl(saved.songs) }
	};
};

export const actions = {
	refresh: async ({ locals }) => {
		if (!lastfmEnabled()) return fail(400, { error: 'Discover needs Last.fm set up on the server.' });
		try {
			const r = await buildDiscover(locals.user!);
			if (!r.artists.length && !r.songs.length) return fail(502, { error: "Last.fm didn't return any new music for your top artists. Try again later." });
			return { refreshed: true };
		} catch {
			return fail(502, { error: 'Could not refresh your picks or verify your Last.fm history. Try again later.' });
		}
	}
} satisfies Actions;
