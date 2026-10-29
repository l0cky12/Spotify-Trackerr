<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import Sleeves from '#lib/components/Sleeves.svelte';
	import { u, fmt, minutes } from '#lib/nav.js';
	import { RANGES } from '#lib/time.js';

	let { data } = $props();
	const rankBy = $derived(data.view.rankBy);
	const when = $derived(data.year ? `In ${data.year}` : `Last ${RANGES.find((r) => r.id === data.range)!.label.toLowerCase()}`);
	const list = (rows: any[], kind: string) =>
		rows.map((r) => ({ ...r, href: u(`/${kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }));
</script>

<div class="top">
	<div>
		<h1>{data.name}</h1>
		<p class="muted">{data.view.label ? `${data.view.label}, ` : ''}{when}</p>
	</div>
	<RangePicker value={data.range ?? ''} />
</div>

{#if !data.totals.plays}
	<p class="muted">No plays in this genre for this range.</p>
{:else}
	<Sleeves track={data.tracks[0]} album={data.albums[0]} artist={data.artists[0]} {rankBy} />

	<dl class="totals">
		<div><dt>Plays</dt><dd>{fmt(data.totals.plays)}</dd></div>
		<div><dt>Minutes</dt><dd>{fmt(minutes(data.totals.ms))}</dd></div>
		<div><dt>Artists</dt><dd>{fmt(data.totals.artists)}</dd></div>
		<div><dt>Songs</dt><dd>{fmt(data.totals.tracks)}</dd></div>
	</dl>

	<div class="grid3">
		<section class="panel"><h2>Top 10 songs</h2><BarList items={list(data.tracks, 'track')} {rankBy} /></section>
		<section class="panel"><h2>Top 10 albums</h2><BarList items={list(data.albums, 'album')} {rankBy} /></section>
		<section class="panel"><h2>Top 10 artists</h2><BarList items={list(data.artists, 'artist')} {rankBy} round /></section>
	</div>
{/if}

<style>
	.top {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	h1 {
		text-transform: capitalize;
	}
	.top p {
		margin: 4px 0 0;
	}
	.totals {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 40px;
		margin: 0 0 20px;
		padding: 0 4px;
	}
	.totals div {
		display: flex;
		flex-direction: column-reverse;
	}
	dt {
		color: var(--muted);
		font-size: 0.8rem;
	}
	dd {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		font-stretch: 80%;
	}
	.grid3 {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
	}
	@media (max-width: 1000px) {
		.grid3 {
			grid-template-columns: 1fr;
		}
	}
</style>
