<script lang="ts">
	import EntityHead from '#lib/components/EntityHead.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import { u } from '#lib/nav.js';
	let { data, form } = $props();
</script>

<EntityHead kind="album" id={data.id} title={data.row.name} image={data.image} totals={data.totals} monthly={data.monthly} tz={data.view.tz} readonly={data.view.readonly} {form}>
	<p class="by">
		<a href={u(`/artist/${data.artist.id}`)}>{data.artist.name}</a>{#if data.row.release_year}, {data.row.release_year}{/if}
	</p>
</EntityHead>

<section class="panel">
	<h2>Songs you've played from this album</h2>
	<BarList items={data.tracks.map((t) => ({ ...t, href: u(`/track/${t.id}`) }))} rankBy={data.view.rankBy} covers={false} />
</section>

<style>
	.by {
		font-size: 1.1rem;
		color: var(--ink-2);
	}
</style>
