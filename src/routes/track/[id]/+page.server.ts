import type { Actions, PageServerLoad } from './$types';
import { get } from '#lib/server/db.js';
import { entityPage, setImage } from '#lib/server/entity.js';
import { similarTracks, lastfmEnabled, spotifySearchUrl } from '#lib/server/recs.js';

export const load: PageServerLoad = (event) => {
	const e = entityPage(event, 'track');
	const t = e.row;
	const artist = get('SELECT id, name FROM artists WHERE id = ?', t.artist_id)!;
	const album = t.album_id ? get('SELECT id, name, COALESCE(image_override, image) image FROM albums WHERE id = ?', t.album_id) : null;
	return {
		...e,
		image: t.image_override ?? t.image ?? album?.image ?? null,
		artist,
		album,
		lastfm: lastfmEnabled(),
		similar: similarTracks(artist.name, t.name).then((l) => l.map((r) => ({ ...r, url: spotifySearchUrl(r) })))
	};
};

export const actions = { image: (e) => setImage(e, 'track') } satisfies Actions;
