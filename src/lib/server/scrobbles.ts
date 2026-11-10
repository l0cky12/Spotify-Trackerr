import { all, get, now, run, tx, type Row } from './db.js';
import { getJson, lastfm } from './enrich.js';
import { lastfmApp, scrobbleAccount, type ScrobbleSource } from './connections.js';
import { insertPlay, upsertAlbum, upsertArtist, upsertTrack } from './ingest.js';

// Scrobble sync: a person can count their Last.fm or ListenBrainz scrobbles as plays, which is how YouTube Music
// listening (sent there by a scrobbler app) reaches this server. The first sync brings in their whole scrobble history.

/**
 * Scrobblers that were offline (Pano Scrobbler on a phone) send plays days later with their real times, so every
 * run re-reads this much before the newest saved scrobble; the ones already saved drop out as duplicates.
 */
const LATE_SCROBBLES = 7 * 86400;
/** ListenBrainz's page size; a shorter page is the last one. */
const LB_PAGE = 1000;

type Scrobble = { artist: string; title: string; album: string | null; playedAt: number; durationMs: number | null };

/** Each service's scrobbles after `from` up to `to` (unix seconds), a page at a time. */
const SERVICES: Record<ScrobbleSource, (username: string, from: number, to: number) => AsyncGenerator<Scrobble[]>> = {
	async *lastfm(username, from, to) {
		if (!lastfmApp()) throw new Error("This server's Last.fm app isn't set up.");
		for (let page = 1, pages = 1; page <= pages; page++) {
			const r = await retry(() => lastfm({ method: 'user.getrecenttracks', user: username, from: String(from), to: String(to), limit: '200', page: String(page) }));
			pages = Number(r.recenttracks?.['@attr']?.totalPages) || 0;
			// A single scrobble comes back as an object, not a one-item list. The row being played right now has no date yet.
			yield [r.recenttracks?.track ?? []].flat().flatMap((t: any): Scrobble[] => {
				const playedAt = Number(t?.date?.uts);
				const artist = t?.artist?.['#text'];
				if (t?.['@attr']?.nowplaying || !playedAt || !text(artist) || !text(t.name)) return [];
				return [{ artist, title: t.name, album: text(t.album?.['#text']) ? t.album['#text'] : null, playedAt, durationMs: null }];
			});
		}
	},
	// ListenBrainz returns listens newest first and takes min_ts or max_ts but not both, so this walks back from `to`
	// and stops at the first listen not after `from`. https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
	async *listenbrainz(username, from, to) {
		let before = to + 1;
		for (let first = true; ; first = false) {
			// ListenBrainz allows about one call a second per client without a token.
			if (!first) await new Promise((r) => setTimeout(r, 1000));
			const r = await retry(() =>
				getJson(`https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/listens?` + new URLSearchParams({ max_ts: String(before), count: String(LB_PAGE) }))
			);
			const listens: any[] = r.payload?.listens ?? [];
			const fresh = listens.filter((l) => l?.listened_at > from);
			yield fresh.flatMap((l): Scrobble[] => {
				const m = l.track_metadata ?? {};
				if (!text(m.artist_name) || !text(m.track_name)) return [];
				const info = m.additional_info ?? {};
				const durationMs = Number(info.duration_ms) || Number(info.duration) * 1000 || null;
				return [{ artist: m.artist_name, title: m.track_name, album: text(m.release_name) ? m.release_name : null, playedAt: l.listened_at, durationMs }];
			});
			if (listens.length < LB_PAGE || fresh.length < listens.length) return;
			// max_ts is exclusive, so the next page starts inside the oldest second here: listens that share it and
			// didn't fit would otherwise be skipped. Ones already saved are duplicates.
			const oldest = listens.at(-1).listened_at;
			before = listens[0].listened_at === oldest ? oldest : oldest + 1;
		}
	}
};

const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();

/** Deep pages of a long history fail now and then; a retry saves starting the whole backfill over. A 4xx (no such user, private profile) won't change. */
async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (e) {
			const status = (e as { status?: number }).status ?? 0;
			if (i >= tries || (status >= 400 && status < 500 && status !== 429)) throw e;
			await new Promise((r) => setTimeout(r, 2000 * i));
		}
	}
}

/**
 * Saves the person's new scrobbles as plays. The window's end is fixed when the run starts, and the cursor moves
 * only once the whole window is saved; a run that fails redoes the same window, and the plays it already saved
 * are dropped as duplicates (same source, same time).
 */
export async function syncScrobbles(user: Row): Promise<{ added: number } | { error: string }> {
	const account = scrobbleAccount(user);
	if (!account) return { added: 0 };
	const from = Math.max(0, user.scrobble_cursor - LATE_SCROBBLES);
	let newest: number = user.scrobble_cursor;
	let added = 0;
	try {
		for await (const page of SERVICES[account.source](account.username, from, now())) {
			tx(() => {
				for (const s of page) {
					const artistId = upsertArtist(s.artist);
					const albumId = s.album ? upsertAlbum(artistId, s.album) : null;
					const track = upsertTrack(artistId, albumId, s.title, undefined, s.durationMs ?? undefined);
					const ms = s.durationMs ?? track.durationMs ?? 0;
					if (insertPlay({ userId: user.id, trackId: track.id, albumId, artistId, playedAt: s.playedAt, msPlayed: ms, source: 'scrobble', durationMs: track.durationMs }))
						added++;
					newest = Math.max(newest, s.playedAt);
				}
			});
		}
	} catch (e) {
		const error = String((e as Error)?.message ?? e);
		if (sameAccount(user.id, account)) run('UPDATE users SET scrobble_error = ? WHERE id = ?', error, user.id);
		return { error };
	}
	// The person may have switched accounts while this ran; the new one starts from its own beginning.
	if (sameAccount(user.id, account)) run('UPDATE users SET scrobble_cursor = ?, scrobble_error = NULL WHERE id = ?', newest, user.id);
	if (added) console.log(`scrobbles: user ${user.id} +${added}`);
	return { added };
}

function sameAccount(userId: number, account: { source: ScrobbleSource; username: string }) {
	const current = scrobbleAccount(get('SELECT * FROM users WHERE id = ?', userId) ?? {});
	return current?.source === account.source && current.username === account.username;
}

const lastTried = new Map<number, { at: number; account: string }>();

/** Syncs scrobbles for everyone whose sync interval (sync_minutes) has passed, or who just picked an account. */
export async function scrobblesDue() {
	for (const u of all('SELECT * FROM users WHERE scrobble_source IS NOT NULL')) {
		const account = scrobbleAccount(u);
		if (!account) continue;
		const key = `${account.source}:${account.username}`;
		const tried = lastTried.get(u.id);
		if (tried?.account === key && Date.now() - tried.at < u.sync_minutes * 60_000 - 30_000) continue;
		lastTried.set(u.id, { at: Date.now(), account: key });
		await syncScrobbles(u);
	}
}
