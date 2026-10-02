import { error } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '#lib/server/db.js';

const TYPES: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

export function GET({ params }) {
	const name = params.file;
	if (!/^[a-f0-9]{24}\.[a-z0-9]+$/.test(name)) error(404, 'Not found');
	const path = join(DATA_DIR, 'uploads', name);
	if (!existsSync(path)) error(404, 'Not found');
	const type = TYPES[name.split('.').pop()!] ?? 'application/octet-stream';
	return new Response(readFileSync(path), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
