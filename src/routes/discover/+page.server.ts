import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { buildDiscover, savedDiscover, spotifySearchUrl, type Rec } from '#lib/server/recs.js';
import { lastfmApp } from '#lib/server/connections.js';
import { get } from '#lib/server/db.js';
import { bannedIds, bannedKeys, recBanned, type Banned } from '#lib/server/bans.js';

type Keys = ReturnType<typeof bannedKeys>;
// The seed a pick says it's like, unless that seed has been banned since.
const seedBanned = (r: Rec, keys: Keys) => !!r.why && (r.title ? !!r.whyBy && keys.song(r.whyBy, r.why) : keys.artist(r.why));
// Saved picks are filtered as they're shown, so a ban made since the last refresh still takes them out.
const withUrl = (l: Rec[], banned: Banned, keys: Keys) =>
	l.filter((r) => !recBanned(banned, r)).map((r) => ({ ...r, why: seedBanned(r, keys) ? undefined : r.why, url: spotifySearchUrl(r) }));

export const load: PageServerLoad = ({ locals }) => {
	const saved = savedDiscover(locals.user!.id);
	const banned = bannedIds(locals.user!.id);
	const keys = bannedKeys(locals.user!.id);
	return {
		enabled: !!lastfmApp(),
		lastfmUser: locals.user!.lastfm_user as string | null,
		listenbrainzUser: locals.user!.listenbrainz_user as string | null,
		checking: get('SELECT COUNT(*) n FROM tracks WHERE credits_done = 0 AND spotify_id IS NOT NULL')!.n as number,
		picks: saved && {
			...saved,
			seeds: saved.seeds.filter((s) => !keys.artist(s)),
			artists: withUrl(saved.artists, banned, keys),
			albums: withUrl(saved.albums, banned, keys),
			songs: withUrl(saved.songs, banned, keys)
		}
	};
};

export const actions = {
	refresh: async ({ locals }) => {
		if (!lastfmApp()) return fail(400, { error: 'Discover needs Last.fm turned on for this server.' });
		try {
			const r = await buildDiscover(locals.user!);
			if (!r.artists.length && !r.songs.length) return fail(502, { error: "Last.fm didn't return any new music for your top artists. Try again later." });
			return { refreshed: true };
		} catch {
			return fail(502, { error: 'Could not refresh your picks or verify your Last.fm history. Try again later.' });
		}
	}
} satisfies Actions;
