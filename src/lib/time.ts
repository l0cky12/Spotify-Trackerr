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
export function fromLocal(tz: string, y: number, m = 0, d = 1, h = 0, min = 0) {
	const guess = Date.UTC(y, m, d, h, min) / 1000;
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

/** 'YYYY' or 'YYYY-MM' for a local calendar year or month (month is 0-based). */
export const periodId = (y: number, m?: number) => (m === undefined ? `${y}` : `${y}-${String(m + 1).padStart(2, '0')}`);
/** Parses a period id back to its parts; null for anything else. */
export function parsePeriod(id: string | null | undefined): { y: number; m?: number } | null {
	const hit = id?.match(/^(\d{4})(?:-(\d{2}))?$/);
	if (!hit) return null;
	const y = Number(hit[1]);
	if (y < 1970 || y > 2100) return null;
	if (hit[2] === undefined) return { y };
	const m = Number(hit[2]) - 1;
	return m >= 0 && m < 12 ? { y, m } : null;
}
/** A local day number (days since 1970-01-01 in local wall-clock time) as 'Mar 4, 2024'. */
export const dayLabel = (day: number, withYear = true) =>
	new Date(day * 86400000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: withYear ? undefined : 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined });

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

/** Fixed units for showing time listened, in ms; a month is the average month (365.25 / 12 days). */
/** A show's calendar date (YYYY-MM-DD, the venue's own day) as 'Sat, Nov 14, 2026', without shifting it into a time zone. */
export const formatShowDate = (d: string) =>
	new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export const TIME_UNITS = { minutes: 60000, hours: 3600000, days: 86400000, months: 2629800000 };
/** 'auto' picks a unit per figure (see formatListened); the rest show every figure in that one unit. */
export type TimeUnit = keyof typeof TIME_UNITS | 'auto';
export const TIME_UNIT_CHOICES: TimeUnit[] = ['auto', 'minutes', 'hours', 'days', 'months'];

// Auto steps up a unit once a figure reaches 2 of the next one, so numbers stay short: at most 119 min, 47 hours, 59 days, 23 months.
const AUTO_STEPS = [
	{ label: 'min', ms: TIME_UNITS.minutes, below: 120 },
	{ label: 'hours', ms: TIME_UNITS.hours, below: 48 },
	{ label: 'days', ms: TIME_UNITS.days, below: 60 },
	{ label: 'months', ms: TIME_UNITS.months, below: 24 },
	{ label: 'years', ms: TIME_UNITS.months * 12, below: Infinity }
];

/** Time listened with its unit, like '47 min' or '3.2 days'. Minutes are whole; other figures keep one decimal under 10. */
export function formatListened(ms: number, unit: TimeUnit) {
	const show = (n: number, decimals: number) => n.toLocaleString('en-US', { maximumFractionDigits: decimals });
	if (unit !== 'auto') return `${show(ms / TIME_UNITS[unit], unit === 'minutes' ? 0 : 1)} ${unit === 'minutes' ? 'min' : unit}`;
	for (const step of AUTO_STEPS) {
		const n = ms / step.ms;
		const decimals = step.label === 'min' || n >= 10 ? 0 : 1;
		// Compare the rounded figure, so 119.7 min reads as '2 hours' rather than '120 min'.
		if (Number(n.toFixed(decimals)) < step.below) return `${show(n, decimals)} ${step.label}`;
	}
	return '';
}
