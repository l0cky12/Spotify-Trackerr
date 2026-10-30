import { test, expect } from 'vitest';
import { formatListened, localizer, offsetAt } from './time.js';

test('per-day offset caching still lands on the right side of every DST change', () => {
	for (const tz of ['America/Chicago', 'Europe/London', 'Asia/Kolkata']) {
		const loc = localizer(tz);
		for (let ts = Date.UTC(2026, 0, 1) / 1000; ts < Date.UTC(2027, 0, 1) / 1000; ts += 1800) {
			expect(loc(ts).getTime() / 1000, `${tz} ${ts}`).toBe(ts + offsetAt(tz, ts));
		}
	}
});

test('auto time listened steps up a unit at 2 of the next one, so figures stay short', () => {
	const min = 60000, h = 60 * min, d = 24 * h, mo = 2629800000;
	const cases: [number, string][] = [
		[0, '0 min'],
		[47 * min, '47 min'],
		[119 * min, '119 min'],
		[119.7 * min, '2 hours'],
		[2.5 * h, '2.5 hours'],
		[14.4 * h, '14 hours'],
		[47 * h, '47 hours'],
		[48 * h, '2 days'],
		[3.24 * d, '3.2 days'],
		[59 * d, '59 days'],
		[60 * d, '2 months'],
		[14.2 * mo, '14 months'],
		[24 * mo, '2 years'],
		[30 * mo, '2.5 years']
	];
	for (const [ms, text] of cases) expect(formatListened(ms, 'auto'), `${ms} ms`).toBe(text);
});

test('a fixed time unit shows every figure in that unit', () => {
	expect(formatListened(36_000_000_000, 'hours')).toBe('10,000 hours');
	expect(formatListened(90 * 60000, 'minutes')).toBe('90 min');
	expect(formatListened(1.5 * 86400000, 'days')).toBe('1.5 days');
});
