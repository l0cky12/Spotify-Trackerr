import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Review-only checks against the unmodified, pinned PR implementation.
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

beforeEach(() => {
  for (const table of ['plays', 'sessions', 'cache', 'tracks', 'albums', 'artist_genres', 'artists', 'users']) db.run(`DELETE FROM ${table}`);
  db.run("INSERT INTO users (id, display_name, created_at, lastfm_user) VALUES (1, 'Alice', 0, 'alice-fm')");
});
afterEach(() => vi.unstubAllGlobals());

const user = () => db.get('SELECT * FROM users WHERE id = 1');
const image = (url: string) => [{ size: 'extralarge', '#text': url }];
const defaults = (u: URL): unknown => {
  switch (u.searchParams.get('method')) {
    case 'user.gettopartists': return { topartists: { artist: [{ name: 'Seed' }] } };
    case 'user.gettoptracks': return { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }] } };
    case 'artist.getsimilar': return { similarartists: { artist: [{ name: 'New Band' }] } };
    case 'track.getsimilar': return { similartracks: { track: [{ name: 'Fresh', artist: { name: 'New Band' }, match: '1' }] } };
    case 'artist.gettopalbums': return { topalbums: { album: [{ name: 'Debut', artist: { name: 'New Band' }, image: image('https://lastfm/debut.jpg') }] } };
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
const caught = async (fn: () => unknown) => { try { await fn(); } catch (e) { return e as { status: number; location: string }; } };

test('reproduces a known Last.fm top song in the new-song recommendations', async () => {
  fakeFetch((u) => {
    if (u.searchParams.get('method') === 'user.gettoptracks') return { toptracks: { track: [{ name: 'Seed Song', artist: { name: 'Seed' } }, { name: 'Already Scrobbled', artist: { name: 'Other' } }] } };
    if (u.searchParams.get('method') === 'track.getsimilar') return { similartracks: { track: [{ name: 'Already Scrobbled', artist: { name: 'Other' }, match: '1' }] } };
    return defaults(u);
  });
  const picks = await recs.buildDiscover(user());
  expect(picks.songs.map((r) => r.title)).toContain('Already Scrobbled');
});

test('reproduces Last.fm art replacing a local album override', async () => {
  db.run("INSERT INTO artists (id, name, key) VALUES (1, 'New Band', 'new band')");
  db.run("INSERT INTO albums (id, artist_id, name, key, image_override) VALUES (1, 1, 'Debut', 'debut', '/img/custom.png')");
  fakeFetch();
  const picks = await recs.buildDiscover(user());
  expect(picks.albums[0].albumId).toBe(1);
  expect(picks.albums[0].image).toBe('https://lastfm/debut.jpg');
});

test('reproduces artwork taken from an unrelated Deezer first result', async () => {
  fakeFetch(defaults, { data: [{ name: 'Unrelated Artist', title: 'Wrong Song', artist: { name: 'Unrelated Artist' }, picture_big: 'https://deezer/wrong-artist.jpg', album: { cover_big: 'https://deezer/wrong-song.jpg' } }] });
  const picks = await recs.buildDiscover(user());
  expect(picks.artists[0].artist).toBe('New Band');
  expect(picks.artists[0].image).toBe('https://deezer/wrong-artist.jpg');
  expect(picks.songs[0].image).toBe('https://deezer/wrong-song.jpg');
});

