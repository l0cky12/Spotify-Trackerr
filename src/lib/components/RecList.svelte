<script lang="ts">
	import { u } from '#lib/nav.js';
	type Rec = { title?: string; artist: string; trackId?: number | null; artistId?: number | null; url: string };
	let { recs, artistsOnly = false }: { recs: Rec[]; artistsOnly?: boolean } = $props();
</script>

<ul class="recs">
	{#each recs as r, i (i)}
		<li>
			{#if artistsOnly}
				{#if r.artistId}<a href={u(`/artist/${r.artistId}`)}>{r.artist}</a> <span class="heard">in your library</span>{:else}{r.artist}{/if}
			{:else}
				<span>
					{#if r.trackId}<a href={u(`/track/${r.trackId}`)}>{r.title}</a>{:else}{r.title}{/if}
					<small>{#if r.artistId}<a href={u(`/artist/${r.artistId}`)}>{r.artist}</a>{:else}{r.artist}{/if}</small>
				</span>
				{#if r.trackId}<span class="heard">played before</span>{/if}
			{/if}
			<a class="sp" href={r.url} target="_blank" rel="noopener">Open in Spotify</a>
		</li>
	{:else}
		<li class="muted">No suggestions found.</li>
	{/each}
</ul>

<style>
	.recs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	li {
		display: flex;
		gap: 10px;
		align-items: baseline;
		justify-content: space-between;
	}
	li > span {
		display: grid;
		min-width: 0;
		flex: 1;
	}
	small {
		color: var(--ink-2);
	}
	.heard {
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
	}
	.sp {
		font-size: 0.8rem;
		color: var(--ink-2);
		white-space: nowrap;
	}
</style>
