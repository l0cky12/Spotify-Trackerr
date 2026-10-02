import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Regression checks for the PR #3 review findings; every network response is mocked.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pr3-repro-'));
process.env.LASTFM_API_KEY = 'review-key';
process.env.LASTFM_SHARED_SECRET = 'review-secret';
const old = new DatabaseSync(join(process.env.DATA_DIR, 'trackerr.db'));
old.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, listenbrainz_token TEXT)');
old.exec("INSERT INTO users VALUES (999, 'Legacy', 0, 'obsolete-secret')");
old.close();
const db = await import('./db.js');
const legacyAfterMigration = db.get('SELECT listenbrainz_token, lastfm_user FROM users WHERE id = 999');
const recs = await import('./recs.js');
const start = await import('../../routes/auth/lastfm/+server.js');
const callback = await import('../../routes/auth/lastfm/callback/+server.js');
const settings = await import('../../routes/settings/+page.server.js');
const discover = await import('../../routes/discover/+page.server.js');
const { getJson, deezerStep } = await import('./enrich.js');
let testTime = Date.parse('2026-10-02T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(testTime += 60_000);
  for (const table of ['plays', 'sessions', 'cache', 'tracks', 'albums', 'artist_genres', 'artists', 'users']) db.run(`DELETE FROM ${table}`);
  db.run("INSERT INTO users (id, display_name, created_at, lastfm_user) VALUES (1, 'Alice', 0, 'alice-fm')");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const user = () => db.get('SELECT * FROM users WHERE id = 1');
const image = (url: string) => [{ size: 'extralarge', '#text': url }];
const defaults = (u: URL): unknown => {
  switch (u.searchParams.get('method')) {
    case 'user.gettopartists': return { topartists: { artist: [{ name: 'Seed' }] } };
    case 'user.gettoptracks': return { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }] } };
    case 'artist.getsimilar': return { similarartists: { artist: [{ name: 'New Band' }] } };
    case 'track.getsimilar': return { similartracks: { track: [{ name: 'Fresh', artist: { name: 'New Band' }, match: '1' }] } };
    case 'artist.gettopalbums': return { topalbums: { album: [{ name: 'Debut', artist: { name: 'New Band' }, image: image('https://lastfm/debut.jpg') }] } };
    case 'artist.getInfo': return { artist: { stats: { userplaycount: '0' } } };
    case 'track.getInfo': return { track: { userplaycount: '0' } };
    case 'album.getInfo': return { album: { userplaycount: '0' } };
    case 'auth.getSession': return { session: { name: 'alice-fm', key: 'not-stored' } };
  }
  return {};
};
function fakeFetch(lastfm: (u: URL) => unknown = defaults, deezer: unknown = { data: [{ name: 'New Band', title: 'Fresh', artist: { name: 'New Band' }, picture_big: 'https://deezer/artist.jpg', album: { cover_big: 'https://deezer/song.jpg' } }] }) {
  const calls: { url: URL; at: number; signal: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: u, at: Date.now(), signal: options?.signal });
    return new Response(JSON.stringify(u.hostname === 'ws.audioscrobbler.com' ? lastfm(u) : deezer));
  });
  return calls;
}
function cookieJar() {
  const values = new Map<string, string>();
  return { values, get: (name: string) => values.get(name), set: (name: string, value: string) => values.set(name, value), delete: (name: string) => values.delete(name) };
}
async function finish<T>(promise: Promise<T>): Promise<T> {
  let value!: T, error: unknown, failed = false;
  const handled = promise.then((v) => { value = v; }, (e) => { failed = true; error = e; });
  await vi.runAllTimersAsync();
  await handled;
  if (failed) throw error;
  return value;
}
const caught = async (fn: () => unknown) => { try { await finish(Promise.resolve(fn())); } catch (e) { return e as { status: number; location: string }; } };

test('excludes known Last.fm seed songs from recommendations', async () => {
  fakeFetch((u) => {
    if (u.searchParams.get('method') === 'user.gettoptracks') return { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }, { name: 'Already Scrobbled', artist: { name: 'Other' } }] } };
    if (u.searchParams.get('method') === 'track.getsimilar') return { similartracks: { track: [{ name: 'Already Scrobbled', artist: { name: 'Other' }, match: '1' }] } };
    return defaults(u);
  });
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.songs.map((r) => r.title)).not.toContain('Already Scrobbled');
});

test('prefers local album overrides over Last.fm art', async () => {
  db.run("INSERT INTO artists (id, name, key) VALUES (1, 'New Band', 'new band')");
  db.run("INSERT INTO albums (id, artist_id, name, key, image_override) VALUES (1, 1, 'Debut', 'debut', '/img/custom.png')");
  fakeFetch();
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.albums[0].albumId).toBe(1);
  expect(picks.albums[0].image).toBe('/img/custom.png');
});

