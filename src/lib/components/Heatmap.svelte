<script lang="ts">
	import { shade, RAMP_STEPS } from '#lib/ramp.js';
	let { grid }: { grid: number[][] } = $props();
	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const hour = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
	const max = $derived(Math.max(1, ...grid.flat()));
</script>

<div class="heat" role="table" aria-label="Plays by weekday and hour">
	{#each grid as row, d (d)}
		<div class="row" role="row">
			<span class="day" role="rowheader">{DAYS[d]}</span>
			{#each row as v, h (h)}
				<span class="cell" role="cell" style:background={shade(v, max)} title="{DAYS[d]} {hour(h)}: {v} plays" aria-label="{DAYS[d]} {hour(h)}: {v} plays"></span>
			{/each}
		</div>
	{/each}
	<div class="row axis" aria-hidden="true">
		<span class="day"></span>
		{#each Array(24) as _, h (h)}<span class="hr">{h % 6 === 0 ? hour(h) : ''}</span>{/each}
	</div>
	<div class="scale" aria-hidden="true">
		Fewer {#each RAMP_STEPS as c (c)}<i style:background={c}></i>{/each} More
	</div>
</div>

<style>
	.heat {
		display: grid;
		gap: 3px;
	}
	.row {
		display: grid;
		grid-template-columns: 2.5rem repeat(24, 1fr);
		gap: 3px;
	}
	.day,
	.hr {
		font-size: 11px;
		color: var(--muted);
	}
	.hr {
		white-space: nowrap;
	}
	.cell {
		aspect-ratio: 1;
		border-radius: 3px;
		min-height: 10px;
	}
	.scale {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		color: var(--muted);
		margin-top: 8px;
		justify-content: flex-end;
	}
	.scale i {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}
</style>
