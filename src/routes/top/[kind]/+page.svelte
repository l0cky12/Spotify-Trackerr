<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import { u, withParams } from '#lib/nav.js';
	let { data } = $props();
	const title = $derived({ track: 'Top songs', album: 'Top albums', artist: 'Top artists' }[data.kind as 'track']);
</script>

<div class="head">
	<h1>{title}</h1>
	<RangePicker value={data.range} />
</div>
<section class="panel">
	<BarList
		items={data.items.map((r) => ({ ...r, href: u(`/${data.kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }))}
		rankBy={data.view.rankBy}
		round={data.kind === 'artist'}
		start={data.offset}
	/>
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
	.pages {
		display: flex;
		gap: 12px;
		margin-top: 18px;
	}
	.pages a[aria-current] {
		font-weight: 700;
		text-decoration: none;
	}
</style>
