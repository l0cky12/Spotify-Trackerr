import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { all, get } from '#lib/server/db.js';
import { scopeOf } from '#lib/server/view.js';
import { userClause } from '#lib/server/stats.js';
import { deletePlay, deletePlays, countPlays, relinkPlay, setPlayedAt, playOf, type BulkFilter } from '#lib/server/plays.js';
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
	const filterKind = (['track', 'album', 'artist'] as const).find((k) => Number(q.get(k))) ?? null;
	return {
		view,
		range,
		total,
		plays: plays.slice(0, PER_PAGE),
		next: more ? plays[PER_PAGE - 1].played_at : null,
		before,
		filterName,
		filterKind,
		filterId: filterKind ? Number(q.get(filterKind)) : null,
		search: search ?? '',
		month: q.get('month')
	};
};

/** A local 'YYYY-MM-DD' (end of that day when `endOfDay`) as a timestamp in the person's time zone; null when blank or malformed. */
function localDate(tz: string, v: FormDataEntryValue | null, endOfDay = false) {
	const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
	return m ? fromLocal(tz, Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (endOfDay ? 1 : 0)) : null;
}

export const actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!deletePlay(locals.user!.id, id)) return fail(404, { error: 'That play was already deleted.' });
		return { deleted: true };
	},
	/** Fixes one play's time and/or song. The song is named by artist, album and title; a checkbox applies the song fix to every play of it. */
	edit: async ({ request, locals }) => {
		const f = await request.formData();
		const me = locals.user!;
		const id = Number(f.get('id'));
		const before = playOf(me.id, id);
		if (!before) return fail(404, { edit: id, error: 'That play was already deleted.' });
		const when = String(f.get('played_at') ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
		if (!when) return fail(400, { edit: id, error: 'Enter the date and time it was played.' });
		const ts = fromLocal(me.timezone, Number(when[1]), Number(when[2]) - 1, Number(when[3]), Number(when[4]), Number(when[5]));
		if (ts > Math.floor(Date.now() / 1000) + 86400) return fail(400, { edit: id, error: "A play can't be in the future." });
		let changed = 0;
		try {
			changed = relinkPlay(me.id, id, { artist: String(f.get('artist') ?? ''), album: String(f.get('album') ?? ''), title: String(f.get('title') ?? '') }, !!f.get('all_plays'));
		} catch (e) {
			return fail(400, { edit: id, error: (e as Error).message });
		}
		if (ts !== before.played_at) setPlayedAt(me.id, id, ts);
		return { edited: id, relinked: changed };
	},
	/** Deletes every play of the filtered song/album/artist and/or inside a local date range. */
	deleteMany: async ({ request, locals }) => {
		const f = await request.formData();
		const me = locals.user!;
		if (!f.get('confirm')) return fail(400, { bulk: true, error: 'Tick the box to confirm.' });
		const filter: BulkFilter = { since: localDate(me.timezone, f.get('from')), until: localDate(me.timezone, f.get('to'), true) };
		const kind = String(f.get('kind') ?? '');
		if (f.get('only_filtered') && ['track', 'album', 'artist'].includes(kind)) filter[`${kind as 'track' | 'album' | 'artist'}Id`] = Number(f.get('entity')) || null;
		if (filter.since != null && filter.until != null && filter.until <= filter.since) return fail(400, { bulk: true, error: 'The end date is before the start date.' });
		try {
			if (!countPlays(me.id, filter)) return fail(400, { bulk: true, error: 'No plays match that.' });
			return { bulk: true, deleted: deletePlays(me.id, filter) };
		} catch (e) {
			return fail(400, { bulk: true, error: (e as Error).message });
		}
	}
} satisfies Actions;
