import type { Actions, PageServerLoad } from './$types';
import { all } from '#lib/server/db.js';
import { entityPage, setImage } from '#lib/server/entity.js';
import { top } from '#lib/server/stats.js';
import { similarArtists, lastfmEnabled, spotifySearchUrl } from '#lib/server/recs.js';

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
		lastfm: lastfmEnabled(),
		similar: similarArtists(e.row.name).then((l) => l.map((r) => ({ ...r, url: r.artistId ? '' : spotifySearchUrl(r) })))
	};
};

export const actions = { image: (e) => setImage(e, 'artist') } satisfies Actions;
