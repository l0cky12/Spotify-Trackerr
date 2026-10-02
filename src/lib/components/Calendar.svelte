<script lang="ts">
	import { shade, RAMP_STEPS } from '#lib/ramp.js';
	import { monthName } from '#lib/time.js';
	// days: "month-day" -> plays (month 0-based)
	let { year, days }: { year: number; days: Record<string, number> } = $props();

	const max = $derived(Math.max(1, ...Object.values(days)));
	// Columns are weeks (Mon-Sun), starting with the week containing Jan 1.
	const cells = $derived.by(() => {
		const out: { date: Date; v: number; col: number; row: number }[] = [];
		const jan1 = new Date(Date.UTC(year, 0, 1));
		const offset = (jan1.getUTCDay() + 6) % 7;
		for (let d = new Date(jan1); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
			const idx = Math.round((d.getTime() - jan1.getTime()) / 86400000) + offset;
			out.push({ date: new Date(d), v: days[`${d.getUTCMonth()}-${d.getUTCDate()}`] ?? 0, col: Math.floor(idx / 7) + 2, row: (idx % 7) + 2 });
		}
		return out;
	});
	const monthCols = $derived(
		Array.from({ length: 12 }, (_, m) => {
			const c = cells.find((c) => c.date.getUTCMonth() === m && c.date.getUTCDate() === 1)!;
			return { m, col: c.col };
		})
	);
	const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="cal-wrap">
	<div class="cal" role="img" aria-label="Plays per day in {year}">
		{#each monthCols as mc (mc.m)}<span class="mon" style:grid-column={mc.col}>{monthName(mc.m)}</span>{/each}
		{#each ['Mon', '', 'Wed', '', 'Fri', '', ''] as l, i (i)}<span class="wd" style:grid-row={i + 2}>{l}</span>{/each}
		{#each cells as c (c.date.getTime())}
			<span class="cell" style:grid-column={c.col} style:grid-row={c.row} style:background={shade(c.v, max)} title="{fmtDay(c.date)}: {c.v} plays"></span>
		{/each}
	</div>
	<div class="scale" aria-hidden="true">Fewer {#each RAMP_STEPS as c (c)}<i style:background={c}></i>{/each} More</div>
</div>

<style>
	.cal-wrap {
		overflow-x: auto;
	}
	.cal {
		display: grid;
		grid-template-columns: 2rem repeat(54, 12px);
		grid-template-rows: 16px repeat(7, 12px);
		gap: 3px;
		width: max-content;
	}
	.mon,
	.wd {
		font-size: 10px;
		color: var(--muted);
		grid-row: 1;
		white-space: nowrap;
	}
	.wd {
		grid-column: 1;
		line-height: 12px;
	}
	.cell {
		border-radius: 2px;
	}
	.scale {
		display: flex;
		gap: 3px;
		align-items: center;
		font-size: 11px;
		color: var(--muted);
		margin-top: 8px;
	}
	.scale i {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}
</style>
