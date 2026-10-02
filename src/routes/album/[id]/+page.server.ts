import type { Actions, PageServerLoad } from './$types';
import { all, get } from '#lib/server/db.js';
import { entityPage, setImage } from '#lib/server/entity.js';
import { userClause } from '#lib/server/stats.js';

export const load: PageServerLoad = (event) => {
	const e = entityPage(event, 'album');
	const artist = get('SELECT id, name FROM artists WHERE id = ?', e.row.artist_id)!;
	const tracks = all(
		`SELECT t.id, t.name, COALESCE(t.image_override, t.image) image, COUNT(*) plays, SUM(p.ms_played) ms
		 FROM plays p JOIN tracks t ON t.id = p.track_id WHERE ${userClause(e.view.ids)} AND p.album_id = ? GROUP BY t.id ORDER BY plays DESC`,
		e.id
	);
	return { ...e, image: e.row.image_override ?? e.row.image, artist, tracks };
};

export const actions = { image: (e) => setImage(e, 'album') } satisfies Actions;
