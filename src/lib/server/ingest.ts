import { unzipSync, strFromU8 } from 'fflate';
import { db, get, run, tx, now } from './db.js';

/** Matching key: case/accents/whitespace-insensitive, ignores "Remastered" suffixes. */
export function key(s: string) {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\s*[-–]\s*[^-–]*remaster[^-–]*$/u, '')
		.replace(/\s*[([][^)\]]*remaster[^)\]]*[)\]]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function upsertArtist(name: string, spotifyId?: string) {
	const k = key(name);
	const row = get('SELECT id, spotify_id FROM artists WHERE key = ?', k);
	if (row) {
		if (spotifyId && !row.spotify_id) run('UPDATE artists SET spotify_id = ? WHERE id = ?', spotifyId, row.id);
		return row.id as number;
	}
	return Number(run('INSERT INTO artists (name, key, spotify_id) VALUES (?, ?, ?)', name, k, spotifyId ?? null).lastInsertRowid);
}

export function upsertAlbum(artistId: number, name: string, extra: { image?: string; year?: number } = {}) {
	const k = key(name);
	const row = get('SELECT id, image, release_year FROM albums WHERE artist_id = ? AND key = ?', artistId, k);
	if (row) {
		if ((extra.image && !row.image) || (extra.year && !row.release_year))
			run('UPDATE albums SET image = COALESCE(image, ?), release_year = COALESCE(release_year, ?) WHERE id = ?', extra.image ?? null, extra.year ?? null, row.id);
		return row.id as number;
	}
	return Number(
		run('INSERT INTO albums (artist_id, name, key, image, release_year) VALUES (?, ?, ?, ?, ?)', artistId, name, k, extra.image ?? null, extra.year ?? null)
			.lastInsertRowid
	);
}

export function upsertTrack(artistId: number, albumId: number | null, name: string, spotifyId?: string, durationMs?: number) {
	const k = key(name);
	const row = get('SELECT id, spotify_id, duration_ms, album_id FROM tracks WHERE artist_id = ? AND key = ?', artistId, k);
	if (row) {
		if ((spotifyId && !row.spotify_id) || (durationMs && !row.duration_ms) || (albumId && !row.album_id))
			run(
				'UPDATE tracks SET spotify_id = COALESCE(spotify_id, ?), duration_ms = COALESCE(duration_ms, ?), album_id = COALESCE(album_id, ?) WHERE id = ?',
				spotifyId ?? null,
				durationMs ?? null,
				albumId,
				row.id
			);
		return { id: row.id as number, durationMs: (row.duration_ms ?? durationMs ?? null) as number | null };
	}
	const id = Number(
		run('INSERT INTO tracks (artist_id, album_id, name, key, spotify_id, duration_ms) VALUES (?, ?, ?, ?, ?, ?)', artistId, albumId, name, k, spotifyId ?? null, durationMs ?? null)
			.lastInsertRowid
	);
	return { id, durationMs: durationMs ?? null };
}

/**
 * Inserts a play unless it duplicates one already stored.
 * Same source: duplicate only on the exact same timestamp (re-imported file, overlapping sync pages).
 * Different source: duplicate if within 3 minutes, widened to the song's length because Spotify's
 * live `played_at` may mark the start of playback while the export marks the end.
 */
export function insertPlay(p: {
	userId: number;
	trackId: number;
	albumId: number | null;
	artistId: number;
	playedAt: number;
	msPlayed: number;
	source: 'import' | 'sync';
	durationMs: number | null;
}) {
	const win = Math.max(180, Math.round((p.durationMs ?? 0) / 1000) + 30);
	const near = db_near.all(p.userId, p.trackId, p.playedAt - win, p.playedAt + win) as { played_at: number; source: string }[];
	if (near.some((n) => n.source !== p.source || n.played_at === p.playedAt)) return false;
	run(
		'INSERT INTO plays (user_id, track_id, album_id, artist_id, played_at, ms_played, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
		p.userId,
		p.trackId,
		p.albumId,
		p.artistId,
		p.playedAt,
		p.msPlayed,
		p.source
	);
	return true;
}
const db_near = db.prepare('SELECT played_at, source FROM plays WHERE user_id = ? AND track_id = ? AND played_at BETWEEN ? AND ?');

