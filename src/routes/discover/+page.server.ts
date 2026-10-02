import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { buildDiscover, savedDiscover, listenbrainzToken, spotifySearchUrl } from '#lib/server/recs.js';
import { savePlaylist, SpotifyError } from '#lib/server/spotify.js';

export const load: PageServerLoad = ({ locals }) => {
	const saved = savedDiscover(locals.user!.id);
	return {
		enabled: !!listenbrainzToken(locals.user),
		linked: !!locals.user!.spotify_refresh,
		playlist: saved && { ...saved, songs: saved.songs.map((s) => ({ ...s, url: spotifySearchUrl(s) })) }
	};
};

export const actions = {
	refresh: async ({ locals }) => {
		const token = listenbrainzToken(locals.user);
		if (!token) return fail(400, { error: 'Discover needs a ListenBrainz token. Add yours in Settings.' });
		const r = await buildDiscover(locals.user!.id, token);
		if (!r.songs.length) return fail(502, { error: "ListenBrainz didn't return any new songs for your top artists. Try again later." });
		return { refreshed: true };
	},
	save: async ({ locals }) => {
		const saved = savedDiscover(locals.user!.id);
		if (!saved) return fail(400, { error: 'Make a playlist first.' });
		try {
			const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
			const r = await savePlaylist(locals.user!, `Discover, ${day}`, saved.songs.map((s) => ({ artist: s.artist, title: s.title!, spotifyId: s.spotifyId })));
			return { savedUrl: r.url, savedCount: r.count };
		} catch (e) {
			return fail(502, { error: e instanceof SpotifyError ? `Spotify refused the playlist (${e.status}). Reconnect Spotify in Settings and try again.` : (e as Error).message });
		}
	}
} satisfies Actions;
