import { test, expect } from 'vitest';
import { localizer, offsetAt } from './time.js';

test('per-day offset caching still lands on the right side of every DST change', () => {
	for (const tz of ['America/Chicago', 'Europe/London', 'Asia/Kolkata']) {
		const loc = localizer(tz);
		for (let ts = Date.UTC(2026, 0, 1) / 1000; ts < Date.UTC(2027, 0, 1) / 1000; ts += 1800) {
			expect(loc(ts).getTime() / 1000, `${tz} ${ts}`).toBe(ts + offsetAt(tz, ts));
		}
	}
});
