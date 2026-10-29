import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let p: typeof import('./plays.js');
let s: typeof import('./stats.js');
let m: typeof import('./ingest.js');
let dbm: typeof import('./db.js');

const T = (iso: string) => Date.parse(iso) / 1000;
const scope = { ids: [1], since: 0, until: T('2030-01-01T00:00:00Z'), rankBy: 'plays' as const, tz: 'UTC' };
const names = (kind: 'track' | 'album' | 'artist') => s.top(kind, scope, 10).map((r) => [r.name, r.plays]);

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	s = await import('./stats.js');
	p = await import('./plays.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'UTC', 0)");
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (2, 'b', 'UTC', 0)");
});

function play(userId: number, artist: string, album: string | null, title: string, iso: string) {
	const a = m.upsertArtist(artist);
	const al = album ? m.upsertAlbum(a, album) : null;
	const tr = m.upsertTrack(a, al, title, undefined, 200_000);
	m.insertPlay({ userId, trackId: tr.id, albumId: al, artistId: a, msPlayed: 200_000, source: 'import', durationMs: 200_000, playedAt: T(iso) });
	return dbm.get('SELECT id FROM plays WHERE user_id = ? AND played_at = ?', userId, T(iso))!.id as number;
}

test('editing a play re-links it and every stat page sees the corrected plays', () => {
	// A typo'd artist got three plays; one is really by Radiohead.
	const bad1 = play(1, 'Radiohed', 'Pablo Honey', 'Creep', '2024-03-01T12:00:00Z');
	play(1, 'Radiohed', 'Pablo Honey', 'Creep', '2024-03-02T12:00:00Z');
	play(1, 'Radiohed', 'Pablo Honey', 'Creep', '2024-03-03T12:00:00Z');
	play(1, 'Radiohead', 'OK Computer', 'Karma Police', '2024-03-04T12:00:00Z');
	play(2, 'Radiohed', 'Pablo Honey', 'Creep', '2024-03-05T12:00:00Z'); // someone else's; must stay put
	expect(names('artist')).toEqual([['Radiohed', 3], ['Radiohead', 1]]);

	// One play: typing the existing artist's exact name links to that artist; the album and song are new under it.
	expect(p.relinkPlay(1, bad1, { artist: 'Radiohead', album: 'Pablo Honey', title: 'Creep' })).toBe(1);
	expect(names('artist')).toEqual([['Radiohed', 2], ['Radiohead', 2]]);
	expect(names('album')).toEqual([['Pablo Honey', 2], ['OK Computer', 1], ['Pablo Honey', 1]]);

	// Every remaining play of the typo'd song in one go, by whichever play is at hand.
	const other = dbm.get("SELECT p.id FROM plays p JOIN artists a ON a.id = p.artist_id WHERE a.name = 'Radiohed' AND p.user_id = 1")!.id;
	expect(p.relinkPlay(1, other, { artist: 'Radiohead', album: 'Pablo Honey', title: 'Creep' }, true)).toBe(2);
	expect(names('artist')).toEqual([['Radiohead', 4]]);
	expect(names('track')).toEqual([['Creep', 3], ['Karma Police', 1]]);
	expect(s.entityTotals([1], 'artist_id', m.upsertArtist('Radiohead')).plays).toBe(4);
	// Saving the same names again changes nothing.
	expect(p.relinkPlay(1, bad1, { artist: 'Radiohead', album: 'Pablo Honey', title: 'Creep' })).toBe(0);
	// User 2's play of the typo'd song is untouched, and user 1 can't edit it.
	expect(s.top('artist', { ...scope, ids: [2] }, 10).map((r) => r.name)).toEqual(['Radiohed']);
	const theirs = dbm.get('SELECT id FROM plays WHERE user_id = 2')!.id;
	expect(p.relinkPlay(1, theirs, { artist: 'Radiohead', album: '', title: 'Creep' })).toBe(0);
	expect(p.setPlayedAt(1, theirs, T('2020-01-01T00:00:00Z'))).toBe(0);
	expect(() => p.relinkPlay(1, bad1, { artist: '', album: '', title: 'Creep' })).toThrow();
});

test('moving a play in time changes which period it counts in', () => {
	const id = dbm.get('SELECT id FROM plays WHERE user_id = 1 ORDER BY played_at LIMIT 1')!.id;
	const march = { ...scope, since: T('2024-03-01T00:00:00Z'), until: T('2024-04-01T00:00:00Z') };
	expect(s.totals(march).plays).toBe(4);
	expect(p.setPlayedAt(1, id, T('2024-02-10T10:00:00Z'))).toBe(1);
	expect(s.totals(march).plays).toBe(3);
	expect(s.totals({ ...scope, since: T('2024-02-01T00:00:00Z'), until: T('2024-03-01T00:00:00Z') }).plays).toBe(1);
	expect(p.playOf(1, id)!.played_at).toBe(T('2024-02-10T10:00:00Z'));
});

test('bulk delete by song, artist or date range, never across people or everything at once', () => {
	play(1, 'Filler', 'Noise', 'Static', '2024-05-01T12:00:00Z');
	play(1, 'Filler', 'Noise', 'Static', '2024-05-02T12:00:00Z');
	play(1, 'Filler', 'Noise', 'Hiss', '2024-06-02T12:00:00Z');
	play(2, 'Filler', 'Noise', 'Static', '2024-05-03T12:00:00Z');
	const filler = m.upsertArtist('Filler');
	const statik = m.upsertTrack(filler, null, 'Static').id;

	expect(() => p.deletePlays(1, {})).toThrow();
	expect(p.countPlays(1, { trackId: statik })).toBe(2);
	expect(p.deletePlays(1, { trackId: statik, since: T('2024-05-02T00:00:00Z') })).toBe(1);
	expect(p.deletePlays(1, { artistId: filler })).toBe(2);
	expect(p.countPlays(1, { artistId: filler })).toBe(0);
	expect(p.countPlays(2, { artistId: filler })).toBe(1);
	expect(p.deletePlays(1, { since: T('2024-01-01T00:00:00Z'), until: T('2024-03-03T00:00:00Z') })).toBe(2);
	expect(s.totals(scope).plays).toBe(2);
	expect(p.deletePlay(1, dbm.get('SELECT id FROM plays WHERE user_id = 2')!.id)).toBe(0);
});
