import { page } from '$app/state';
import { TIME_UNITS, type TimeUnit } from './time.js';

/** Keeps `?user=` on internal links so browsing someone else's stats stays on their stats. */
export function u(href: string) {
	const who = page.url.searchParams.get('user');
	if (!who) return href;
	return href + (href.includes('?') ? '&' : '?') + 'user=' + encodeURIComponent(who);
}

/** Current URL with some query params replaced (null removes). */
export function withParams(params: Record<string, string | null>) {
	const url = new URL(page.url.href);
	for (const [k, v] of Object.entries(params)) {
		if (v === null) url.searchParams.delete(k);
		else url.searchParams.set(k, v);
	}
	return url.pathname + url.search;
}

export const fmt = (n: number) => n.toLocaleString('en-US');
export const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** The viewer's chosen unit for time listened, from Settings. */
export const timeUnit = (): TimeUnit => page.data.me?.timeUnit ?? 'minutes';
export const timeUnitTitle = () => timeUnit()[0].toUpperCase() + timeUnit().slice(1);
/** Time listened in the viewer's unit, formatted; minutes are whole, the rest keep one decimal. */
export const listened = (ms: number) =>
	(ms / TIME_UNITS[timeUnit()]).toLocaleString('en-US', { maximumFractionDigits: timeUnit() === 'minutes' ? 0 : 1 });
