import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { all, get, run } from '#lib/server/db.js';
import { scopeOf } from '#lib/server/view.js';
import { userClause } from '#lib/server/stats.js';
import { fromLocal } from '#lib/time.js';

const PER_PAGE = 100;

export const load: PageServerLoad = (event) => {
	const q = event.url.searchParams;
	const { view, range, scope } = scopeOf(event, 'all');
	const where = [userClause(view.ids), 'p.played_at >= ?', 'p.played_at < ?'];
	const params: (string | number)[] = [scope.since, scope.until];
	let filterName: string | null = null;

	for (const kind of ['track', 'album', 'artist'] as const) {
		const id = Number(q.get(kind));
		if (!id) continue;
		where.push(`p.${kind}_id = ?`);
		params.push(id);
		filterName = get(`SELECT name FROM ${kind}s WHERE id = ?`, id)?.name ?? null;
	}
	const month = q.get('month')?.match(/^(\d{4})-(\d{2})$/);
	if (month) {
		const y = Number(month[1]),
			m = Number(month[2]) - 1;
		where.push('p.played_at >= ?', 'p.played_at < ?');
		params.push(fromLocal(view.tz, y, m), fromLocal(view.tz, y, m + 1));
	}
	const search = q.get('q')?.trim();
	if (search) {
		where.push('(t.name LIKE ? OR a.name LIKE ? OR al.name LIKE ?)');
		const like = `%${search.replace(/[%_]/g, '')}%`;
		params.push(like, like, like);
	}
	const base = `FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = p.artist_id LEFT JOIN albums al ON al.id = p.album_id WHERE ${where.join(' AND ')}`;
	const total = get(`SELECT COUNT(*) n ${base}`, ...params)!.n as number;

	// Paging walks back in time: `before` is a raw timestamp cursor, `date` jumps to the end of a local day.
	let before = Number(q.get('before')) || null;
	const date = q.get('date')?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (date) before = fromLocal(view.tz, Number(date[1]), Number(date[2]) - 1, Number(date[3]) + 1);
	const pageParams = before ? [...params, before] : params;
	const plays = all(
		`SELECT p.id, p.played_at, p.ms_played, p.source, t.id track_id, t.name track, t.spotify_id, a.id artist_id, a.name artist, al.id album_id, al.name album,
		        COALESCE(t.image_override, t.image, al.image_override, al.image) image
		 ${base} ${before ? 'AND p.played_at < ?' : ''} ORDER BY p.played_at DESC LIMIT ${PER_PAGE + 1}`,
		...pageParams
	);
	const more = plays.length > PER_PAGE;
	return { view, range, total, plays: plays.slice(0, PER_PAGE), next: more ? plays[PER_PAGE - 1].played_at : null, before, filterName, search: search ?? '', month: q.get('month') };
};

export const actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const r = run('DELETE FROM plays WHERE id = ? AND user_id = ?', id, locals.user!.id);
		if (!r.changes) return fail(404, { error: 'That play was already deleted.' });
		return { deleted: true };
	}
} satisfies Actions;
