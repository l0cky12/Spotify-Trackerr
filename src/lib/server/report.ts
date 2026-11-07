import { top, totals, genres, busiestDay, delta, timeSeries, newArtists, newArtistsIn, type Scope, type Period, type TopRow, type Change } from './stats.js';
import type { View } from './view.js';
import { formatDate, fromLocal } from '../time.js';

type Counts = { plays: number; ms: number; artists: number; tracks: number; newArtists: number };

/** Everything the Reports page and its PDF show for one period, from one set of queries. */
export type Report = {
	/** `partial` while the period is still going: totals so far, compared with the same stretch of the period before. */
	period: { id: string; label: string; y: number; m: number | null; partial: boolean; prev: { id: string; label: string } };
	/** Whose listening: a person's display name, or 'Everyone'. */
	who: string;
	generatedOn: string;
	totals: Counts;
	delta: Record<keyof Counts, Change>;
	tracks: TopRow[];
	albums: TopRow[];
	artists: TopRow[];
	genres: { name: string; plays: number; ms: number }[];
	/** The top 10 artists first played in the period, ranked like the top lists; `totals.newArtists` counts them all. */
	newArtists: TopRow[];
	busiest: { label: string; plays: number; ms: number; tracks: TopRow[] } | null;
	series: { labels: string[]; cur: number[]; prev: number[] | null };
	/** Plays per weekday, Monday first, in the viewer's time zone. */
	weekdays: number[];
	/** Plays per hour of the day, midnight first, in the viewer's time zone. */
	hours: number[];
};

export function reportOf(view: View, period: Period): Report {
	const scope: Scope = { ids: view.ids, since: period.since, until: period.until, rankBy: view.rankBy, tz: view.tz };
	// A period still under way is compared with the same length of time into the period before, not all of it.
	const nowTs = Date.now() / 1000;
	const partial = period.since <= nowTs && nowTs < period.until;
	const prev: Scope = { ...scope, since: period.prev.since, until: partial ? Math.min(period.prev.until, period.prev.since + (nowTs - period.since)) : period.prev.until };
	const fresh = newArtists(scope, -1);
	const cur = { ...totals(scope), newArtists: fresh.length } as Counts;
	const series = timeSeries(scope, []);
	return {
		period: { id: period.id, label: period.label, y: period.y, m: period.m ?? null, partial, prev: { id: period.prev.id, label: period.prev.label } },
		who: view.name,
		generatedOn: formatDate(Date.now() / 1000, view.tz),
		totals: cur,
		delta: delta(cur, { ...totals(prev), newArtists: newArtistsIn(prev) }),
		tracks: top('track', scope, 10),
		albums: top('album', scope, 10),
		artists: top('artist', scope, 10),
		genres: genres(scope, 10).rows,
		newArtists: fresh.slice(0, 10),
		busiest: busiestOf(scope),
		series: { labels: series.labels, cur: series.cur, prev: series.prev },
		weekdays: series.grid.map((hours) => hours.reduce((a, b) => a + b, 0)),
		hours: series.grid[0].map((_, h) => series.grid.reduce((sum, row) => sum + row[h], 0))
	};
}

function busiestOf(scope: Scope): Report['busiest'] {
	const best = busiestDay(scope);
	if (!best) return null;
	const day = { ...scope, since: fromLocal(scope.tz, 1970, 0, best.day + 1), until: fromLocal(scope.tz, 1970, 0, best.day + 2) };
	return { label: best.label, plays: best.plays, ms: totals(day).ms, tracks: top('track', day, 3) };
}
