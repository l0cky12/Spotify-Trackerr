import type { Actions, PageServerLoad } from './$types';
import { get } from '#lib/server/db.js';
import { entityPage, setBan, setImage } from '#lib/server/entity.js';
import { bannedIds, recBanned } from '#lib/server/bans.js';
import { similarTracks, spotifySearchUrl } from '#lib/server/recs.js';
import { lastfmApp } from '#lib/server/connections.js';

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
		lastfm: !!lastfmApp(),
		similar: similarTracks(artist.name, t.name).then((l) => {
			const banned = bannedIds(event.locals.user!.id);
			return l.filter((r) => !recBanned(banned, r)).map((r) => ({ ...r, url: spotifySearchUrl(r) }));
		})
	};
};

export const actions = { image: (e) => setImage(e, 'track'), ban: (e) => setBan(e, 'track', true), unban: (e) => setBan(e, 'track', false) } satisfies Actions;
