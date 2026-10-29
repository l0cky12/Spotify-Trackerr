<script lang="ts">
	import Cover from './Cover.svelte';
	import { u, fmt, minutes } from '#lib/nav.js';

	type Item = { id: number; name: string; artist?: string | null; image?: string | null; plays: number; ms: number };
	let { track, album, artist, rankBy = 'plays' }: { track?: Item; album?: Item; artist?: Item; rankBy?: string } = $props();

	const sleeves = $derived([
		{ kind: 'Top song', item: track, href: track && u(`/track/${track.id}`), round: false },
		{ kind: 'Top album', item: album, href: album && u(`/album/${album.id}`), round: false },
		{ kind: 'Top artist', item: artist, href: artist && u(`/artist/${artist.id}`), round: true }
	]);
	const value = (r: Item) => (rankBy === 'minutes' ? minutes(r.ms) : r.plays);
</script>

<section class="sleeves">
	{#each sleeves as s (s.kind)}
		<a class="sleeve" href={s.href ?? undefined} class:none={!s.item}>
			<div class="art"><Cover src={s.item?.image} alt={s.item?.name ?? s.kind} size={480} round={s.round} /></div>
			<div class="meta">
				<span class="kind">{s.kind}</span>
				<span class="name">{s.item?.name ?? 'Nothing yet'}</span>
				{#if s.item?.artist}<span class="by">{s.item.artist}</span>{/if}
				{#if s.item}
					<span class="count"><span class="big">{fmt(value(s.item))}</span> {rankBy === 'minutes' ? 'minutes' : 'plays'}</span>
					<span class="by">{rankBy === 'minutes' ? `${fmt(s.item.plays)} plays` : `${fmt(minutes(s.item.ms))} minutes`}</span>
				{/if}
			</div>
		</a>
	{/each}
</section>

<style>
	/* The three record sleeves are the one loud thing on the page. */
	.sleeves {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-bottom: 20px;
	}
	.sleeve {
		position: relative;
		display: block;
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		text-decoration: none;
		background: var(--surface);
	}
	.sleeve .art,
	.sleeve .art :global(.cover) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border-radius: 0;
		font-size: 5rem;
	}
	.sleeve .meta {
		position: absolute;
		inset: auto 0 0 0;
		padding: 48px 18px 16px;
		background: linear-gradient(transparent, rgba(10, 8, 14, 0.92) 55%);
		display: grid;
		gap: 1px;
	}
	.kind {
		font-size: 0.8rem;
		color: var(--ink-2);
	}
	.name {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.by {
		color: var(--ink-2);
		font-size: 0.85rem;
	}
	.count {
		margin-top: 8px;
		color: var(--ink-2);
	}
	.big {
		font-size: 3.2rem;
		font-weight: 800;
		font-stretch: 62%;
		color: var(--ink);
		line-height: 0.9;
		letter-spacing: -0.01em;
	}
	.sleeve:hover .name {
		text-decoration: underline;
	}
	@media (max-width: 800px) {
		.sleeves {
			grid-template-columns: 1fr;
		}
		.sleeve {
			aspect-ratio: 4 / 3;
		}
	}
</style>
