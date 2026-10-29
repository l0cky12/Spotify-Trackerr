import { all, get, run, now } from './db.js';
import { key } from './ingest.js';

// Bans: songs, albums and artists a person never wants to see. Their plays stay in the database (so unbanning
// brings everything back) but drop out of every stat, list, chart and search, because stats.ts's user clause
// skips them. A ban is the owner's: it hides their own plays, whoever is looking.

export type BanKind = 'track' | 'album' | 'artist';
export const BAN_KINDS: BanKind[] = ['track', 'album', 'artist'];
const TABLE = { track: 'tracks', album: 'albums', artist: 'artists' } as const;
const COL = { track: 'p.track_id', album: 'IFNULL(p.album_id, 0)', artist: 'p.artist_id' } as const;

export function ban(userId: number, kind: BanKind, id: number) {
	if (!BAN_KINDS.includes(kind) || !get(`SELECT 1 FROM ${TABLE[kind]} WHERE id = ?`, id)) return false;
	run('INSERT INTO bans (user_id, kind, item_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', userId, kind, Math.trunc(id), now());
	return true;
}

export function unban(userId: number, kind: BanKind, id: number) {
	return Number(run('DELETE FROM bans WHERE user_id = ? AND kind = ? AND item_id = ?', userId, kind, id).changes) > 0;
}

/**
 * SQL to append to a `plays p` WHERE clause that drops these people's banned plays; empty when none of them banned anything.
 * Ids are integers from our own tables, so inlining them is safe.
 */
export function notBanned(ids: number[]) {
	if (!ids.length) return '';
	const rows = all(`SELECT user_id, kind, item_id FROM bans WHERE user_id IN (${ids.map((n) => Math.trunc(n)).join(',')})`);
	if (!rows.length) return '';
	const byUser = new Map<number, Record<BanKind, number[]>>();
	for (const r of rows) {
		const b = byUser.get(r.user_id) ?? { track: [], album: [], artist: [] };
		b[r.kind as BanKind].push(r.item_id);
		byUser.set(r.user_id, b);
	}
	return [...byUser]
		.map(([user, b]) => {
			const hit = BAN_KINDS.filter((k) => b[k].length).map((k) => `${COL[k]} IN (${b[k].join(',')})`);
			return ` AND NOT (p.user_id = ${user} AND (${hit.join(' OR ')}))`;
		})
		.join('');
}

/** A person's bans as id sets, for checking things that aren't plays (recommendations, now playing). */
export function bannedIds(userId: number) {
	const b = { track: new Set<number>(), album: new Set<number>(), artist: new Set<number>() };
	for (const r of all('SELECT kind, item_id FROM bans WHERE user_id = ?', userId)) b[r.kind as BanKind].add(r.item_id);
	return b;
}
export type Banned = ReturnType<typeof bannedIds>;

/** Whether a song (and so its album and artist) is banned. */
export function songBanned(b: Banned, trackId: number | null | undefined) {
	if (!trackId) return false;
	if (b.track.has(trackId)) return true;
	const t = get('SELECT artist_id, album_id FROM tracks WHERE id = ?', trackId);
	return !!t && (b.artist.has(t.artist_id) || (t.album_id !== null && b.album.has(t.album_id)));
}

/** Whether a recommendation points at something banned, by our ids or, for music not linked to them, by artist name. */
export function recBanned(b: Banned, r: { artist: string; artistId?: number | null; albumId?: number | null; trackId?: number | null }) {
	if ((r.artistId && b.artist.has(r.artistId)) || (r.albumId && b.album.has(r.albumId)) || songBanned(b, r.trackId)) return true;
	return !r.artistId && !!b.artist.size && !!get(`SELECT 1 FROM artists WHERE key = ? AND id IN (${[...b.artist].join(',')})`, key(r.artist));
}

/**
 * The ban that hides a song, album or artist page from this person, if any: the item itself, or for a song
 * its album or artist, or for an album its artist.
 */
export function banOn(userId: number, kind: BanKind, id: number): { kind: BanKind; id: number; name: string } | null {
	const row = get(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`, id);
	if (!row) return null;
	const candidates: [BanKind, number | null][] = [
		[kind, id],
		...(kind === 'track' ? ([['album', row.album_id]] as [BanKind, number | null][]) : []),
		...(kind !== 'artist' ? ([['artist', row.artist_id]] as [BanKind, number | null][]) : [])
	];
	for (const [k, itemId] of candidates) {
		if (itemId === null || !get('SELECT 1 FROM bans WHERE user_id = ? AND kind = ? AND item_id = ?', userId, k, itemId)) continue;
		return { kind: k, id: itemId, name: get(`SELECT name FROM ${TABLE[k]} WHERE id = ?`, itemId)!.name };
	}
	return null;
}

export type BanRow = { kind: BanKind; id: number; name: string; artist: string | null; image: string | null; created_at: number };

/** Everything a person banned, newest first, with names and pictures for Settings. */
export function bansOf(userId: number): BanRow[] {
	return all(
		`SELECT b.kind, b.item_id id, b.created_at,
			COALESCE(t.name, al.name, a.name) name,
			CASE b.kind WHEN 'track' THEN ta.name WHEN 'album' THEN ala.name END artist,
			CASE b.kind
				WHEN 'track' THEN COALESCE(t.image_override, t.image, tal.image_override, tal.image)
				WHEN 'album' THEN COALESCE(al.image_override, al.image)
				ELSE COALESCE(a.image_override, a.image) END image
		 FROM bans b
		 LEFT JOIN tracks t ON b.kind = 'track' AND t.id = b.item_id LEFT JOIN artists ta ON ta.id = t.artist_id LEFT JOIN albums tal ON tal.id = t.album_id
		 LEFT JOIN albums al ON b.kind = 'album' AND al.id = b.item_id LEFT JOIN artists ala ON ala.id = al.artist_id
		 LEFT JOIN artists a ON b.kind = 'artist' AND a.id = b.item_id
		 WHERE b.user_id = ? ORDER BY b.created_at DESC, b.rowid DESC`,
		userId
	) as BanRow[];
}

/** Banned artist names and artist + song names, as keys, for filtering seeds that come from Last.fm or ListenBrainz. */
export function bannedKeys(userId: number) {
	const artists = new Set(all("SELECT a.key FROM bans b JOIN artists a ON a.id = b.item_id WHERE b.user_id = ? AND b.kind = 'artist'", userId).map((r) => r.key as string));
	const songs = new Set(
		all("SELECT a.key artist, t.key title FROM bans b JOIN tracks t ON t.id = b.item_id JOIN artists a ON a.id = t.artist_id WHERE b.user_id = ? AND b.kind = 'track'", userId).map(
			(r) => `${r.artist}\0${r.title}`
		)
	);
	return { artist: (name: string) => artists.has(key(name)), song: (artist: string, title: string) => artists.has(key(artist)) || songs.has(`${key(artist)}\0${key(title)}`) };
}
