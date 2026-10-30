import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { all, get, run, now, setting, type Row } from './db.js';

const SESSION_DAYS = 30;

export function hashPassword(pw: string) {
	const salt = randomBytes(16);
	return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function checkPassword(pw: string, stored: string | null) {
	if (!stored) return false;
	const [salt, hash] = stored.split(':');
	const a = Buffer.from(hash, 'hex');
	const b = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
	return a.length === b.length && timingSafeEqual(a, b);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function startSession(cookies: Cookies, userId: number, secure: boolean) {
	const token = randomBytes(32).toString('base64url');
	run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, now() + SESSION_DAYS * 86400);
	cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400 });
}

export function endSession(cookies: Cookies) {
	const token = cookies.get('session');
	if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
	cookies.delete('session', { path: '/' });
}

export function userFromSession(token: string | undefined): Row | null {
	if (!token) return null;
	return get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', sha(token), now()) ?? null;
}

/** A new MCP access key for this person. The key itself is returned only now; the database keeps its hash. */
export function createApiToken(userId: number, name: string) {
	const token = `trk_${randomBytes(32).toString('base64url')}`;
	run('INSERT INTO api_tokens (user_id, token_hash, name, created_at) VALUES (?, ?, ?, ?)', userId, sha(token), name.trim().slice(0, 60) || 'AI assistant', now());
	return token;
}

export const apiTokensOf = (userId: number) =>
	all('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC', userId) as { id: number; name: string; created_at: number; last_used_at: number | null }[];

export const revokeApiToken = (userId: number, id: number) => Number(run('DELETE FROM api_tokens WHERE user_id = ? AND id = ?', userId, id).changes) > 0;

export function userFromApiToken(token: string | null | undefined): Row | null {
	if (!token?.startsWith('trk_')) return null;
	const row = get('SELECT u.*, t.id token_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', sha(token));
	if (row) run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), row.token_id);
	return row ?? null;
}

export const userCount = () => get('SELECT COUNT(*) n FROM users')!.n as number;

/** Username/password sign-up is open when there are no users yet (first account = admin) or the admin enabled it. */
export const signupOpen = () => userCount() === 0 || setting('allow_signup') === '1';

export function createUser(fields: { username?: string | null; password?: string | null; display_name: string; timezone?: string }) {
	const isAdmin = userCount() === 0 ? 1 : 0;
	const r = run(
		"INSERT INTO users (username, password_hash, display_name, is_admin, timezone, time_unit, created_at) VALUES (?, ?, ?, ?, ?, 'auto', ?)",
		fields.username ?? null,
		fields.password ? hashPassword(fields.password) : null,
		fields.display_name,
		isAdmin,
		fields.timezone || 'UTC',
		now()
	);
	return Number(r.lastInsertRowid);
}

export function validUsername(u: string) {
	return /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
}

// ponytail: in-memory login throttle, resets on restart; fine for one container.
const failures = new Map<string, { n: number; until: number }>();
export function loginBlocked(key: string) {
	const f = failures.get(key);
	return !!f && f.n >= 10 && f.until > Date.now();
}
export function loginFailed(key: string) {
	const f = failures.get(key);
	const fresh = !f || f.until < Date.now();
	failures.set(key, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 15 * 60_000 });
}
export const loginSucceeded = (key: string) => failures.delete(key);
