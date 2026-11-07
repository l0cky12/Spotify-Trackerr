import { randomBytes } from 'node:crypto';
import { get, run, now, all } from './db.js';
import type { Report } from './report.js';
import type { TopRow } from './stats.js';
import type { TimeUnit } from '../time.js';

/** A top-list row as friends see it: no ids into this server and no play times. */
const publicRow = ({ name, artist, image, plays, ms }: TopRow) => ({ name, artist, image, plays, ms });
export type PublicRow = ReturnType<typeof publicRow> & Partial<Pick<TopRow, 'id' | 'artist_id'>>;
type Lists = 'tracks' | 'albums' | 'artists' | 'newArtists' | 'busiest';
/** A Report with only what a shared page shows. Every Report is one, so the same layout draws both. */
export type PublicReport = Omit<Report, Lists> & Record<Exclude<Lists, 'busiest'>, PublicRow[]> & { busiest: (Omit<NonNullable<Report['busiest']>, 'tracks'> & { tracks: PublicRow[] }) | null };

/** What a shared Report page shows: the Report as it was when published, in the owner's units. */
export type SharedReport = { v: 1; report: PublicReport; timeUnit: TimeUnit; rankBy: 'plays' | 'minutes' };
export type Share = { token: string; period: string; updated_at: number };

export function toPublic(report: Report): PublicReport {
	const rows = (list: TopRow[]) => list.map(publicRow);
	return {
		...report,
		tracks: rows(report.tracks),
		albums: rows(report.albums),
		artists: rows(report.artists),
		newArtists: rows(report.newArtists),
		busiest: report.busiest && { ...report.busiest, tracks: rows(report.busiest.tracks) }
	};
}

/** The link for one person's Report of one period, if they published it. */
export const shareOf = (userId: number, period: string) =>
	(get('SELECT token, period, updated_at FROM report_shares WHERE user_id = ? AND period = ?', userId, period) as Share | undefined) ?? null;

/** The periods (YYYY or YYYY-MM) this person has published. */
export const sharedPeriods = (userId: number) => all('SELECT period FROM report_shares WHERE user_id = ?', userId).map((r) => r.period as string);

/**
 * Publishes a Report for anyone with the link. Publishing a period again refreshes the copy and keeps
 * the same link, so friends who already have it see the update.
 */
export function publishReport(userId: number, report: Report, timeUnit: TimeUnit, rankBy: 'plays' | 'minutes'): Share {
	const at = now();
	const token = shareOf(userId, report.period.id)?.token ?? randomBytes(16).toString('base64url');
	const shared: SharedReport = { v: 1, report: toPublic(report), timeUnit, rankBy };
	run(
		`INSERT INTO report_shares (token, user_id, period, report, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (user_id, period) DO UPDATE SET report = excluded.report, updated_at = excluded.updated_at`,
		token,
		userId,
		report.period.id,
		JSON.stringify(shared),
		at,
		at
	);
	return { token, period: report.period.id, updated_at: at };
}

/** Stops sharing; the link stops working. */
export const unpublishReport = (userId: number, period: string) => Number(run('DELETE FROM report_shares WHERE user_id = ? AND period = ?', userId, period).changes) > 0;

/** A published Report by its link, or null when the link is wrong, was unpublished, or was saved in a shape this version can't show. */
export function sharedReport(token: string): (SharedReport & { updatedAt: number }) | null {
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
	const row = get('SELECT report, updated_at FROM report_shares WHERE token = ?', token);
	if (!row) return null;
	const shared = JSON.parse(row.report) as SharedReport;
	return shared.v === 1 ? { ...shared, updatedAt: row.updated_at } : null;
}
