<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import CoverGrid from '#lib/components/CoverGrid.svelte';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import TopNav from '#lib/components/TopNav.svelte';
	import { u, withParams, timeUnitTitle } from '#lib/nav.js';
	import { formatDate } from '#lib/time.js';
	let { data } = $props();
	const title = $derived({ track: 'Top songs', album: 'Top albums', artist: 'Top artists' }[data.kind as 'track']);
	const sorts = $derived([
		{ id: 'plays', label: 'Plays' },
		{ id: 'minutes', label: timeUnitTitle() },
		{ id: 'last', label: 'Last played' },
		{ id: 'first', label: 'First played' }
	]);
	// The list shows the sort figure under the name when it's a date, since the bar only measures plays or time.
	const items = $derived(
		data.items.map((r) => ({
			...r,
			href: u(`/${data.kind}/${r.id}`),
			sub: data.sort === 'last' ? `${r.artist ? `${r.artist} · ` : ''}last played ${formatDate(r.last, data.view.tz)}` : data.sort === 'first' ? `${r.artist ? `${r.artist} · ` : ''}first played ${formatDate(r.first, data.view.tz)}` : r.artist,
			subHref: data.sort === 'plays' || data.sort === 'minutes' ? (r.artist_id ? u(`/artist/${r.artist_id}`) : undefined) : undefined
		}))
	);
</script>

<div class="head">
	<div>
		<h1>{title}</h1>
		<TopNav current={data.kind} range={data.range} />
	</div>
	<RangePicker value={data.range} />
</div>
<section class="panel">
	<div class="tools">
		<div class="toggle" role="group" aria-label="Sort by">
			<span class="muted">Sort by</span>
			{#each sorts as s (s.id)}
				<a href={withParams({ sort: s.id, page: null })} aria-current={s.id === data.sort ? 'true' : undefined} data-sveltekit-noscroll>{s.label}</a>
			{/each}
		</div>
		<div class="toggle" role="group" aria-label="View">
			<a href={withParams({ view: null })} aria-current={!data.grid ? 'true' : undefined} data-sveltekit-noscroll>List</a>
			<a href={withParams({ view: 'grid' })} aria-current={data.grid ? 'true' : undefined} data-sveltekit-noscroll>Images</a>
		</div>
	</div>
	{#if data.grid}
		<CoverGrid {items} sort={data.sort} round={data.kind === 'artist'} start={data.offset} tz={data.view.tz} />
	{:else}
		<BarList {items} rankBy={data.sort === 'minutes' ? 'minutes' : 'plays'} round={data.kind === 'artist'} start={data.offset} />
	{/if}
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
	.tools {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
		font-size: 0.85rem;
	}
	.toggle {
		display: flex;
		gap: 2px;
		align-items: center;
		background: var(--surface-2);
		padding: 3px;
		border-radius: 8px;
	}
	.toggle .muted {
		padding: 0 8px 0 6px;
	}
	.toggle a {
		padding: 4px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink-2);
	}
	.toggle a[aria-current] {
		background: var(--ink);
		color: var(--page);
		font-weight: 600;
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
