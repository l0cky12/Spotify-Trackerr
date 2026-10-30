<script lang="ts">
	import Cover from './Cover.svelte';
	import { u } from '#lib/nav.js';
	type Rec = { title?: string; artist: string; image?: string | null; trackId?: number | null; artistId?: number | null; url: string };
	let { recs, artistsOnly = false }: { recs: Rec[]; artistsOnly?: boolean } = $props();
	// Picks already in the library open our own page, with Spotify a link underneath; the rest open Spotify.
	const local = (r: Rec) => (artistsOnly ? (r.artistId ? `/artist/${r.artistId}` : null) : r.trackId ? `/track/${r.trackId}` : null);
	const name = (r: Rec) => (artistsOnly ? r.artist : r.title!);
</script>

<ul class="recs">
	{#each recs as r, i (i)}
		{@const href = local(r)}
		<li class:round={artistsOnly}>
			<a href={href ? u(href) : r.url} target={href ? undefined : '_blank'} rel={href ? undefined : 'noopener'} title={name(r)}>
				<Cover src={r.image} alt={name(r)} size={160} round={artistsOnly} />
				<strong>{name(r)}</strong>
			</a>
			{#if !artistsOnly}<small>{#if r.artistId}<a href={u(`/artist/${r.artistId}`)}>{r.artist}</a>{:else}{r.artist}{/if}</small>{/if}
			{#if href}
				<span class="heard">{artistsOnly ? 'in your library' : 'played before'} · <a href={r.url} target="_blank" rel="noopener">Spotify</a></span>
			{/if}
		</li>
	{:else}
		<li class="muted empty">No suggestions found.</li>
	{/each}
</ul>

<style>
	.recs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 16px 12px;
	}
	li {
		display: grid;
		gap: 2px;
		align-content: start;
		min-width: 0;
	}
	li > a {
		display: grid;
		gap: 2px;
		text-decoration: none;
	}
	li > a :global(.cover) {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		margin-bottom: 6px;
	}
	a:hover strong {
		text-decoration: underline;
	}
	strong,
	small,
	.heard {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small {
		color: var(--ink-2);
		font-size: 0.8rem;
	}
	.heard {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.heard a {
		color: var(--ink-2);
	}
	.round {
		text-align: center;
	}
	.empty {
		grid-column: 1 / -1;
	}
</style>
