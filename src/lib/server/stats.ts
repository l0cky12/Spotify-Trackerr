import { all, get } from './db.js';
import { localizer, monthName } from '../time.js';

export type Kind = 'track' | 'album' | 'artist';
export type Scope = { ids: number[]; since: number; until: number; rankBy: 'plays' | 'minutes'; tz: string };

// ids are integers we resolved server-side, so inlining them is safe.
const users = (ids: number[]) => `p.user_id IN (${ids.map((n) => Math.trunc(n)).join(',') || 'NULL'})`;
const order = (rankBy: string) => (rankBy === 'minutes' ? 'ms DESC, plays DESC' : 'plays DESC, ms DESC');

const IMG = {
	track: 'COALESCE(t.image_override, t.image, al.image_override, al.image)',
	album: 'COALESCE(al.image_override, al.image)',
	artist: 'COALESCE(a.image_override, a.image)'
};

export function top(kind: Kind, s: Scope, limit = 10, offset = 0, filter = '') {
	const where = `${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? ${filter}`;
	const sql = {
		track: `SELECT t.id, t.name, a.name artist, a.id artist_id, ${IMG.track} image, COUNT(*) plays, SUM(p.ms_played) ms
			FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id
			WHERE ${where} GROUP BY t.id`,
		album: `SELECT al.id, al.name, a.name artist, a.id artist_id, ${IMG.album} image, COUNT(*) plays, SUM(p.ms_played) ms
			FROM plays p JOIN albums al ON al.id = p.album_id JOIN artists a ON a.id = al.artist_id
			WHERE ${where} GROUP BY al.id`,
		artist: `SELECT a.id, a.name, NULL artist, NULL artist_id, ${IMG.artist} image, COUNT(*) plays, SUM(p.ms_played) ms
			FROM plays p JOIN artists a ON a.id = p.artist_id
			WHERE ${where} GROUP BY a.id`
	}[kind];
	return all(`${sql} ORDER BY ${order(s.rankBy)} LIMIT ? OFFSET ?`, s.since, s.until, limit, offset);
}

export function countDistinct(kind: Kind, s: Scope) {
	const col = { track: 'track_id', album: 'album_id', artist: 'artist_id' }[kind];
	return get(`SELECT COUNT(DISTINCT p.${col}) n FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`, s.since, s.until)!.n as number;
}

export function totals(s: Scope) {
	return get(
		`SELECT COUNT(*) plays, COALESCE(SUM(ms_played), 0) ms, COUNT(DISTINCT artist_id) artists, COUNT(DISTINCT track_id) tracks
		 FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`,
		s.since,
		s.until
	)!;
}

export function firstPlay(ids: number[]) {
	return (get(`SELECT MIN(played_at) t FROM plays p WHERE ${users(ids)}`)?.t as number | null) ?? null;
}

export function genres(s: Scope, limit = 12) {
	const rows = all(
		`SELECT g.genre name, COUNT(*) plays, SUM(p.ms_played) ms FROM plays p JOIN artist_genres g ON g.artist_id = p.artist_id
		 WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? GROUP BY g.genre ORDER BY ${order(s.rankBy)} LIMIT ?`,
		s.since,
		s.until,
		limit
	);
	const covered = get(
		`SELECT COUNT(*) n FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?
		 AND EXISTS (SELECT 1 FROM artist_genres g WHERE g.artist_id = p.artist_id)`,
		s.since,
		s.until
	)!.n as number;
	return { rows, covered };
}

/** Plays per release year (from album release dates). */
export function releaseYears(s: Scope) {
	return all(
		`SELECT al.release_year year, COUNT(*) plays FROM plays p JOIN albums al ON al.id = p.album_id
		 WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? AND al.release_year IS NOT NULL GROUP BY al.release_year ORDER BY year`,
		s.since,
		s.until
	) as { year: number; plays: number }[];
}

// ---- Time series -------------------------------------------------------------------------

export type Unit = 'hour' | 'day' | 'week' | 'month' | 'year';

export function unitFor(span: number): Unit {
	if (span <= 3 * 86400) return 'hour';
	if (span <= 90 * 86400) return 'day';
	if (span <= 180 * 86400) return 'week';
	if (span <= 4 * 366 * 86400) return 'month';
	return 'year';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function bucketer(tz: string, unit: Unit) {
	const loc = localizer(tz);
	return (ts: number) => {
		const d = loc(ts);
		const y = d.getUTCFullYear(),
			m = d.getUTCMonth(),
			day = d.getUTCDate();
		switch (unit) {
			case 'hour':
				return `${y}-${m}-${day}-${d.getUTCHours()}`;
			case 'day':
				return `${y}-${m}-${day}`;
			case 'week': {
				const monday = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)));
				return `${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`;
			}
			case 'month':
				return `${y}-${m}`;
			case 'year':
				return `${y}`;
		}
	};
}