test('excludes historical Last.fm artists, tracks and albums beyond the seed lists', async () => {
  fakeFetch((u) => {
    switch (u.searchParams.get('method')) {
      case 'artist.getsimilar': return { similarartists: { artist: [{ name: 'Heard Elsewhere' }, { name: 'New Band' }] } };
      case 'artist.getInfo': return { artist: { stats: { userplaycount: u.searchParams.get('artist') === 'Heard Elsewhere' ? '9' : '0' } } };
      case 'track.getInfo': return { track: { userplaycount: '4' } };
      case 'album.getInfo': return { album: { userplaycount: '2' } };
    }
    return defaults(u);
  });
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.artists.map((r) => r.artist)).toEqual(['New Band']);
  expect(picks.songs).toEqual([]);
  expect(picks.albums).toEqual([]);
});

test('ignores malformed seed and similar-music names instead of stringifying them', async () => {
  const calls = fakeFetch((u) => {
    switch (u.searchParams.get('method')) {
      case 'user.gettopartists': return { topartists: { artist: [{}, { name: 12 }, { name: ' ' }, { name: 'Seed' }] } };
      case 'user.gettoptracks': return { toptracks: { track: [{}, { name: 'bad', artist: {} }, { name: 'Seed Song', artist: { name: 'Seed' } }] } };
      case 'artist.getsimilar': return { similarartists: { artist: [{}, { name: 12 }, { name: 'New Band' }] } };
      case 'track.getsimilar': return { similartracks: { track: [{ match: 1 }, { name: 'bad', artist: {}, match: 1 }, { name: 'Fresh', artist: { name: 'New Band' }, match: 1 }] } };
    }
    return defaults(u);
  });
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.seeds).toEqual(['Seed']);
  expect(picks.songs.map((r) => r.title)).toEqual(['Fresh']);
  expect(calls.some((r) => [...r.url.searchParams.values()].includes('undefined'))).toBe(false);
});

test('preserves existing picks when Last.fm cannot verify listening history', async () => {
  fakeFetch();
  await finish(recs.buildDiscover(user()));
  const previous = recs.savedDiscover(1);
  fakeFetch((u) => u.searchParams.get('method') === 'artist.getInfo' ? { artist: {} } : defaults(u));
  const result = await finish(Promise.resolve(discover.actions.refresh({ locals: { user: user() } } as never)));
  expect(result).toMatchObject({ status: 502 });
  expect(recs.savedDiscover(1)).toEqual(previous);
});

test('a refresh already in flight cannot restore picks after unlink', async () => {
  const snapshot = user();
  fakeFetch((u) => {
    if (u.searchParams.get('method') === 'track.getInfo') recs.setLastfmUser(1, null);
    return defaults(u);
  });
  await finish(recs.buildDiscover(snapshot));
  expect(user().lastfm_user).toBeNull();
  expect(recs.savedDiscover(1)).toBeNull();
  expect(db.get('SELECT value FROM cache WHERE key = ?', 'discover:1')).toBeUndefined();
});

test('concurrent Discover lookups and background enrichment share the Deezer quota and backoff', async () => {
  db.run("INSERT INTO artists (id, name, key) VALUES (1, 'New Band', 'new band')");
  db.run("INSERT INTO tracks (id, artist_id, name, key) VALUES (1, 1, 'Fresh', 'fresh')");
  const times: number[] = [];
  vi.stubGlobal('fetch', async () => {
    times.push(Date.now());
    return new Response(JSON.stringify(times.length === 1 ? { error: { code: 4 } } : { data: [] }));
  });
  const first = getJson('https://api.deezer.com/search?q=first').catch(() => null);
  const background = deezerStep();
  const third = getJson('https://api.deezer.com/search?q=third');
  await finish(Promise.all([first, background, third]));
  expect(times).toHaveLength(3);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(10_000);
  expect(times[2] - times[1]).toBeGreaterThanOrEqual(125);
});

test('skips optional artwork while Deezer is unavailable instead of retrying each cover', async () => {
  const calls = fakeFetch(defaults, { error: { code: 4 } });
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.artists[0].image).toBeNull();
  expect(picks.songs[0].image).toBeNull();
  expect(calls.filter((r) => r.url.hostname === 'api.deezer.com')).toHaveLength(1);
});

test('caches verified artwork without repeating Deezer searches on refresh', async () => {
  const calls = fakeFetch();
  await finish(recs.buildDiscover(user()));
  const searches = calls.filter((r) => r.url.hostname === 'api.deezer.com').length;
  await finish(recs.buildDiscover(user()));
  expect(calls.filter((r) => r.url.hostname === 'api.deezer.com')).toHaveLength(searches);
});

