<script lang="ts">
	import { fmt } from '#lib/nav.js';
	// Stacked areas of plays per top artist over time. Hues follow the artist's rank slot,
	// which is fixed for a given range, so toggling 5/8 never repaints the survivors.
	let { labels, series, height = 220 }: { labels: string[]; series: { id: number; name: string; values: number[] }[]; height?: number } = $props();

	let count = $state(5);
	let width = $state(600);
	let hover = $state<number | null>(null);
	const shown = $derived(series.slice(0, count));
	const n = $derived(labels.length);
	const left = 8,
		bottom = 22,
		top = 8;
	const plotH = $derived(height - top - bottom);
	const stacks = $derived.by(() => {
		const acc = new Array(n).fill(0);
		return shown.map((s) => {
			const lo = [...acc];
			s.values.forEach((v, i) => (acc[i] += v));
			return { ...s, lo, hi: [...acc] };
		});
	});
	const max = $derived(Math.max(1, ...(stacks.at(-1)?.hi ?? [1])));
	const x = (i: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * (width - left * 2));
	const y = (v: number) => top + plotH - (v / max) * plotH;
	const area = (s: { lo: number[]; hi: number[] }) =>
		'M' + s.hi.map((v, i) => `${x(i)},${y(v)}`).join('L') + 'L' + [...s.lo].map((v, i) => `${x(i)},${y(v)}`).reverse().join('L') + 'Z';
	const edge = (s: { hi: number[] }) => 'M' + s.hi.map((v, i) => `${x(i)},${y(v)}`).join('L');
	const every = $derived(Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 90)))));

	function move(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		hover = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - left) / (width - left * 2)) * (n - 1))));
	}
</script>

<div class="trends" bind:clientWidth={width}>
	<div class="head">
		<ul class="legend">
			{#each shown as s, i (s.id)}<li><i style:background="var(--series-{i + 1})"></i>{s.name}</li>{/each}
		</ul>
		{#if series.length > 5}
			<div class="toggle" role="group" aria-label="Number of artists">
				<button aria-pressed={count === 5} onclick={() => (count = 5)}>Top 5</button>
				<button aria-pressed={count === 8} onclick={() => (count = 8)}>Top 8</button>
			</div>
		{/if}
	</div>
	{#if n < 2 || !series.length}
		<p class="muted">Not enough plays in this range to show trends.</p>
	{:else}
		<svg {width} {height} role="img" aria-label="Plays per top artist over time" onpointermove={move} onpointerleave={() => (hover = null)}>
			<line class="grid" x1={left} x2={width - left} y1={top + plotH} y2={top + plotH} />
			{#each stacks as s, i (s.id)}
				<path d={area(s)} fill="var(--series-{i + 1})" />
			{/each}
			{#each stacks as s (s.id)}
				<path d={edge(s)} class="gap" />
			{/each}
			{#each labels as l, i (i)}
				{#if i % every === 0}<text class="tick" x={x(i)} y={height - 6} text-anchor={i === 0 ? 'start' : 'middle'}>{l}</text>{/if}
			{/each}
			{#if hover !== null}<line class="cross" x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} />{/if}
		</svg>
		{#if hover !== null}
			<div class="tip" style:left="{Math.min(x(hover) + 12, width - 190)}px">
				<strong>{labels[hover]}</strong>
				{#each [...shown].map((s, i) => ({ s, i })).reverse() as { s, i } (s.id)}
					<span><i style:background="var(--series-{i + 1})"></i>{s.name}: {fmt(s.values[hover])}</span>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.trends {
		position: relative;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: start;
		margin-bottom: 8px;
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 0.8rem;
		color: var(--ink-2);
	}
	i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 6px;
		vertical-align: -1px;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.gap {
		fill: none;
		stroke: var(--surface);
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.grid {
		stroke: var(--axis);
	}
	.cross {
		stroke: var(--ink-2);
		stroke-width: 1;
	}
	.tick {
		fill: var(--muted);
		font-size: 11px;
	}
	.tip {
		position: absolute;
		top: 40px;
		pointer-events: none;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 0.8rem;
		display: grid;
		gap: 2px;
		white-space: nowrap;
		z-index: 2;
	}
</style>
