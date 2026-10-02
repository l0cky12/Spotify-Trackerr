import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let m: typeof import('./ingest.js');
let s: typeof import('./stats.js');
let t: typeof import('../time.js');
let dbm: typeof import('./db.js');

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	s = await import('./stats.js');
	t = await import('../time.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'America/New_York', 0)");
});

const entry = (ts: string, ms: number, extra: Record<string, unknown> = {}) => ({
	ts,
	ms_played: ms,
	master_metadata_track_name: 'Creep',
	master_metadata_album_artist_name: 'Radiohead',
	master_metadata_album_album_name: 'Pablo Honey',
	spotify_track_uri: 'spotify:track:abc',
	reason_end: 'endplay',
	incognito_mode: false,
	...extra
});

test('match keys ignore case, accents and remaster suffixes', () => {
	expect(m.key('Creep - Remastered 2009')).toBe('creep');
	expect(m.key('Beyoncé')).toBe('beyonce');
	expect(m.key('Song (2011 Remaster)')).toBe('song');
});

test('import rules and duplicate detection', () => {
	const file = [
		entry('2024-03-01T12:00:00Z', 240_000),
		entry('2024-03-01T13:00:00Z', 10_000), // skipped: short
		entry('2024-03-01T14:00:00Z', 25_000, { reason_end: 'trackdone' }), // counts: finished
		entry('2024-03-01T15:00:00Z', 240_000, { incognito_mode: true }), // private session
		entry('2024-03-01T16:00:00Z', 240_000, { spotify_track_uri: null, master_metadata_track_name: null }) // podcast
	];
	const a = m.importEntries(1, [{ name: 'f.json', entries: file }]);
	expect(a).toMatchObject({ added: 2, duplicates: 0, skipped_short: 1, skipped_private: 1, skipped_other: 1 });

	// Re-importing the same file adds nothing.
	expect(m.importEntries(1, [{ name: 'f.json', entries: file }]).added).toBe(0);

	// A live-synced copy of the same play, stamped at its start (4 min earlier), is a duplicate.
	const artist = m.upsertArtist('Radiohead');
	const track = m.upsertTrack(artist, null, 'Creep', 'abc', 240_000);
	const base = { userId: 1, trackId: track.id, albumId: null, artistId: artist, msPlayed: 240_000, source: 'sync' as const, durationMs: 240_000 };
	expect(m.insertPlay({ ...base, playedAt: Date.parse('2024-03-01T11:56:00Z') / 1000 })).toBe(false);
	// A genuinely separate play an hour later is kept.
	expect(m.insertPlay({ ...base, playedAt: Date.parse('2024-03-01T18:00:00Z') / 1000 })).toBe(true);
});

test('time zone helpers and bucketing', () => {
	// New York is UTC-5 in winter.
	expect(t.offsetAt('America/New_York', Date.parse('2024-01-15T12:00:00Z') / 1000)).toBe(-5 * 3600);
	expect(t.fromLocal('America/New_York', 2024, 0, 1)).toBe(Date.parse('2024-01-01T05:00:00Z') / 1000);

	const until = Date.parse('2024-03-08T00:00:00Z') / 1000;
	const ts = s.timeSeries({ ids: [1], since: until - 7 * 86400, until, rankBy: 'plays', tz: 'America/New_York' }, []);
	expect(ts.unit).toBe('day');
	expect(ts.cur.reduce((a, b) => a + b, 0)).toBe(3);

	const mo = s.monthly([1], 'artist_id', m.upsertArtist('Radiohead'), 'America/New_York');
	expect(mo.peak).toMatchObject({ y: 2024, m: 2, plays: 3 });
});
