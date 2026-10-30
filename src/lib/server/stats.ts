import { all, get } from './db.js';
import { notBanned } from './bans.js';
import { localizer, monthName, fromLocal, dayLabel, periodId, parsePeriod } from '../time.js';

export type Kind = 'track' | 'album' | 'artist';
/** How a top list is ordered: by the person's rank_by setting unless `sort` says otherwise (last/first = last/first played in the range). */
export type Sort = 'plays' | 'minutes' | 'last' | 'first';
export const SORTS: Sort[] = ['plays', 'minutes', 'last', 'first'];
export type Scope = { ids: number[]; since: number; until: number; rankBy: 'plays' | 'minutes'; tz: string; sort?: Sort };

// ids are integers we resolved server-side, so inlining them is safe. Banned songs, albums and artists drop out here, so every stat skips them.
const users = (ids: number[]) => `(p.user_id IN (${ids.map((n) => Math.trunc(n)).join(',') || 'NULL'})${notBanned(ids)})`;
const order = (rankBy: string) => (rankBy === 'minutes' ? 'ms DESC, plays DESC' : 'plays DESC, ms DESC');
const ORDERS: Record<Sort, string> = { plays: 'plays DESC, ms DESC', minutes: 'ms DESC, plays DESC', last: 'last DESC, plays DESC', first: 'first DESC, plays DESC' };
const sortOrder = (s: Scope) => ORDERS[s.sort ?? s.rankBy];

const IMG = {
	track: 'COALESCE(t.image_override, t.image, al.image_override, al.image)',
	album: 'COALESCE(al.image_override, al.image)',
	artist: 'COALESCE(a.image_override, a.image)'
};

/** `filter` is extra SQL on `plays p`; its `?` placeholders take `params`. */
export function top(kind: Kind, s: Scope, limit = 10, offset = 0, filter = '', ...params: unknown[]) {
	// Rank on plays alone, then join names and images for just the page of winners: joining every play first is several times slower.
	const col = { track: 'track_id', album: 'album_id', artist: 'artist_id' }[kind];
	const ranked = `SELECT p.${col} id, COUNT(*) plays, SUM(p.ms_played) ms, MIN(p.played_at) first, MAX(p.played_at) last FROM plays p
		WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? AND p.${col} IS NOT NULL ${filter}
		GROUP BY p.${col} ORDER BY ${sortOrder(s)} LIMIT ? OFFSET ?`;
	const sql = {
		track: `SELECT t.id, t.name, a.name artist, a.id artist_id, ${IMG.track} image, x.plays, x.ms, x.first, x.last
			FROM (${ranked}) x JOIN tracks t ON t.id = x.id JOIN artists a ON a.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id`,
		album: `SELECT al.id, al.name, a.name artist, a.id artist_id, ${IMG.album} image, x.plays, x.ms, x.first, x.last
			FROM (${ranked}) x JOIN albums al ON al.id = x.id JOIN artists a ON a.id = al.artist_id`,
		artist: `SELECT a.id, a.name, NULL artist, NULL artist_id, ${IMG.artist} image, x.plays, x.ms, x.first, x.last
			FROM (${ranked}) x JOIN artists a ON a.id = x.id`
	}[kind];
	return all(`${sql} ORDER BY ${sortOrder(s)}`, s.since, s.until, ...params, limit, offset) as TopRow[];
}
export type TopRow = { id: number; name: string; artist: string | null; artist_id: number | null; image: string | null; plays: number; ms: number; first: number; last: number };

export function countDistinct(kind: Kind, s: Scope) {
	const col = { track: 'track_id', album: 'album_id', artist: 'artist_id' }[kind];
	return get(`SELECT COUNT(DISTINCT p.${col}) n FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`, s.since, s.until)!.n as number;
}

