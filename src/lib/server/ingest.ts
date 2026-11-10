import { unzipSync, strFromU8 } from 'fflate';
import { db, get, run, tx, now, PLAY_SOURCES } from './db.js';

export type PlaySource = (typeof PLAY_SOURCES)[number];

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

/** Saves the artists credited on a song besides its main one, and marks its credits as looked up. */
export function setFeatures(trackId: number, names: string[]) {
	for (const n of names) run('INSERT OR IGNORE INTO track_features (track_id, name) VALUES (?, ?)', trackId, n);
	run('UPDATE tracks SET credits_done = 1 WHERE id = ?', trackId);
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
	source: PlaySource;
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

/** One entry of an uploaded history file, whatever service it came from. A play with msPlayed null ran for an unknown time. */
export type HistoryEntry =
	| { kind: 'play'; artist: string; title: string; album: string | null; playedAt: number; msPlayed: number | null; spotifyId?: string; source: PlaySource }
	| { kind: 'skip'; reason: 'short' | 'private' | 'other' };

const other = { kind: 'skip', reason: 'other' } as const;

/** Spotify's extended streaming history (Streaming_History_Audio_*.json, or endsong_*.json in older exports). */
function spotifyEntry(e: {
	ts?: string;
	ms_played?: number;
	master_metadata_track_name?: string | null;
	master_metadata_album_artist_name?: string | null;
	master_metadata_album_album_name?: string | null;
	spotify_track_uri?: string | null;
	reason_end?: string | null;
	incognito_mode?: boolean | null;
}): HistoryEntry {
	const uri = e.spotify_track_uri ?? '';
	const title = e.master_metadata_track_name;
	const artist = e.master_metadata_album_artist_name;
	if (!uri.startsWith('spotify:track:') || !title || !artist || !e.ts) return other;
	if (e.incognito_mode) return { kind: 'skip', reason: 'private' };
	const ms = e.ms_played ?? 0;
	if (ms < 30_000 && e.reason_end !== 'trackdone') return { kind: 'skip', reason: 'short' };
	return {
		kind: 'play',
		artist,
		title,
		album: e.master_metadata_album_album_name || null,
		playedAt: Math.floor(Date.parse(e.ts) / 1000),
		msPlayed: ms,
		spotifyId: uri.slice(14),
		source: 'import'
	};
}

/**
 * Google Takeout's YouTube watch history (watch-history.json). Only YouTube Music plays count. YouTube Music
 * names an auto-generated artist channel "<Artist> - Topic", and a removed video keeps only its address as the title.
 * Takeout says neither how long a song ran nor its album.
 */
function takeoutEntry(e: { header?: string; title?: string; subtitles?: { name?: string }[]; time?: string }): HistoryEntry {
	const title = e.title?.replace(/^Watched /, '').trim();
	const artist = e.subtitles?.[0]?.name?.replace(/ - Topic$/, '').trim();
	const playedAt = Math.floor(Date.parse(e.time ?? '') / 1000);
	if (e.header !== 'YouTube Music' || !title || !artist || /^https?:\/\//.test(title) || !Number.isFinite(playedAt)) return other;
	return { kind: 'play', artist, title, album: null, playedAt, msPlayed: null, source: 'takeout' };
}

/** The history files people can upload: how to recognise each from its first entry, and how to read one entry. */
const FORMATS: { detect: (first: Record<string, unknown>) => boolean; entry: (raw: any) => HistoryEntry }[] = [
	{ detect: (first) => 'ts' in first, entry: spotifyEntry },
	{ detect: (first) => 'header' in first && 'time' in first, entry: takeoutEntry }
];

const isSpotifyHistory = (path: string) => /\.json$/i.test(path) && /(audio|endsong)/i.test(path.split('/').pop()!);
// Takeout localizes its folder names but not this file name.
const isTakeoutHistory = (path: string) => /(^|\/)watch-history\.json$/i.test(path);
const TAKEOUT_HTML =
	'Your YouTube history is in HTML. Export it again from Google Takeout: under "Multiple formats", choose JSON for history, then upload the new .zip or its watch-history.json.';

export type ImportSummary = { files: string[]; added: number; duplicates: number; skipped_short: number; skipped_private: number; skipped_other: number };

/** Reads uploaded Spotify extended history and YouTube Takeout watch history: the .json files, or the .zip they came in. */
export function readUploads(files: { name: string; data: Uint8Array }[]) {
	const out: { name: string; entries: HistoryEntry[] }[] = [];
	for (const f of files) {
		if (/watch-history\.html$/i.test(f.name)) throw new Error(TAKEOUT_HTML);
		if (f.name.toLowerCase().endsWith('.zip')) {
			let takeoutHtml = false;
			const inner = unzipSync(f.data, {
				filter: (e) => {
					takeoutHtml ||= /(^|\/)watch-history\.html$/i.test(e.name);
					return isSpotifyHistory(e.name) || isTakeoutHistory(e.name);
				}
			});
			if (takeoutHtml && !Object.keys(inner).some(isTakeoutHistory)) throw new Error(TAKEOUT_HTML);
			for (const [name, data] of Object.entries(inner)) out.push({ name: name.split('/').pop()!, entries: parse(name, data) });
		} else {
			out.push({ name: f.name, entries: parse(f.name, f.data) });
		}
	}
	if (!out.length)
		throw new Error(
			"No listening history found. Upload Spotify's Streaming_History_Audio_*.json files or the .zip Spotify emailed you, or YouTube Music's watch-history.json or the Google Takeout .zip."
		);
	return out;
}

function parse(name: string, data: Uint8Array): HistoryEntry[] {
	let json: unknown;
	try {
		json = JSON.parse(strFromU8(data));
	} catch {
		throw new Error(`${name} isn't valid JSON.`);
	}
	if (!Array.isArray(json)) throw new Error(`${name} isn't a listening history file.`);
	if (!json.length) return [];
	const format = FORMATS.find((f) => f.detect(json[0] ?? {}));
	if (format) return json.map(format.entry);
	if ('endTime' in json[0])
		throw new Error(`${name} looks like the basic "Account data" export. Request "Extended streaming history" from Spotify's privacy page instead; it includes albums and your full history.`);
	throw new Error(`${name} isn't a Spotify streaming history or YouTube watch history file.`);
}

export function importEntries(userId: number, files: { name: string; entries: HistoryEntry[] }[]): ImportSummary {
	const s: ImportSummary = { files: files.map((f) => f.name), added: 0, duplicates: 0, skipped_short: 0, skipped_private: 0, skipped_other: 0 };
	tx(() => {
		const artists = new Map<string, number>();
		const albums = new Map<string, number>();
		const tracks = new Map<string, { id: number; durationMs: number | null }>();
		for (const { entries } of files) {
			for (const e of entries) {
				if (e.kind === 'skip') {
					s[`skipped_${e.reason}`]++;
					continue;
				}
				let artistId = artists.get(e.artist);
				if (artistId === undefined) artists.set(e.artist, (artistId = upsertArtist(e.artist)));
				let albumId: number | null = null;
				if (e.album) {
					const ak = artistId + '\0' + e.album;
					albumId = albums.get(ak) ?? null;
					if (albumId === null) albums.set(ak, (albumId = upsertAlbum(artistId, e.album)));
				}
				const tk = artistId + '\0' + e.title;
				let track = tracks.get(tk);
				if (!track) tracks.set(tk, (track = upsertTrack(artistId, albumId, e.title, e.spotifyId)));
				const ok = insertPlay({
					userId,
					trackId: track.id,
					albumId,
					artistId,
					playedAt: e.playedAt,
					msPlayed: e.msPlayed ?? track.durationMs ?? 0,
					source: e.source,
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