test('reproduces cached Last.fm picks surviving unlink and a new link', async () => {
  fakeFetch();
  await recs.buildDiscover(user());
  await settings.actions.lastfmUnlink({ locals: { user: user() } } as never);
  const unlinked = discover.load({ locals: { user: user() } } as never) as any;
  expect(unlinked.lastfmUser).toBeNull();
  expect(unlinked.picks.fromLastfm).toBe(true);
  const jar = cookieJar();
  jar.set('lastfm_oauth', 'nonce');
  fakeFetch((u) => u.searchParams.get('method') === 'auth.getSession' ? { session: { name: 'bob-fm' } } : defaults(u));
  await caught(() => callback.GET({ url: new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t'), cookies: jar, locals: { user: user() } } as never));
  const linked = discover.load({ locals: { user: user() } } as never) as any;
  expect(linked.lastfmUser).toBe('bob-fm');
  expect(linked.picks.seeds).toEqual(['Seed']);
});

test('reproduces account linking under a different Trackerr user than initiated it', async () => {
  db.run("INSERT INTO users (id, display_name, created_at) VALUES (2, 'Bob', 0)");
  const jar = cookieJar();
  const redirect = await caught(() => start.GET({ url: new URL('https://review.test/auth/lastfm'), cookies: jar, locals: { user: user() } } as never));
  const target = new URL(new URL(redirect!.location).searchParams.get('cb')!);
  target.searchParams.set('token', 'alice-token');
  fakeFetch();
  await caught(() => callback.GET({ url: target, cookies: jar, locals: { user: db.get('SELECT * FROM users WHERE id = 2') } } as never));
  expect(db.get('SELECT lastfm_user FROM users WHERE id = 2').lastfm_user).toBe('alice-fm');
});

test('reproduces storing a malformed Last.fm username', async () => {
  fakeFetch(() => ({ session: {} }));
  const jar = cookieJar(); jar.set('lastfm_oauth', 'nonce');
  await caught(() => callback.GET({ url: new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t'), cookies: jar, locals: { user: user() } } as never));
  expect(user().lastfm_user).toBe('undefined');
});

test('reproduces retained ListenBrainz plaintext token after migration', () => {
  expect(legacyAfterMigration.listenbrainz_token).toBe('obsolete-secret');
  expect(legacyAfterMigration.lastfm_user).toBeNull();
});

test('reproduces 54 unthrottled Deezer requests and no request deadline', async () => {
  const calls = fakeFetch((u) => {
    switch (u.searchParams.get('method')) {
      case 'user.gettoptracks': return { toptracks: { track: [{ name: 'Seed One', artist: { name: 'Seed' } }, { name: 'Seed Two', artist: { name: 'Seed' } }] } };
      case 'artist.getsimilar': return { similarartists: { artist: Array.from({ length: 12 }, (_, i) => ({ name: `New Artist ${i}` })) } };
      case 'track.getsimilar': return { similartracks: { track: Array.from({ length: 15 }, (_, i) => ({ name: `${u.searchParams.get('track')}-${i}`, artist: { name: 'Song Artist' }, match: '1' })) } };
      case 'artist.gettopalbums': return { topalbums: { album: [{ name: 'Debut', artist: { name: u.searchParams.get('artist') } }] } };
    }
    return defaults(u);
  }, { data: [] });
  await recs.buildDiscover(user());
  const deezer = calls.filter((r) => r.url.hostname === 'api.deezer.com');
  expect(deezer).toHaveLength(54);
  expect(deezer.at(-1)!.at - deezer[0].at).toBeLessThan(5000);
  expect(deezer.every((r) => !r.signal)).toBe(true);
  console.info(`Deezer burst: ${deezer.length} requests in ${deezer.at(-1)!.at - deezer[0].at} ms`);
});

test.each(['missing', 'mismatched', 'cancelled', 'anonymous'])('security control rejects %s callback before API exchange', async (kind) => {
  const calls = fakeFetch();
  const jar = cookieJar();
  if (kind !== 'missing') jar.set('lastfm_oauth', 'nonce');
  const url = new URL('https://review.test/auth/lastfm/callback?state=nonce&token=t');
  if (kind === 'mismatched') url.searchParams.set('state', 'wrong');
  if (kind === 'cancelled') url.searchParams.delete('token');
  const result = await caught(() => callback.GET({ url, cookies: jar, locals: { user: kind === 'anonymous' ? null : user() } } as never));
  expect(result?.status).toBe(303);
  expect(calls).toHaveLength(0);
  expect(user().lastfm_user).toBe('alice-fm');
});
