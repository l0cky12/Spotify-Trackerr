<script lang="ts">
	import { goto } from '$app/navigation';
	import { fmt } from '#lib/nav.js';

	let {
		labels,
		values,
		prev = null,
		hrefs = null,
		highlight = -1,
		height = 200,
		unit = 'plays',
		name = 'This period',
		prevName = 'Previous period'
	}: {
		labels: string[];
		values: number[];
		prev?: number[] | null;
		hrefs?: (string | null)[] | null;
		highlight?: number;
		height?: number;
		unit?: string;
		name?: string;
		prevName?: string;
	} = $props();

	let width = $state(600);
	let hover = $state<number | null>(null);

	const left = 40,
		bottom = 22,
		top = 8;
	const plotH = $derived(height - bottom - top);
	const n = $derived(values.length);
	const band = $derived((width - left) / Math.max(1, n));
	const barW = $derived(Math.max(1, Math.min(24, band * 0.72, band - 2)));
	const max = $derived(niceMax(Math.max(1, ...values, ...(prev ?? []))));
	const y = (v: number) => top + plotH - (v / max) * plotH;
	const x = (i: number) => left + i * band + band / 2;

	function niceMax(v: number) {
		const p = 10 ** Math.floor(Math.log10(v));
		return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
	}
	const ticks = $derived([0, max / 2, max]);
	const every = $derived(Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - left) / 80)))));

	function bar(i: number) {
		const h = Math.max(0, (values[i] / max) * plotH);
		if (h === 0) return '';
		const r = Math.min(4, h, barW / 2);
		const x0 = x(i) - barW / 2,
			y0 = top + plotH - h,
			x1 = x0 + barW,
			base = top + plotH;
		return `M${x0},${base}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${base}Z`;
	}
	const prevPath = $derived(
		prev
			? prev.map((v, i) => `${i ? 'L' : 'M'}${left + i * band},${y(v)}H${left + (i + 1) * band}`).join('')
			: ''
	);
</script>

<div class="chart" bind:clientWidth={width}>
	{#if prev}
		<div class="legend">
			<span><i class="sw cur"></i>{name}</span>
			<span><i class="sw prev"></i>{prevName}</span>
		</div>
	{/if}
	<svg {width} {height} role="img" aria-label="{name}: {unit} over time">
		{#each ticks as t (t)}
			<line class="grid" x1={left} x2={width} y1={y(t)} y2={y(t)} />
			<text class="tick" x={left - 6} y={y(t) + 4} text-anchor="end">{fmt(Math.round(t))}</text>
		{/each}
		{#each values as _, i (i)}
			<path d={bar(i)} class="col" class:hi={i === highlight} class:dim={hover !== null && hover !== i} />
		{/each}
		{#if prev}<path d={prevPath} class="prev" />{/if}
		{#each labels as l, i (i)}
			{#if i % every === 0}
				<text class="tick" x={x(i)} y={height - 6} text-anchor="middle">{l}</text>
			{/if}
		{/each}
		{#each values as _, i (i)}
			<rect
				role="presentation"
				x={left + i * band}
				y={top}
				width={band}
				height={plotH}
				fill="transparent"
				style:cursor={hrefs?.[i] ? 'pointer' : 'default'}
				onpointerenter={() => (hover = i)}
				onpointerleave={() => (hover = null)}
				onclick={() => hrefs?.[i] && goto(hrefs[i]!)}
			/>
		{/each}
	</svg>
	{#if hover !== null}
		<div class="tip" style:left="{Math.min(x(hover), width - 150)}px" style:top="{Math.max(0, y(values[hover]) - 56)}px">
			<strong>{labels[hover]}</strong>
			<span><i class="sw cur"></i>{fmt(values[hover])} {unit}</span>
			{#if prev}<span><i class="sw prev"></i>{fmt(prev[hover])} {unit}, {prevName.toLowerCase()}</span>{/if}
			{#if hrefs?.[hover]}<em>Click to see these plays</em>{/if}
		</div>
	{/if}
	<details class="table">
		<summary>Show as table</summary>
		<table>
			<thead><tr><th>Period</th><th>{name}</th>{#if prev}<th>{prevName}</th>{/if}</tr></thead>
			<tbody>
				{#each labels as l, i (i)}
					<tr>
						<td>{#if hrefs?.[i]}<a href={hrefs[i]}>{l}</a>{:else}{l}{/if}</td>
						<td>{fmt(values[i])}</td>
						{#if prev}<td>{fmt(prev[i])}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--grid);
		stroke-width: 1;
	}
	.tick {
		fill: var(--muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.col {
		fill: var(--series-1);
		transition: opacity 0.1s;
	}
	.col.hi {
		fill: var(--series-4);
	}
	.col.dim {
		opacity: 0.45;
	}
	.prev {
		fill: none;
		stroke: var(--ink-2);
		stroke-width: 2;
		stroke-linejoin: round;
		opacity: 0.7;
	}
	.legend {
		display: flex;
		gap: 16px;
		font-size: 0.8rem;
		color: var(--ink-2);
		margin-bottom: 6px;
	}
	.sw {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 6px;
		vertical-align: -1px;
	}
	.sw.cur {
		background: var(--series-1);
	}
	.sw.prev {
		height: 2px;
		vertical-align: 3px;
		background: var(--ink-2);
	}
	.tip {
		position: absolute;
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
	.tip em {
		color: var(--muted);
		font-style: normal;
	}
	.table {
		margin-top: 6px;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.table table {
		margin-top: 6px;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}
	.table td,
	.table th {
		padding: 2px 12px 2px 0;
		text-align: left;
	}
</style>
