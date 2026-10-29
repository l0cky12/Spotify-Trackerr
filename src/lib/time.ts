// Time-zone math without a library: offsets come from Intl, cached per UTC hour.

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
	let f = fmts.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		fmts.set(tz, f);
	}
	return f;
}

/** Seconds to add to a UTC timestamp to get wall-clock time in `tz`. */
export function offsetAt(tz: string, ts: number) {
	const p: Record<string, number> = {};
	for (const { type, value } of fmt(tz).formatToParts(new Date(ts * 1000))) p[type] = Number(value);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - Math.floor(ts);
}

/** Returns fn(ts) -> Date whose UTC getters read as local wall-clock time in `tz`. */
export function localizer(tz: string) {
	const cache = new Map<number, number>();
	const off = (h: number) => {
		let o = cache.get(h);
		if (o === undefined) cache.set(h, (o = offsetAt(tz, h * 3600)));
		return o;
	};
	return (ts: number) => {
		const h = Math.floor(ts / 3600);
		// Same offset at both ends of the UTC day means no DST change inside it: one lookup covers 24 hours.
		const day = h - (((h % 24) + 24) % 24);
		const o = off(day) === off(day + 24) ? off(day) : off(h);
		return new Date((ts + o) * 1000);
	};
}

/** UTC timestamp of a local wall-clock moment in `tz` (month is 0-based, overflow allowed). */
export function fromLocal(tz: string, y: number, m = 0, d = 1, h = 0) {
	const guess = Date.UTC(y, m, d, h) / 1000;
	let ts = guess - offsetAt(tz, guess);
	ts = guess - offsetAt(tz, ts); // second pass settles DST edges
	return ts;
}

export const RANGES = [
	{ id: '24h', label: '24 hours', secs: 86400 },
	{ id: '3d', label: '3 days', secs: 3 * 86400 },
	{ id: '7d', label: 'Week', secs: 7 * 86400 },
	{ id: '30d', label: 'Month', secs: 30 * 86400 },
	{ id: '90d', label: '3 months', secs: 90 * 86400 },
	{ id: '180d', label: '6 months', secs: 180 * 86400 },
	{ id: '365d', label: 'Year', secs: 365 * 86400 },
	{ id: 'all', label: 'All time', secs: 0 }
] as const;
export type RangeId = (typeof RANGES)[number]['id'];

export function parseRange(v: string | null, fallback: RangeId = '7d') {
	return RANGES.find((r) => r.id === v) ?? RANGES.find((r) => r.id === fallback)!;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number) => MONTHS[m];

export function formatDuration(ms: number) {
	const min = Math.round(ms / 60000);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	return h < 100 ? `${h} h ${min % 60} min` : `${h.toLocaleString()} h`;
}

export function formatWhen(ts: number, tz: string, withYear = true) {
	return new Date(ts * 1000).toLocaleString('en-US', {
		timeZone: tz,
		month: 'short',
		day: 'numeric',
		year: withYear ? 'numeric' : undefined,
		hour: 'numeric',
		minute: '2-digit'
	});
}

export function formatDate(ts: number, tz: string) {
	return new Date(ts * 1000).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
}