type ExtendedEntry = {
	ts?: string;
	ms_played?: number;
	master_metadata_track_name?: string | null;
	master_metadata_album_artist_name?: string | null;
	master_metadata_album_album_name?: string | null;
	spotify_track_uri?: string | null;
	reason_end?: string | null;
	incognito_mode?: boolean | null;
};

export type ImportSummary = { files: string[]; added: number; duplicates: number; skipped_short: number; skipped_private: number; skipped_other: number };

/** Pulls extended-history JSON arrays out of uploaded .json files and Spotify's .zip. */
export function readUploads(files: { name: string; data: Uint8Array }[]) {
	const out: { name: string; entries: ExtendedEntry[] }[] = [];
	for (const f of files) {
		if (f.name.toLowerCase().endsWith('.zip')) {
			const inner = unzipSync(f.data, { filter: (e) => /\.json$/i.test(e.name) && /(audio|endsong)/i.test(e.name) });
			for (const [name, data] of Object.entries(inner)) out.push({ name: name.split('/').pop()!, entries: parse(name, data) });
		} else {
			out.push({ name: f.name, entries: parse(f.name, f.data) });
		}
	}
	if (!out.length) throw new Error('No streaming history files found. Upload the Streaming_History_Audio_*.json files or the .zip Spotify emailed you.');
	return out;
}

function parse(name: string, data: Uint8Array): ExtendedEntry[] {
	let json: unknown;
	try {
		json = JSON.parse(strFromU8(data));
	} catch {
		throw new Error(`${name} isn't valid JSON.`);
	}
	if (!Array.isArray(json)) throw new Error(`${name} isn't a streaming history file.`);
	if (json.length && !('ts' in json[0])) {
		throw new Error(`${name} looks like the basic "Account data" export. Request "Extended streaming history" from Spotify's privacy page instead; it includes albums and your full history.`);
	}
	return json;
}

export function importEntries(userId: number, files: { name: string; entries: ExtendedEntry[] }[]): ImportSummary {
	const s: ImportSummary = { files: files.map((f) => f.name), added: 0, duplicates: 0, skipped_short: 0, skipped_private: 0, skipped_other: 0 };
	tx(() => {
		const artists = new Map<string, number>();
		const albums = new Map<string, number>();
		const tracks = new Map<string, { id: number; durationMs: number | null }>();
		for (const { entries } of files) {
			for (const e of entries) {
				const uri = e.spotify_track_uri ?? '';
				const title = e.master_metadata_track_name;
				const artist = e.master_metadata_album_artist_name;
				if (!uri.startsWith('spotify:track:') || !title || !artist || !e.ts) {
					s.skipped_other++;
					continue;
				}
				if (e.incognito_mode) {
					s.skipped_private++;
					continue;
				}
				const ms = e.ms_played ?? 0;
				if (ms < 30_000 && e.reason_end !== 'trackdone') {
					s.skipped_short++;
					continue;
				}
				let artistId = artists.get(artist);
				if (artistId === undefined) artists.set(artist, (artistId = upsertArtist(artist)));
				const albumName = e.master_metadata_album_album_name;
				let albumId: number | null = null;
				if (albumName) {
					const ak = artistId + '\0' + albumName;
					albumId = albums.get(ak) ?? null;
					if (albumId === null) albums.set(ak, (albumId = upsertAlbum(artistId, albumName)));
				}
				const tk = artistId + '\0' + title;
				let track = tracks.get(tk);
				if (!track) tracks.set(tk, (track = upsertTrack(artistId, albumId, title, uri.slice(14))));
				const ok = insertPlay({
					userId,
					trackId: track.id,
					albumId,
					artistId,
					playedAt: Math.floor(Date.parse(e.ts) / 1000),
					msPlayed: ms,
					source: 'import',
					durationMs: track.durationMs
				});
				if (ok) s.added++;
				else s.duplicates++;
			}
		}
		run(
			'INSERT INTO imports (user_id, created_at, files, added, duplicates, skipped_short, skipped_private, skipped_other) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			userId,
			now(),
			s.files.join(', '),
			s.added,
			s.duplicates,
			s.skipped_short,
			s.skipped_private,
			s.skipped_other
		);
	});
	return s;
}
