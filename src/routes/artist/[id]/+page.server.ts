import type { Actions, PageServerLoad } from './$types';
import { all } from '#lib/server/db.js';
import { entityPage, setBan, setImage } from '#lib/server/entity.js';
import { bannedIds, recBanned } from '#lib/server/bans.js';
import { top } from '#lib/server/stats.js';
import { similarArtists, spotifySearchUrl } from '#lib/server/recs.js';
import { lastfmApp } from '#lib/server/connections.js';

export const load: PageServerLoad = (event) => {
	const e = entityPage(event, 'artist');
	const scope = { ids: e.view.ids, since: 0, until: Math.floor(Date.now() / 1000) + 1, rankBy: e.view.rankBy, tz: e.view.tz };
	const filter = `AND p.artist_id = ${e.id}`;
	return {
		...e,
		image: e.row.image_override ?? e.row.image,
		genres: all('SELECT genre FROM artist_genres WHERE artist_id = ?', e.id).map((g) => g.genre as string),
		tracks: top('track', scope, 15, 0, filter),
		albums: top('album', scope, 12, 0, filter),
		lastfm: !!lastfmApp(),
		similar: similarArtists(e.row.name).then((l) => {
			const banned = bannedIds(event.locals.user!.id);
			return l.filter((r) => !recBanned(banned, r)).map((r) => ({ ...r, url: r.artistId ? '' : spotifySearchUrl(r) }));
		})
	};
};

export const actions = { image: (e) => setImage(e, 'artist'), ban: (e) => setBan(e, 'artist', true), unban: (e) => setBan(e, 'artist', false) } satisfies Actions;
