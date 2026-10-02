import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, run, DATA_DIR } from './db.js';
import { entityTotals, monthly } from './stats.js';
import { viewOf } from './view.js';

export type EntityKind = 'track' | 'album' | 'artist';
const TABLE = { track: 'tracks', album: 'albums', artist: 'artists' } as const;
const COL = { track: 'track_id', album: 'album_id', artist: 'artist_id' } as const;

/** Shared data for song/album/artist pages: totals, first/last play, plays per month with peak. */
export function entityPage(event: RequestEvent, kind: EntityKind) {
	const id = Number(event.params.id);
	const row = get(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`, id);
	if (!row) error(404, 'Not found');
	const view = viewOf(event);
	return { id, row, view, totals: entityTotals(view.ids, COL[kind], id), monthly: monthly(view.ids, COL[kind], id, view.tz) };
}

/** Sets a custom picture from a pasted address or an uploaded file. Empty form clears the custom picture. */
export async function setImage(event: RequestEvent, kind: EntityKind) {
	const f = await event.request.formData();
	const id = Number(event.params.id);
	const file = f.get('file');
	const url = String(f.get('url') ?? '').trim();
	let value: string | null = null;
	if (file instanceof File && file.size > 0) {
		if (!file.type.startsWith('image/')) return fail(400, { imageError: 'Upload an image file.' });
		if (file.size > 5_000_000) return fail(400, { imageError: 'Images must be under 5 MB.' });
		const ext = (file.type.split('/')[1] ?? 'img').replace(/[^a-z0-9]/g, '');
		const name = `${randomBytes(12).toString('hex')}.${ext}`;
		writeFileSync(join(DATA_DIR, 'uploads', name), Buffer.from(await file.arrayBuffer()));
		value = `/img/${name}`;
	} else if (url) {
		if (!/^https?:\/\//i.test(url)) return fail(400, { imageError: 'Paste an address starting with https://' });
		value = url;
	}
	run(`UPDATE ${TABLE[kind]} SET image_override = ? WHERE id = ?`, value, id);
	return { imageSaved: true };
}
