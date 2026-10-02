<script lang="ts">
	import EntityHead from '#lib/components/EntityHead.svelte';
	import RecList from '#lib/components/RecList.svelte';
	import { u } from '#lib/nav.js';
	let { data, form } = $props();
	const spotify = $derived(data.row.spotify_id ? `https://open.spotify.com/track/${data.row.spotify_id}` : null);
</script>

<EntityHead kind="track" id={data.id} title={data.row.name} image={data.image} totals={data.totals} monthly={data.monthly} tz={data.view.tz} readonly={data.view.readonly} {form}>
	<p class="by">
		<a href={u(`/artist/${data.artist.id}`)}>{data.artist.name}</a>{#if data.album}, from <a href={u(`/album/${data.album.id}`)}>{data.album.name}</a>{/if}
	</p>
	{#if spotify}<p><a class="button" href={spotify} target="_blank" rel="noopener">Open in Spotify</a></p>{/if}
</EntityHead>

<div class="cols">
	{#if data.row.spotify_id}
		<section class="panel">
			<h2>Listen</h2>
			<iframe
				title="Spotify player for {data.row.name}"
				src="https://open.spotify.com/embed/track/{data.row.spotify_id}?theme=0"
				width="100%"
				height="152"
				frameborder="0"
				allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
				loading="lazy"
			></iframe>
		</section>
	{/if}
	{#if data.lastfm}
		<section class="panel">
			<h2>Similar songs <small>From Last.fm listeners</small></h2>
			{#await data.similar}
				<p class="muted">Finding similar songs…</p>
			{:then recs}
				<RecList {recs} />
			{/await}
		</section>
	{/if}
</div>

<style>
	.by {
		font-size: 1.1rem;
		color: var(--ink-2);
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: 20px;
	}
	iframe {
		border-radius: 12px;
		border: 0;
	}
</style>
