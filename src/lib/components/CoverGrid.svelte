<script lang="ts">
	import Cover from './Cover.svelte';
	import { fmt, listened } from '#lib/nav.js';
	import { formatDate } from '#lib/time.js';

	// Image-grid view of a top list: big artwork, name, and the figure the list is sorted by.
	type Item = { name: string; sub?: string | null; href?: string; image?: string | null; plays: number; ms: number; first?: number; last?: number };
	let { items, sort = 'plays', round = false, start = 0, tz = 'UTC' }: { items: Item[]; sort?: string; round?: boolean; start?: number; tz?: string } = $props();
	const figure = (i: Item) =>
		sort === 'minutes' ? listened(i.ms)
		: sort === 'last' && i.last ? `last ${formatDate(i.last, tz)}`
		: sort === 'first' && i.first ? `first ${formatDate(i.first, tz)}`
		: `${fmt(i.plays)} plays`;
</script>

<ol class="grid" {start}>
	{#each items as item, i (item.href ?? i)}
		<li>
			<a href={item.href} title="{item.name}: {fmt(item.plays)} plays, {listened(item.ms)}">
				<span class="art"><Cover src={item.image} alt={item.name} size={220} {round} /><span class="rank">{start + i + 1}</span></span>
				<strong>{item.name}</strong>
				{#if item.sub}<small>{item.sub}</small>{/if}
				<small class="fig">{figure(item)}</small>
			</a>
		</li>
	{:else}
		<li class="empty">No plays in this range.</li>
	{/each}
</ol>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 16px 12px;
	}
	a {
		display: grid;
		gap: 2px;
		text-decoration: none;
		min-width: 0;
	}
	.art {
		position: relative;
		margin-bottom: 6px;
	}
	.art :global(.cover) {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
	}
	.rank {
		position: absolute;
		top: 6px;
		left: 6px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 0.75rem;
		padding: 1px 7px;
		border-radius: 10px;
		font-variant-numeric: tabular-nums;
	}
	strong,
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small {
		color: var(--ink-2);
		font-size: 0.8rem;
	}
	.fig {
		color: var(--muted);
	}
	.empty {
		grid-column: 1 / -1;
		color: var(--muted);
	}
</style>
