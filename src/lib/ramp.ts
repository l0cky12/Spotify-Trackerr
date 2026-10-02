// Sequential blue for magnitude on the dark surface: dim (near zero) to bright.
const RAMP = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'];
export function shade(v: number, max: number) {
	if (!v) return 'var(--surface-2)';
	return RAMP[Math.min(RAMP.length - 1, Math.floor((v / Math.max(1, max)) * RAMP.length))];
}
export const RAMP_STEPS = RAMP;
