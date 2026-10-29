<script lang="ts">
	import BarList from './BarList.svelte';
	import Cover from './Cover.svelte';
	import { u, fmt, minutes } from '#lib/nav.js';

	type Top = { id: number; name: string; artist: string | null; artist_id: number | null; image: string | null; plays: number; ms: number };
	type Genre = { name: string; plays: number; ms: number; tops: { track?: Top; album?: Top; artist?: Top } };
	let { genres, rankBy = 'plays' }: { genres: Genre[]; rankBy?: string } = $props();

	// Keep the name, not the row: a new range reloads the rows and the same genre stays open.
	let picked = $state<string | null>(null);
	const open = $derived(genres.find((g) => g.name === picked));
	const KINDS = [
		{ k: 'artist', t: 'Top artist' },
		{ k: 'track', t: 'Top song' },
		{ k: 'album', t: 'Top album' }
	] as const;
</script>

{#if open}
	<button class="secondary back" onclick={() => (picked = null)}>All genres</button>
	<h3>{open.name}</h3>
	<ul class="tops">
		{#each KINDS as { k, t } (k)}
			{@const r = open.tops[k]}
			{#if r}
				<li>
					<Cover src={r.image} alt={r.name} size={56} round={k === 'artist'} />
					<span class="text">
						<small>{t}</small>
						<a href={u(`/${k}/${r.id}`)}>{r.name}</a>
						{#if r.artist}<small>{#if r.artist_id}<a href={u(`/artist/${r.artist_id}`)}>{r.artist}</a>{:else}{r.artist}{/if}</small>{/if}
					</span>
					<span class="value">{rankBy === 'minutes' ? `${fmt(minutes(r.ms))} min` : `${fmt(r.plays)} plays`}</span>
				</li>
			{/if}
		{/each}
	</ul>
{:else}
	<BarList items={genres} {rankBy} covers={false} onselect={(g) => (picked = g.name)} />
{/if}

<style>
	.back {
		font-size: 0.8rem;
		padding: 4px 10px;
		margin-bottom: 10px;
	}
	h3 {
		margin: 0 0 12px;
		text-transform: capitalize;
	}
	.tops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
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
	.text small {
		color: var(--ink-2);
		font-size: 0.78rem;
	}
	.text > a {
		font-weight: 600;
	}
	.value {
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
		font-size: 0.85rem;
	}
</style>