function label(k: string, unit: Unit, multiDay: boolean) {
	const [y, m, d, h] = k.split('-').map(Number);
	if (unit === 'hour') {
		const hh = `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
		return multiDay ? `${DAYS[new Date(Date.UTC(y, m, d)).getUTCDay()]} ${hh}` : hh;
	}
	if (unit === 'day' || unit === 'week') return `${monthName(m)} ${d}`;
	if (unit === 'month') return `${monthName(m)} ${y}`;
	return `${y}`;
}

/** Ordered bucket keys covering [since, until). */
function keysBetween(since: number, until: number, key: (ts: number) => string) {
	const keys: string[] = [];
	let last = '';
	for (let ts = since; ts < until; ts += 3600) {
		const k = key(ts);
		if (k !== last) keys.push((last = k));
	}
	const k = key(until - 1);
	if (k !== last) keys.push(k);
	return keys;
}

/**
 * Everything on the dashboard that needs local-time bucketing, from one scan of timestamps:
 * plays over time (with the previous period alongside), hour x weekday grid, top-artist trends.
 */
export function timeSeries(s: Scope, trendArtists: { id: number; name: string }[]) {
	const span = s.until - s.since;
	const unit = unitFor(span);
	const key = bucketer(s.tz, unit);
	const keys = keysBetween(s.since, s.until, key);
	const index = new Map(keys.map((k, i) => [k, i]));
	const cur = new Array(keys.length).fill(0);
	const prev = new Array(keys.length).fill(0);
	const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
	const trendIdx = new Map(trendArtists.map((a, i) => [a.id, i]));
	const trends = trendArtists.map(() => new Array(keys.length).fill(0));
	const loc = localizer(s.tz);
	const hasPrev = s.since > 0;

	const rows = all(
		`SELECT played_at, artist_id FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`,
		hasPrev ? s.since - span : s.since,
		s.until
	) as { played_at: number; artist_id: number }[];
	for (const r of rows) {
		if (r.played_at < s.since) {
			const i = index.get(key(r.played_at + span));
			if (i !== undefined) prev[i]++;
			continue;
		}
		const i = index.get(key(r.played_at));
		if (i === undefined) continue;
		cur[i]++;
		const d = loc(r.played_at);
		grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
		const ti = trendIdx.get(r.artist_id);
		if (ti !== undefined) trends[ti][i]++;
	}
	const multiDay = span > 86400;
	return {
		unit,
		labels: keys.map((k) => label(k, unit, multiDay)),
		cur,
		prev: hasPrev ? prev : null,
		grid,
		trends: trendArtists.map((a, i) => ({ ...a, values: trends[i] }))
	};
}

/** Plays per month for a single song/album/artist, first month to last, with the peak. */
export function monthly(ids: number[], col: 'track_id' | 'album_id' | 'artist_id', id: number, tz: string) {
	const rows = all(`SELECT played_at FROM plays p WHERE ${users(ids)} AND p.${col} = ? ORDER BY played_at`, id) as { played_at: number }[];
	if (!rows.length) return { months: [], peak: null, peakYear: null };
	const loc = localizer(tz);
	const counts = new Map<string, number>();
	const years = new Map<number, number>();
	for (const r of rows) {
		const d = loc(r.played_at);
		const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
		counts.set(k, (counts.get(k) ?? 0) + 1);
		years.set(d.getUTCFullYear(), (years.get(d.getUTCFullYear()) ?? 0) + 1);
	}
	const first = loc(rows[0].played_at),
		last = loc(rows.at(-1)!.played_at);
	const months: { y: number; m: number; label: string; plays: number }[] = [];
	for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth()); m++) {
		if (m === 12) {
			m = 0;
			y++;
		}
		months.push({ y, m, label: `${monthName(m)} ${y}`, plays: counts.get(`${y}-${m}`) ?? 0 });
	}
	const peak = months.reduce((a, b) => (b.plays > a.plays ? b : a));
	const peakYear = [...years].reduce((a, b) => (b[1] > a[1] ? b : a));
	return { months, peak, peakYear: { year: peakYear[0], plays: peakYear[1] } };
}

export function entityTotals(ids: number[], col: 'track_id' | 'album_id' | 'artist_id', id: number) {
	return get(
		`SELECT COUNT(*) plays, COALESCE(SUM(ms_played), 0) ms, MIN(played_at) first, MAX(played_at) last FROM plays p WHERE ${users(ids)} AND p.${col} = ?`,
		id
	)!;
}

/** Daily counts for a local calendar year, plus months. */
export function yearDays(s: Scope, year: number) {
	const loc = localizer(s.tz);
	const days = new Map<string, number>();
	const months = new Array(12).fill(0);
	for (const r of all(`SELECT played_at FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`, s.since, s.until)) {
		const d = loc(r.played_at);
		if (d.getUTCFullYear() !== year) continue;
		const k = `${d.getUTCMonth()}-${d.getUTCDate()}`;
		days.set(k, (days.get(k) ?? 0) + 1);
		months[d.getUTCMonth()]++;
	}
	return { days: Object.fromEntries(days), months };
}

export function newArtistsIn(s: Scope) {
	return get(
		`SELECT COUNT(*) n FROM (SELECT p.artist_id, MIN(p.played_at) f FROM plays p WHERE ${users(s.ids)} GROUP BY p.artist_id) WHERE f >= ? AND f < ?`,
		s.since,
		s.until
	)!.n as number;
}

export { users as userClause };
