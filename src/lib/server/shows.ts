import { all, get, run, now, tx } from './db.js';
import { key, upsertArtist } from './ingest.js';

// Watched artists and their shows. A person watches artists they'd go see; an AI assistant connected over MCP
// (see mcp.ts) reads the watchlist and the person's home, searches for tour dates near it, and saves what it
// finds here. Shows stay "new" until the person opens the Shows page, which is how they get alerted in the app.

const IMAGE = 'COALESCE(a.image_override, a.image)';

/** Today's date (YYYY-MM-DD) in a time zone; shows on or after it are upcoming. */
export const today = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function watch(userId: number, artistId: number) {
	if (!get('SELECT 1 FROM artists WHERE id = ?', artistId)) return false;
	run('INSERT INTO watches (user_id, artist_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', userId, Math.trunc(artistId), now());
	return true;
}

export function unwatch(userId: number, artistId: number) {
	return Number(run('DELETE FROM watches WHERE user_id = ? AND artist_id = ?', userId, artistId).changes) > 0;
}

export const watching = (userId: number, artistId: number) => !!get('SELECT 1 FROM watches WHERE user_id = ? AND artist_id = ?', userId, artistId);

/** An artist by name: one we already know (matched loosely), else a new one, so an assistant can watch artists not played here yet. */
export function artistByName(name: string, create: boolean): { id: number; name: string } | null {
	const clean = name.trim().slice(0, 200);
	if (!clean) return null;
	const row = get('SELECT id, name FROM artists WHERE key = ?', key(clean));
	if (row) return row;
	return create ? { id: upsertArtist(clean), name: clean } : null;
}

export type WatchRow = { id: number; name: string; image: string | null; since: number; plays: number; genres: string[] };

/** A person's watched artists, most played first, with their play counts and genres. */
export function watchesOf(userId: number): WatchRow[] {
	return all(
		`SELECT a.id, a.name, ${IMAGE} image, w.created_at since,
			(SELECT COUNT(*) FROM plays p WHERE p.user_id = w.user_id AND p.artist_id = a.id) plays,
			(SELECT group_concat(genre, '|') FROM artist_genres g WHERE g.artist_id = a.id) genres
		 FROM watches w JOIN artists a ON a.id = w.artist_id WHERE w.user_id = ? ORDER BY plays DESC, a.name COLLATE NOCASE`,
		userId
	).map((r) => ({ ...r, genres: r.genres ? String(r.genres).split('|') : [] }));
}

export function setHome(userId: number, location: string | null, miles?: number) {
	const place = location?.trim().slice(0, 120) || null;
	const m = Number.isFinite(miles) ? Math.min(Math.max(Math.round(miles!), 1), 3000) : undefined;
	run('UPDATE users SET home_location = ?, show_miles = COALESCE(?, show_miles) WHERE id = ?', place, m ?? null, userId);
}

export const homeOf = (userId: number) => {
	const u = get('SELECT home_location, show_miles FROM users WHERE id = ?', userId);
	return { location: (u?.home_location as string | null) ?? null, miles: (u?.show_miles as number) ?? 100 };
};

export type ShowInput = { artist: string; date: string; venue: string; city: string; url?: string | null; note?: string | null };
export type ShowRow = { id: number; artist_id: number; artist: string; image: string | null; date: string; venue: string; city: string; url: string | null; note: string | null; found_at: number; seen: boolean };

const validDate = (d: string) => {
	const t = Date.parse(`${d}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
};
const cityKey = (city: string) => key(city.split(',')[0]);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Saves shows found for a person's watched artists. Each comes back as saved (new), known (already saved: same
 * artist, date and city), or rejected with the reason, so an assistant can tell the person about only the new ones.
 */
export function saveShows(userId: number, tz: string, shows: ShowInput[]) {
	const from = today(tz);
	const watched = new Map(all('SELECT a.id, a.key FROM watches w JOIN artists a ON a.id = w.artist_id WHERE w.user_id = ?', userId).map((r) => [r.key as string, r.id as number]));
	const saved: (ShowInput & { id: number })[] = [];
	const known: ShowInput[] = [];
	const rejected: { show: ShowInput; reason: string }[] = [];
	tx(() => {
		for (const raw of shows) {
			const s = { artist: text(raw?.artist, 200), date: text(raw?.date, 10), venue: text(raw?.venue, 200), city: text(raw?.city, 200), url: text(raw?.url, 500) || null, note: text(raw?.note, 500) || null };
			const artistId = watched.get(key(s.artist));
			const reason = !s.artist
				? 'Missing the artist.'
				: artistId === undefined
					? `${s.artist} isn't on the watchlist. Watch them first.`
					: !validDate(s.date)
						? 'The date must be YYYY-MM-DD.'
						: s.date < from
							? 'That date has already passed.'
							: !s.venue || !s.city
								? 'Missing the venue or city.'
								: s.url && !/^https?:\/\//i.test(s.url)
									? 'The link must start with https://'
									: null;
			if (reason) {
				rejected.push({ show: s, reason });
				continue;
			}
			const r = run(
				`INSERT INTO shows (user_id, artist_id, date, venue, city, city_key, url, note, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (user_id, artist_id, date, city_key) DO NOTHING`,
				userId, artistId!, s.date, s.venue, s.city, cityKey(s.city), s.url, s.note, now()
			);
			if (Number(r.changes)) saved.push({ ...s, id: Number(r.lastInsertRowid) });
			else known.push(s);
		}
	});
	return { saved, known, rejected };
}

/** Shows from today on, soonest first; only one artist's when given. */
export function upcomingShows(userId: number, tz: string, artistId?: number): ShowRow[] {
	return all(
		`SELECT s.id, s.artist_id, a.name artist, ${IMAGE} image, s.date, s.venue, s.city, s.url, s.note, s.found_at, s.seen
		 FROM shows s JOIN artists a ON a.id = s.artist_id
		 WHERE s.user_id = ? AND s.date >= ? ${artistId ? 'AND s.artist_id = ?' : ''} ORDER BY s.date, a.name COLLATE NOCASE`,
		userId, today(tz), ...(artistId ? [artistId] : [])
	).map((r) => ({ ...r, seen: !!r.seen }));
}

export const removeShow = (userId: number, id: number) => Number(run('DELETE FROM shows WHERE user_id = ? AND id = ?', userId, id).changes) > 0;

/** How many upcoming shows the person hasn't looked at yet, for the badge in the menu. */
export const newShowCount = (userId: number, tz: string) => get('SELECT COUNT(*) n FROM shows WHERE user_id = ? AND seen = 0 AND date >= ?', userId, today(tz))!.n as number;

export const markShowsSeen = (userId: number) => run('UPDATE shows SET seen = 1 WHERE user_id = ? AND seen = 0', userId);
