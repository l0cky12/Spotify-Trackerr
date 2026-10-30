<script lang="ts">
	import EntityHead from '#lib/components/EntityHead.svelte';
	import CoverGrid from '#lib/components/CoverGrid.svelte';
	import RecList from '#lib/components/RecList.svelte';
	import { u } from '#lib/nav.js';
	import { enhance } from '$app/forms';
	import { formatShowDate } from '#lib/time.js';
	let { data, form } = $props();
	const spotify = $derived(data.row.spotify_id ? `https://open.spotify.com/artist/${data.row.spotify_id}` : `https://open.spotify.com/search/${encodeURIComponent(data.row.name)}`);
</script>

<EntityHead kind="artist" id={data.id} title={data.row.name} image={data.image} round totals={data.totals} monthly={data.monthly} tz={data.view.tz} readonly={data.view.readonly} bannedBy={data.bannedBy} {form}>
	{#if data.genres.length}<p class="genres">{data.genres.join(', ')}</p>{/if}
	<div class="actions">
		<a class="button" href={spotify} target="_blank" rel="noopener">Open in Spotify</a>
		{#if data.watching !== null}
			<form method="POST" action={data.watching ? '?/unwatch' : '?/watch'} use:enhance>
				<button class="secondary" aria-pressed={data.watching} title="Your AI assistant looks for shows near you by the artists you watch. See Shows.">
					{data.watching ? 'Watching for shows ✓' : 'Watch for shows'}
				</button>
			</form>
		{/if}
	</div>
</EntityHead>

{#if data.shows.length}
	<section class="panel shows">
		<h2>Upcoming shows near you <small><a href="/shows">All shows</a></small></h2>
		<ul>
			{#each data.shows as s (s.id)}
				<li>
					<strong>{formatShowDate(s.date)}</strong>
					· {s.venue}, {s.city}
					{#if s.url}· <a href={s.url} target="_blank" rel="noopener">Details</a>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<div class="cols">
	<section class="panel">
		<h2>Top songs</h2>
		<CoverGrid items={data.tracks.map((t) => ({ ...t, href: u(`/track/${t.id}`) }))} sort={data.view.rankBy} min={100} />
	</section>
	<section class="panel">
		<h2>Top albums</h2>
		<CoverGrid items={data.albums.map((a) => ({ ...a, href: u(`/album/${a.id}`) }))} sort={data.view.rankBy} min={100} />
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
	.actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}
	.shows {
		margin-bottom: 20px;
	}
	.shows ul {
		margin: 0;
		padding-left: 18px;
		display: grid;
		gap: 4px;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 20px;
	}
</style>
