import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let b: typeof import('./bans.js');
let s: typeof import('./stats.js');
let m: typeof import('./ingest.js');
let dbm: typeof import('./db.js');

const T = (iso: string) => Date.parse(iso) / 1000;
const scope = (ids = [1]) => ({ ids, since: 0, until: T('2030-01-01T00:00:00Z'), rankBy: 'plays' as const, tz: 'UTC' });
const names = (kind: 'track' | 'album' | 'artist', ids = [1]) => s.top(kind, scope(ids), 10).map((r) => [r.name, r.plays]);

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'trackerr-'));
	dbm = await import('./db.js');
	m = await import('./ingest.js');
	s = await import('./stats.js');
	b = await import('./bans.js');
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (1, 'a', 'UTC', 0)");
	dbm.run("INSERT INTO users (id, display_name, timezone, created_at) VALUES (2, 'b', 'UTC', 0)");
	// User 1: Radiohead x3 (two on OK Computer), Kids Songs x2 (one with no album), Bjork x1. User 2: Kids Songs x1.
	play(1, 'Radiohead', 'OK Computer', 'Karma Police', '2024-03-01T12:00:00Z');
	play(1, 'Radiohead', 'OK Computer', 'Airbag', '2024-03-02T12:00:00Z');
	play(1, 'Radiohead', 'Pablo Honey', 'Creep', '2024-03-03T12:00:00Z');
	play(1, 'Kids Songs', 'Nursery', 'Baby Shark', '2024-03-04T12:00:00Z');
	play(1, 'Kids Songs', null, 'Wheels on the Bus', '2024-03-05T12:00:00Z');
	play(1, 'Bjork', null, 'Joga', '2024-03-06T12:00:00Z');
	play(2, 'Kids Songs', 'Nursery', 'Baby Shark', '2024-03-07T12:00:00Z');
});

function play(userId: number, artist: string, album: string | null, title: string, iso: string) {
	const a = m.upsertArtist(artist);
	const al = album ? m.upsertAlbum(a, album) : null;
	const tr = m.upsertTrack(a, al, title, undefined, 200_000);
	m.insertPlay({ userId, trackId: tr.id, albumId: al, artistId: a, msPlayed: 200_000, source: 'import', durationMs: 200_000, playedAt: T(iso) });
}
const artist = (name: string) => m.upsertArtist(name);
const album = (a: string, name: string) => m.upsertAlbum(artist(a), name);
const track = (a: string, name: string) => m.upsertTrack(artist(a), null, name).id;

test('nothing banned leaves every query as it was', () => {
	expect(b.notBanned([1, 2])).toBe('');
	expect(s.totals(scope()).plays).toBe(6);
});

test('banning an artist drops their plays from every stat, for the person who banned them only', () => {
	expect(b.ban(1, 'artist', artist('Kids Songs'))).toBe(true);
	expect(names('artist')).toEqual([['Radiohead', 3], ['Bjork', 1]]);
	expect(names('track').map((r) => r[0])).not.toContain('Baby Shark');
	expect(names('album')).toEqual([['OK Computer', 2], ['Pablo Honey', 1]]);
	expect(s.totals(scope())).toMatchObject({ plays: 4, artists: 2, tracks: 4 });
	expect(s.countDistinct('artist', scope())).toBe(2);
	expect(s.entityTotals([1], 'artist_id', artist('Kids Songs')).plays).toBe(0);
	expect(s.firstHeardCount(scope())).toBe(4);
	// Someone else's plays of it still count for them, and for everyone combined.
	expect(names('artist', [2])).toEqual([['Kids Songs', 1]]);
	expect(names('artist', [1, 2])).toEqual(expect.arrayContaining([['Radiohead', 3], ['Bjork', 1], ['Kids Songs', 1]]));
	expect(s.totals(scope([1, 2])).plays).toBe(5);
	// Banning twice is harmless; banning something that doesn't exist is refused.
	expect(b.ban(1, 'artist', artist('Kids Songs'))).toBe(true);
	expect(b.ban(1, 'artist', 99999)).toBe(false);
});

test('unbanning brings every play back', () => {
	expect(b.unban(1, 'artist', artist('Kids Songs'))).toBe(true);
	expect(s.totals(scope()).plays).toBe(6);
	expect(b.unban(1, 'artist', artist('Kids Songs'))).toBe(false);
});

test('banning an album or a song drops just those plays; plays with no album are unaffected by album bans', () => {
	b.ban(1, 'album', album('Radiohead', 'OK Computer'));
	expect(names('artist')).toEqual([['Kids Songs', 2], ['Radiohead', 1], ['Bjork', 1]]);
	expect(s.totals(scope()).plays).toBe(4);
	b.ban(1, 'track', track('Bjork', 'Joga'));
	expect(names('artist')).toEqual([['Kids Songs', 2], ['Radiohead', 1]]);
	expect(s.monthly([1], 'track_id', track('Bjork', 'Joga'), 'UTC').months).toEqual([]);
	b.unban(1, 'album', album('Radiohead', 'OK Computer'));
	b.unban(1, 'track', track('Bjork', 'Joga'));
	expect(s.totals(scope()).plays).toBe(6);
});

test('a page knows which ban hides it', () => {
	const kids = artist('Kids Songs');
	b.ban(1, 'artist', kids);
	const shark = track('Kids Songs', 'Baby Shark');
	expect(b.banOn(1, 'track', shark)).toEqual({ kind: 'artist', id: kids, name: 'Kids Songs' });
	expect(b.banOn(1, 'album', album('Kids Songs', 'Nursery'))).toEqual({ kind: 'artist', id: kids, name: 'Kids Songs' });
	expect(b.banOn(1, 'artist', kids)).toEqual({ kind: 'artist', id: kids, name: 'Kids Songs' });
	expect(b.banOn(2, 'artist', kids)).toBeNull();
	expect(b.banOn(1, 'artist', artist('Radiohead'))).toBeNull();
	b.ban(1, 'track', track('Bjork', 'Joga'));
	expect(b.bansOf(1).map((r) => [r.kind, r.name, r.artist])).toEqual([
		['track', 'Joga', 'Bjork'],
		['artist', 'Kids Songs', null]
	]);
	expect(b.bansOf(2)).toEqual([]);
});

test('recommendations and seeds for banned music are filtered out', () => {
	const banned = b.bannedIds(1);
	expect(b.recBanned(banned, { artist: 'Kids Songs', artistId: artist('Kids Songs') })).toBe(true);
	expect(b.recBanned(banned, { artist: 'kids songs' })).toBe(true); // not linked to our ids: matched by name
	expect(b.recBanned(banned, { artist: 'Kids Songs', trackId: track('Kids Songs', 'Baby Shark') })).toBe(true);
	expect(b.recBanned(banned, { artist: 'Bjork', trackId: track('Bjork', 'Joga') })).toBe(true);
	expect(b.recBanned(banned, { artist: 'Bjork' })).toBe(false);
	expect(b.recBanned(banned, { artist: 'Radiohead', artistId: artist('Radiohead') })).toBe(false);
	const keys = b.bannedKeys(1);
	expect(keys.artist('KIDS SONGS')).toBe(true);
	expect(keys.song('Bjork', 'Joga')).toBe(true);
	expect(keys.song('Bjork', 'Army of Me')).toBe(false);
});

test('deleting a person deletes their bans', () => {
	dbm.run('DELETE FROM users WHERE id = 1');
	expect(dbm.get('SELECT COUNT(*) n FROM bans')!.n).toBe(0);
});