test('rejects unrelated Deezer artwork', async () => {
  fakeFetch(defaults, { data: [{ name: 'Unrelated Artist', title: 'Wrong Song', artist: { name: 'Unrelated Artist' }, picture_big: 'https://deezer/wrong-artist.jpg', album: { cover_big: 'https://deezer/wrong-song.jpg' } }] });
  const picks = await finish(recs.buildDiscover(user()));
  expect(picks.artists[0].artist).toBe('New Band');
  expect(picks.artists[0].image).toBeNull();
  expect(picks.songs[0].image).toBeNull();
});

test('invalidates picks after unlink and linking another account', async () => {
  fakeFetch();
  await finish(recs.buildDiscover(user()));
  await settings.actions.lastfmUnlink({ locals: { user: user() } } as never);
  const unlinked = discover.load({ locals: { user: user() } } as never) as any;
  expect(unlinked.lastfmUser).toBeNull();
  expect(unlinked.picks).toBeNull();
  const jar = cookieJar();
  jar.set('lastfm_oauth', JSON.stringify({ state: 'nonce', userId: 1 }));
  fakeFetch((u) => u.searchParams.get('method') === 'auth.getSession' ? { session: { name: 'bob-fm' } } : defaults(u));
  await caught(() => callback.GET({ url: new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t'), cookies: jar, locals: { user: user() } } as never));
  const linked = discover.load({ locals: { user: user() } } as never) as any;
  expect(linked.lastfmUser).toBe('bob-fm');
  expect(linked.picks).toBeNull();
});

test('rejects linking after the Trackerr account changes', async () => {
  db.run("INSERT INTO users (id, display_name, created_at) VALUES (2, 'Bob', 0)");
  const jar = cookieJar();
  const redirect = await caught(() => start.GET({ url: new URL('https://review.test/auth/lastfm'), cookies: jar, locals: { user: user() } } as never));
  const target = new URL(new URL(redirect!.location).searchParams.get('cb')!);
  target.searchParams.set('token', 'alice-token');
  fakeFetch();
  await caught(() => callback.GET({ url: target, cookies: jar, locals: { user: db.get('SELECT * FROM users WHERE id = 2') } } as never));
  expect(db.get('SELECT lastfm_user FROM users WHERE id = 2').lastfm_user).toBeNull();
});

test('rejects malformed Last.fm identities without changing the connection', async () => {
  fakeFetch(() => ({ session: {} }));
  const jar = cookieJar(); jar.set('lastfm_oauth', JSON.stringify({ state: 'nonce', userId: 1 }));
  await caught(() => callback.GET({ url: new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t'), cookies: jar, locals: { user: user() } } as never));
  expect(user().lastfm_user).toBe('alice-fm');
});

test('clears obsolete ListenBrainz credentials during migration', () => {
  expect(legacyAfterMigration.listenbrainz_token).toBeNull();
  expect(legacyAfterMigration.lastfm_user).toBeNull();
});

test('paces a full artwork refresh and attaches request deadlines', async () => {
  const calls = fakeFetch((u) => {
    switch (u.searchParams.get('method')) {
      case 'user.gettoptracks': return { toptracks: { track: [{ name: 'Seed One', artist: { name: 'Seed' } }, { name: 'Seed Two', artist: { name: 'Seed' } }] } };
      case 'artist.getsimilar': return { similarartists: { artist: Array.from({ length: 12 }, (_, i) => ({ name: `New Artist ${i}` })) } };
      case 'track.getsimilar': return { similartracks: { track: Array.from({ length: 15 }, (_, i) => ({ name: `${u.searchParams.get('track')}-${i}`, artist: { name: 'Song Artist' }, match: '1' })) } };
      case 'artist.gettopalbums': return { topalbums: { album: [{ name: 'Debut', artist: { name: u.searchParams.get('artist') } }] } };
    }
    return defaults(u);
  }, { data: [] });
  await finish(recs.buildDiscover(user()));
  const deezer = calls.filter((r) => r.url.hostname === 'api.deezer.com');
  expect(deezer).toHaveLength(54);
  expect(deezer.at(-1)!.at - deezer[0].at).toBeGreaterThanOrEqual(53 * 125);
  expect(deezer.every((r) => r.signal instanceof AbortSignal)).toBe(true);
});

test.each(['missing', 'mismatched', 'cancelled', 'anonymous', 'malformed'])('security control rejects %s callback before API exchange', async (kind) => {
  const calls = fakeFetch();
  const jar = cookieJar();
  if (kind !== 'missing') jar.set('lastfm_oauth', JSON.stringify({ state: 'nonce', userId: 1 }));
  if (kind === 'malformed') jar.set('lastfm_oauth', '{bad');
  const url = new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t');
  if (kind === 'mismatched') url.searchParams.set('state', 'wrong');
  if (kind === 'cancelled') url.searchParams.delete('token');
  const result = await caught(() => callback.GET({ url, cookies: jar, locals: { user: kind === 'anonymous' ? null : user() } } as never));
  expect(result?.status).toBe(303);
  expect(calls).toHaveLength(0);
  expect(user().lastfm_user).toBe('alice-fm');
});
