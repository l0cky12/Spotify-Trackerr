<script lang="ts">
	import Heatmap from '#lib/components/Heatmap.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import TopNav from '#lib/components/TopNav.svelte';
	import { u, fmt, withParams } from '#lib/nav.js';
	import { formatDate, RANGES } from '#lib/time.js';

	let { data } = $props();
	const rangeLabel = $derived(RANGES.find((r) => r.id === data.range)!.label.toLowerCase());
	const items = $derived(
		data.firstHeard.map((r) => ({ ...r, href: u(`/track/${r.id}`), sub: `${r.artist} · first played ${formatDate(r.first, data.view.tz)}`, subHref: undefined }))
	);
</script>

<div class="head">
	<div>
		<h1>Charts</h1>
		<TopNav current="charts" range={data.range} />
	</div>
	<RangePicker value={data.range} />
</div>

<div class="grid2">
	<section class="panel">
		<h2>When you listen <small>{fmt(data.plays)} plays, {rangeLabel === 'all time' ? 'all time' : `last ${rangeLabel}`}</small></h2>
		<Heatmap grid={data.grid} />
	</section>
	<section class="panel">
		<h2>Listening streaks <small>Days in a row with at least one play, all time</small></h2>
		<dl class="streaks">
			<div>
				<dt>Longest streak</dt>
				<dd>{data.streaks.longest ? `${fmt(data.streaks.longest.days)} days` : '—'}</dd>
				{#if data.streaks.longest}<span class="muted">{data.streaks.longest.fromLabel} to {data.streaks.longest.toLabel}</span>{/if}
			</div>
			<div>
				<dt>Current streak</dt>
				<dd>{data.streaks.current ? `${fmt(data.streaks.current.days)} days` : 'None'}</dd>
				{#if data.streaks.current}<span class="muted">Since {data.streaks.current.fromLabel}</span>{:else}<span class="muted">Play something today to start one.</span>{/if}
			</div>
			<div>
				<dt>Days with plays</dt>
				<dd>{fmt(data.streaks.daysPlayed)}</dd>
			</div>
		</dl>
	</section>
</div>

<section class="panel">
	<h2>First heard <small>{fmt(data.found)} songs first played {rangeLabel === 'all time' ? 'ever' : `in the last ${rangeLabel}`}, newest discovery first</small></h2>
	<BarList {items} rankBy="plays" start={data.offset} />
	{#if data.pages > 1}
		<nav class="pages">
			{#each Array(data.pages) as _, i (i)}
				<a href={withParams({ page: String(i + 1) })} aria-current={data.pageNo === i + 1 ? 'page' : undefined}>{i * 50 + 1}–{(i + 1) * 50}</a>
			{/each}
		</nav>
	{/if}
</section>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		margin-bottom: 20px;
	}
	.streaks {
		display: grid;
		gap: 16px;
		margin: 0;
	}
	.streaks div {
		display: grid;
	}
	dt {
		color: var(--muted);
		font-size: 0.8rem;
	}
	dd {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		font-stretch: 80%;
	}
	.pages {
		display: flex;
		gap: 12px;
		margin-top: 18px;
		flex-wrap: wrap;
	}
	.pages a[aria-current] {
		font-weight: 700;
		text-decoration: none;
	}
	@media (max-width: 900px) {
		.grid2 {
			grid-template-columns: 1fr;
		}
	}
</style>
