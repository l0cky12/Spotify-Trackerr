import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { run } from '#lib/server/db.js';
import { top, firstPlay, playsPerMonth } from '#lib/server/stats.js';
import { connectionStatus, SpotifyError } from '#lib/server/connections.js';
import { KINDS, cleanTemplate, createSpotifyPlaylist, deleteTemplate, resolveTemplate, saveTemplate, templateOf, templatesOf, type TemplateParams } from '#lib/server/playlists.js';
import { localizer, periodId } from '#lib/time.js';

// Playlists are built from the signed-in person's own plays only, so there's no ?user= view here.
export const load: PageServerLoad = ({ locals }) => {
	const u = locals.user!;
	const loc = localizer(u.timezone);
	const first = firstPlay([u.id]);
	const thisYear = loc(Date.now() / 1000).getUTCFullYear();
	const years: number[] = [];
	for (let y = first ? loc(first).getUTCFullYear() : thisYear; y <= thisYear; y++) years.push(y);
	const months = playsPerMonth([u.id], u.timezone).months.filter((m) => m.plays).map((m) => ({ id: periodId(m.y, m.m), label: m.label }));
	return {
		kinds: KINDS,
		templates: templatesOf(u.id),
		spotify: connectionStatus(u),
		years,
		months,
		artists: top('artist', { ids: [u.id], since: 0, until: Math.floor(Date.now() / 1000) + 1, rankBy: 'plays', tz: u.timezone }, 300).map((a) => ({ id: a.id, name: a.name }))
	};
};

/** Every failed action carries the same shape, so the page can read `editing` and `createId` without narrowing each case. */
type Oops = { error: string; editing?: number | 'new'; createId?: number };
const oops = (status: number, f: Oops) => fail(status, f);

function paramsFrom(f: FormData): { name: string; kind: string; params: TemplateParams } {
	return {
		name: String(f.get('name') ?? ''),
		kind: String(f.get('kind') ?? ''),
		params: { period: String(f.get('period') ?? 'all'), n: Number(f.get('n')), artistId: Number(f.get('artist')), year: Number(f.get('year')) }
	};
}

export const actions = {
	save: async ({ request, locals }) => {
		const f = await request.formData();
		const id = Number(f.get('id')) || null;
		if (id && !templateOf(locals.user!.id, id)) return oops(404, { error: 'That template is gone.' });
		const clean = cleanTemplate(paramsFrom(f));
		if ('error' in clean) return oops(400, { error: clean.error, editing: id ?? 'new' });
		saveTemplate(locals.user!.id, id, clean.ok);
		return { saved: true };
	},
	delete: async ({ request, locals }) => {
		deleteTemplate(locals.user!.id, Number((await request.formData()).get('id')));
		return { saved: true };
	},
	/** Shows what a saved template would put in the playlist right now. */
	preview: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const t = templateOf(locals.user!.id, id);
		if (!t) return oops(404, { error: 'That template is gone.' });
		const r = resolveTemplate(locals.user!, { kind: t.kind, ...t.params });
		return { preview: { id, title: r.title, picks: r.picks } };
	},
	/** Builds the playlist on the person's Spotify account. */
	create: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const me = locals.user!;
		const t = templateOf(me.id, id);
		if (!t) return oops(404, { error: 'That template is gone.' });
		const r = resolveTemplate(me, { kind: t.kind, ...t.params });
		const ids = r.picks.map((p) => p.spotify_id).filter((s): s is string => !!s);
		try {
			const url = await createSpotifyPlaylist(me, r.title, r.description, ids);
			run('UPDATE playlist_templates SET last_playlist_url = ? WHERE id = ? AND user_id = ?', url, id, me.id);
			return { created: { id, url, added: ids.length, skipped: r.picks.length - ids.length } };
		} catch (e) {
			const msg = e instanceof SpotifyError && e.kind === 'rateLimited' ? 'Spotify asked us to slow down. Try again in a minute.' : (e as Error).message;
			return oops(e instanceof SpotifyError ? 502 : 400, { error: msg, createId: id });
		}
	}
} satisfies Actions;

