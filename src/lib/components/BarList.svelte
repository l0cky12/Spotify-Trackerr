<script lang="ts">
	import Cover from './Cover.svelte';
	import { fmt, minutes } from '#lib/nav.js';

	type Item = { name: string; sub?: string | null; href?: string; subHref?: string; image?: string | null; plays: number; ms: number };
	let { items, rankBy = 'plays', round = false, start = 0, covers = true }: { items: Item[]; rankBy?: string; round?: boolean; start?: number; covers?: boolean } =
		$props();

	const val = (i: Item) => (rankBy === 'minutes' ? minutes(i.ms) : i.plays);
	const max = $derived(Math.max(1, ...items.map(val)));
</script>

<ol class="bars" {start}>
	{#each items as item, i (item.href ?? i)}
		<li title="{item.name}: {fmt(item.plays)} plays, {fmt(minutes(item.ms))} minutes">
			<span class="rank">{start + i + 1}</span>
			{#if covers}<Cover src={item.image} alt={item.name} size={36} {round} />{/if}
			<span class="text">
				{#if item.href}<a href={item.href}>{item.name}</a>{:else}{item.name}{/if}
				{#if item.sub}<small>{#if item.subHref}<a href={item.subHref}>{item.sub}</a>{:else}{item.sub}{/if}</small>{/if}
				<span class="track"><span class="bar" style:width="{(val(item) / max) * 100}%"></span></span>
			</span>
			<span class="value">
				{fmt(val(item))}
				<small>{rankBy === 'minutes' ? `${fmt(item.plays)} plays` : `${fmt(minutes(item.ms))} min`}</small>
			</span>
		</li>
	{:else}
		<li class="empty">No plays in this range.</li>
	{/each}
</ol>

<style>
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	li {
		display: grid;
		grid-template-columns: 1.5rem auto 1fr auto;
		align-items: center;
		gap: 10px;
	}
	li:not(:has(:global(.cover))) {
		grid-template-columns: 1.5rem 1fr auto;
	}
	.rank {
		color: var(--muted);
		font-size: 0.8rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.text {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.text > a,
	.text small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.text small,
	.value small {
		color: var(--ink-2);
		font-size: 0.78rem;
	}
	.track {
		height: 6px;
		margin-top: 3px;
	}
	.bar {
		display: block;
		height: 100%;
		min-width: 2px;
		background: var(--series-1);
		border-radius: 0 4px 4px 0;
	}
	.value {
		text-align: right;
		font-variant-numeric: tabular-nums;
		display: grid;
		font-weight: 600;
	}
	.value small {
		font-weight: 400;
	}
	.empty {
		display: block;
		color: var(--muted);
	}
</style>
