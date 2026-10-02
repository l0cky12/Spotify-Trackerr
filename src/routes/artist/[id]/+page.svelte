<script lang="ts">
	import EntityHead from '#lib/components/EntityHead.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import RecList from '#lib/components/RecList.svelte';
	import { u } from '#lib/nav.js';
	let { data, form } = $props();
	const spotify = $derived(data.row.spotify_id ? `https://open.spotify.com/artist/${data.row.spotify_id}` : `https://open.spotify.com/search/${encodeURIComponent(data.row.name)}`);
</script>

<EntityHead kind="artist" id={data.id} title={data.row.name} image={data.image} round totals={data.totals} monthly={data.monthly} tz={data.view.tz} readonly={data.view.readonly} {form}>
	{#if data.genres.length}<p class="genres">{data.genres.join(', ')}</p>{/if}
	<p><a class="button" href={spotify} target="_blank" rel="noopener">Open in Spotify</a></p>
</EntityHead>

<div class="cols">
	<section class="panel">
		<h2>Top songs</h2>
		<BarList items={data.tracks.map((t) => ({ ...t, href: u(`/track/${t.id}`) }))} rankBy={data.view.rankBy} />
	</section>
	<section class="panel">
		<h2>Top albums</h2>
		<BarList items={data.albums.map((a) => ({ ...a, href: u(`/album/${a.id}`) }))} rankBy={data.view.rankBy} />
	</section>
	{#if data.lastfm}
		<section class="panel">
			<h2>Similar artists <small>From Last.fm listeners</small></h2>
			{#await data.similar}
				<p class="muted">Finding similar artists…</p>
			{:then recs}
				<RecList recs={recs.map((r) => ({ ...r, url: r.url || `https://open.spotify.com/search/${encodeURIComponent(r.artist)}` }))} artistsOnly />
			{/await}
		</section>
	{/if}
</div>

<style>
	.genres {
		color: var(--ink-2);
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 20px;
	}
</style>