export function totals(s: Scope, filter = '', ...params: unknown[]) {
	return get(
		`SELECT COUNT(*) plays, COALESCE(SUM(ms_played), 0) ms, COUNT(DISTINCT artist_id) artists, COUNT(DISTINCT track_id) tracks
		 FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? ${filter}`,
		s.since,
		s.until,
		...params
	)!;
}

export function firstPlay(ids: number[]) {
	return (get(`SELECT MIN(played_at) t FROM plays p WHERE ${users(ids)}`)?.t as number | null) ?? null;
}

export function genres(s: Scope, limit = 12) {
	const rows = all(
		`SELECT g.genre name, SUM(x.plays) plays, SUM(x.ms) ms
		 FROM (SELECT p.artist_id, COUNT(*) plays, SUM(p.ms_played) ms FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ? GROUP BY p.artist_id) x
		 JOIN artist_genres g ON g.artist_id = x.artist_id GROUP BY g.genre ORDER BY ${order(s.rankBy)} LIMIT ?`,
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

/** Plays by artists tagged with the genre: pass as `top`/`totals` filter + param. */
export const inGenre = 'AND p.artist_id IN (SELECT artist_id FROM artist_genres WHERE genre = ?)';

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

/** Empty 7 x 24 grid: rows Monday..Sunday, columns hours 0..23 of the local day. */
export const emptyGrid = () => Array.from({ length: 7 }, () => new Array(24).fill(0));
/** Row and column of the heatmap cell a local wall-clock moment falls in. */
export const gridCell = (d: Date): [number, number] => [(d.getUTCDay() + 6) % 7, d.getUTCHours()];
/** Plays by weekday and hour, in local time. */
export function heatmapGrid(timestamps: number[], tz: string) {
	const loc = localizer(tz);
	const grid = emptyGrid();
	for (const ts of timestamps) {
		const [row, hour] = gridCell(loc(ts));
		grid[row][hour]++;
	}
	return grid;
}

/**
 * Everything on the dashboard that needs local-time bucketing, from one scan of timestamps:
 * plays over time (with the previous period alongside), hour x weekday grid, top-artist trends.
 */
export function timeSeries(s: Scope, trendArtists: { id: number; name: string }[]) {
	// All time starts at the epoch; walking every hour since 1970 is what made that range crawl.
	const start = s.since || Math.min(firstPlay(s.ids) ?? s.until - 86400, s.until - 86400);
	const span = s.until - start;
	const unit = unitFor(span);
	const key = bucketer(s.tz, unit);
	const keys = keysBetween(start, s.until, key);
	const index = new Map(keys.map((k, i) => [k, i]));
	const cur = new Array(keys.length).fill(0);
	const prev = new Array(keys.length).fill(0);
	const grid = emptyGrid();
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
		const [row, hour] = gridCell(loc(r.played_at));
		grid[row][hour]++;
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
	return bucketMonths(all(`SELECT played_at FROM plays p WHERE ${users(ids)} AND p.${col} = ? ORDER BY played_at`, id), tz);
}

/** Plays per month across everything these people played, first month to last: the list of months Reports can show. */
export function playsPerMonth(ids: number[], tz: string) {
	return bucketMonths(all(`SELECT played_at FROM plays p WHERE ${users(ids)} ORDER BY played_at`), tz);
}

export type Month = { y: number; m: number; label: string; plays: number };
/** Groups ordered play timestamps into every local calendar month from the first to the last, with the peak month and year. */
function bucketMonths(rows: { played_at: number }[], tz: string): { months: Month[]; peak: Month | null; peakYear: { year: number; plays: number } | null } {
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

/** Artists first played in the scope (none of these users played them before `since`), ranked like `top`. */
export function newArtists(s: Scope, limit = 10) {
	// The inner alias shadows the outer `p` so `users()` applies to the earlier plays.
	return top('artist', s, limit, 0, `AND p.artist_id NOT IN (SELECT p.artist_id FROM plays p WHERE ${users(s.ids)} AND p.played_at < ${Math.trunc(s.since)} AND p.artist_id IS NOT NULL)`);
}

export function newArtistsIn(s: Scope) {
	return get(
		`SELECT COUNT(*) n FROM (SELECT p.artist_id, MIN(p.played_at) f FROM plays p WHERE ${users(s.ids)} GROUP BY p.artist_id) WHERE f >= ? AND f < ?`,
		s.since,
		s.until
	)!.n as number;
}

// ---- Reports: calendar periods, deltas, busiest day --------------------------------------

export type Period = { id: string; label: string; since: number; until: number; prev: { id: string; label: string; since: number; until: number }; y: number; m?: number };

/** The local calendar month ('YYYY-MM') or year ('YYYY') a Report covers, and the one before it. */
export function periodOf(tz: string, id: string | null | undefined): Period | null {
	const p = parsePeriod(id);
	if (!p) return null;
	const bounds = (y: number, m?: number) =>
		m === undefined
			? { id: periodId(y), label: `${y}`, since: fromLocal(tz, y, 0, 1), until: fromLocal(tz, y + 1, 0, 1) }
			: { id: periodId(y, m), label: `${monthName(m)} ${y}`, since: fromLocal(tz, y, m, 1), until: fromLocal(tz, y, m + 1, 1) };
	const prev = p.m === undefined ? bounds(p.y - 1) : p.m === 0 ? bounds(p.y - 1, 11) : bounds(p.y, p.m - 1);
	return { ...bounds(p.y, p.m), prev, y: p.y, m: p.m };
}

/** The last finished local calendar month, as of `now`. */
export function lastMonthId(tz: string, nowTs: number) {
	const d = localizer(tz)(nowTs);
	const y = d.getUTCFullYear(),
		m = d.getUTCMonth();
	return m === 0 ? periodId(y - 1, 11) : periodId(y, m - 1);
}

export type Totals = { plays: number; ms: number; artists: number; tracks: number };
export type Delta = Record<keyof Totals, { diff: number; pct: number | null }>;
/** Change from the previous period, per total: absolute difference and percent (null when the previous period had none). */
export function delta(cur: Totals, prev: Totals): Delta {
	const one = (k: keyof Totals) => ({ diff: cur[k] - prev[k], pct: prev[k] ? Math.round(((cur[k] - prev[k]) / prev[k]) * 100) : null });
	return { plays: one('plays'), ms: one('ms'), artists: one('artists'), tracks: one('tracks') };
}

/** Local day number (days since 1970-01-01 in wall-clock time) of a timestamp. */
const localDay = (loc: (ts: number) => Date, ts: number) => Math.floor(loc(ts).getTime() / 86400000);

/** Plays per local day in the scope, as day number -> plays. */
export function dailyCounts(s: Scope) {
	const loc = localizer(s.tz);
	const days = new Map<number, number>();
	for (const r of all(`SELECT played_at FROM plays p WHERE ${users(s.ids)} AND p.played_at >= ? AND p.played_at < ?`, s.since, s.until)) {
		const d = localDay(loc, r.played_at);
		days.set(d, (days.get(d) ?? 0) + 1);
	}
	return days;
}

/** The day with the most plays in the scope. */
export function busiestDay(s: Scope) {
	let best: { day: number; plays: number } | null = null;
	for (const [day, plays] of dailyCounts(s)) if (!best || plays > best.plays) best = { day, plays };
	return best && { ...best, label: dayLabel(best.day) };
}

// ---- Charts: streaks, first heard, on this day --------------------------------------------

export type Streak = { from: number; to: number; days: number; fromLabel: string; toLabel: string };
const streakOf = (from: number, to: number): Streak => ({ from, to, days: to - from + 1, fromLabel: dayLabel(from), toLabel: dayLabel(to) });

/**
 * Longest run of consecutive local days with at least one play, and the run that's still going
 * (one that reaches today or yesterday), from the distinct day numbers played on.
 */
export function streaksFromDays(days: Iterable<number>, today: number) {
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	let longest: Streak | null = null;
	let current: Streak | null = null;
	let start = -1,
		prev = -1;
	const close = (from: number, to: number) => {
		const run = streakOf(from, to);
		if (!longest || run.days > longest.days) longest = run;
		if (to >= today - 1 && to <= today) current = run;
	};
	for (const d of sorted) {
		if (start < 0) start = prev = d;
		else if (d === prev + 1) prev = d;
		else {
			close(start, prev);
			start = prev = d;
		}
	}
	if (start >= 0) close(start, prev);
	return { longest: longest as Streak | null, current: current as Streak | null, daysPlayed: sorted.length };
}

/** Listening streaks over everything these people played. */
export function streaks(ids: number[], tz: string, nowTs: number) {
	const loc = localizer(tz);
	const days = new Set<number>();
	for (const r of all(`SELECT played_at FROM plays p WHERE ${users(ids)}`)) days.add(localDay(loc, r.played_at));
	return streaksFromDays(days, localDay(loc, nowTs));
}

/**
 * Songs first played in the scope (never played by these people before `since`), newest discovery first,
 * with their plays so far. `filter` is extra SQL on `plays p` with `?` placeholders taking `params`.
 */
export function firstHeard(s: Scope, limit = 50, offset = 0, filter = '', ...params: unknown[]) {
	return all(
		`SELECT t.id, t.name, a.name artist, a.id artist_id, ${IMG.track} image, t.spotify_id, x.plays, x.ms, x.first, x.last
		 FROM (SELECT p.track_id id, COUNT(*) plays, SUM(p.ms_played) ms, MIN(p.played_at) first, MAX(p.played_at) last FROM plays p
		       WHERE ${users(s.ids)} ${filter} GROUP BY p.track_id HAVING first >= ? AND first < ? ORDER BY first DESC LIMIT ? OFFSET ?) x
		 JOIN tracks t ON t.id = x.id JOIN artists a ON a.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id ORDER BY x.first DESC`,
		...params,
		s.since,
		s.until,
		limit,
		offset
	) as (TopRow & { spotify_id: string | null })[];
}

export function firstHeardCount(s: Scope) {
	return get(
		`SELECT COUNT(*) n FROM (SELECT MIN(p.played_at) f FROM plays p WHERE ${users(s.ids)} GROUP BY p.track_id) WHERE f >= ? AND f < ?`,
		s.since,
		s.until
	)!.n as number;
}

export type Blast = { year: number; yearsAgo: number; week: boolean; plays: number; tracks: TopRow[] };
/**
 * Blasts from the past: what these people played on today's date in each earlier year. A year with
 * nothing on the exact day widens to the week around it (`week`). Newest year first.
 */
export function onThisDay(ids: number[], tz: string, nowTs: number, perYear = 5, rankBy: 'plays' | 'minutes' = 'plays'): Blast[] {
	const loc = localizer(tz);
	const today = loc(nowTs);
	const first = firstPlay(ids);
	if (first === null) return [];
	const out: Blast[] = [];
	const m = today.getUTCMonth(),
		d = today.getUTCDate();
	for (let year = today.getUTCFullYear() - 1; year >= loc(first).getUTCFullYear(); year--) {
		let scope: Scope = { ids, since: fromLocal(tz, year, m, d), until: fromLocal(tz, year, m, d + 1), rankBy, tz };
		let tracks = top('track', scope, perYear);
		let week = false;
		if (!tracks.length) {
			scope = { ...scope, since: fromLocal(tz, year, m, d - 3), until: fromLocal(tz, year, m, d + 4) };
			tracks = top('track', scope, perYear);
			week = true;
		}
		if (tracks.length) out.push({ year, yearsAgo: today.getUTCFullYear() - year, week, plays: totals(scope).plays as number, tracks });
	}
	return out;
}

export { users as userClause };
