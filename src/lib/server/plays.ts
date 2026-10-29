import { get, run, tx } from './db.js';
import { upsertArtist, upsertAlbum, upsertTrack } from './ingest.js';

// Editing play history: fixing a play's song or time, and deleting plays one at a time or in bulk.
// Everything writes to the `plays` rows themselves, so every stat page sees the correction at once.
// Only the person who owns the plays can change them; every statement is scoped to their user_id.

/** One play with the names of its song, artist and album; null when it isn't this person's. */
export function playOf(userId: number, playId: number) {
	return get(
		`SELECT p.id, p.track_id, p.album_id, p.artist_id, p.played_at, p.ms_played, p.source, t.name track, a.name artist, al.name album
		 FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = p.artist_id LEFT JOIN albums al ON al.id = p.album_id
		 WHERE p.id = ? AND p.user_id = ?`,
		playId,
		userId
	) as { id: number; track_id: number; album_id: number | null; artist_id: number; played_at: number; ms_played: number; source: string; track: string; artist: string; album: string | null } | undefined;
}

/** Moves a play to a new end-of-playback time (unix seconds). */
export function setPlayedAt(userId: number, playId: number, playedAt: number) {
	return Number(run('UPDATE plays SET played_at = ? WHERE id = ? AND user_id = ?', Math.trunc(playedAt), playId, userId).changes);
}

/**
 * Re-links a play (or, with `allOfSong`, every play of its song) to the song named by artist, album and title.
 * Names go through the same upserts as sync and import, so typing an existing song's exact names reuses it and
 * a new name creates the song and queues it for artwork lookup. Returns how many plays changed.
 */
export function relinkPlay(userId: number, playId: number, names: { artist: string; album: string; title: string }, allOfSong = false) {
	const artist = names.artist.trim(),
		album = names.album.trim(),
		title = names.title.trim();
	if (!artist || !title) throw new Error('A song needs at least an artist and a title.');
	return tx(() => {
		const p = playOf(userId, playId);
		if (!p) return 0;
		const artistId = upsertArtist(artist);
		const albumId = album ? upsertAlbum(artistId, album) : null;
		const track = upsertTrack(artistId, albumId, title);
		// A song that already exists may know its album even when none was typed.
		const trackAlbum = albumId ?? (get('SELECT album_id FROM tracks WHERE id = ?', track.id)?.album_id as number | null) ?? null;
		if (track.id === p.track_id && trackAlbum === p.album_id && artistId === p.artist_id) return 0;
		return Number(
			allOfSong
				? run('UPDATE plays SET track_id = ?, album_id = ?, artist_id = ? WHERE user_id = ? AND track_id = ?', track.id, trackAlbum, artistId, userId, p.track_id).changes
				: run('UPDATE plays SET track_id = ?, album_id = ?, artist_id = ? WHERE id = ? AND user_id = ?', track.id, trackAlbum, artistId, playId, userId).changes
		);
	});
}

export function deletePlay(userId: number, playId: number) {
	return Number(run('DELETE FROM plays WHERE id = ? AND user_id = ?', playId, userId).changes);
}

export type BulkFilter = { trackId?: number | null; albumId?: number | null; artistId?: number | null; since?: number | null; until?: number | null };

/** SQL for a bulk delete's scope (on `plays` with no alias); null when nothing narrows it, so a bare call can't wipe everything. */
function bulkWhere(userId: number, f: BulkFilter) {
	const where = ['user_id = ?'];
	const params: number[] = [userId];
	for (const [col, v] of [['track_id', f.trackId], ['album_id', f.albumId], ['artist_id', f.artistId], ['played_at >=', f.since], ['played_at <', f.until]] as const) {
		if (v === null || v === undefined || !Number.isFinite(v)) continue;
		where.push(col.includes(' ') ? `${col} ?` : `${col} = ?`);
		params.push(Math.trunc(v));
	}
	return where.length > 1 ? { sql: where.join(' AND '), params } : null;
}

/** How many plays a bulk delete would remove. */
export function countPlays(userId: number, f: BulkFilter) {
	const w = bulkWhere(userId, f);
	return w ? (get(`SELECT COUNT(*) n FROM plays WHERE ${w.sql}`, ...w.params)!.n as number) : 0;
}

/** Deletes every play of a song, album or artist, inside a time window, or both. Returns how many went. */
export function deletePlays(userId: number, f: BulkFilter) {
	const w = bulkWhere(userId, f);
	if (!w) throw new Error('Pick a song, album, artist or date range to delete.');
	return Number(run(`DELETE FROM plays WHERE ${w.sql}`, ...w.params).changes);
}
