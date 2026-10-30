<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import CoverGrid from '#lib/components/CoverGrid.svelte';
	import Columns from '#lib/components/Columns.svelte';
	import { u, fmt, listened } from '#lib/nav.js';
	import { monthName } from '#lib/time.js';

	let { data } = $props();
	const rankBy = $derived(data.view.rankBy);
	const list = (rows: any[], kind: string) => rows.map((r) => ({ ...r, href: u(`/${kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }));
	const pct = (p: number | null) => (p === null ? 'new' : `${p > 0 ? '+' : ''}${p}%`);
	const trend = (p: number | null) => (p === null || p === 0 ? '' : p > 0 ? 'up' : 'down');
	const prevName = $derived(data.period.m === null ? 'Previous year' : 'Previous month');
	const stats = $derived([
		{ k: 'Plays', v: fmt(data.totals.plays), d: data.delta.plays },
		{ k: 'Time listened', v: listened(data.totals.ms), d: data.delta.ms },
		{ k: 'Artists', v: fmt(data.totals.artists), d: data.delta.artists },
		{ k: 'Songs', v: fmt(data.totals.tracks), d: data.delta.tracks }
	]);
</script>

<div class="head">
	<div>
		<h1>{data.period.label}</h1>
		<p class="muted">{data.view.label ? `${data.view.label}'s` : 'Your'} listening report{#if data.period.m === null}, the whole year{/if}</p>
	</div>
	<nav class="picker" aria-label="Period">
		<div class="years">
			{#each data.years as y (y)}<a href={u(`/reports?period=${y}`)} aria-current={y === data.period.y && data.period.m === null ? 'page' : undefined}>{y}</a>{/each}
		</div>
		<div class="months">
			{#each data.months as m (m.id)}
				<a href={u(`/reports?period=${m.id}`)} aria-current={m.id === data.period.id ? 'page' : undefined} class:empty={!m.plays} title="{fmt(m.plays)} plays">{monthName(m.m)}</a>
			{/each}
		</div>
	</nav>
</div>

{#if !data.totals.plays}
	<p class="muted">No plays in {data.period.label}.</p>
{:else}
	<dl class="totals">
		{#each stats as s (s.k)}
			<div>
				<dt>{s.k}</dt>
				<dd>{s.v}</dd>
				<span class="delta {trend(s.d.pct)}" title="{prevName}: {s.k === 'Time listened' ? listened(data.totals.ms - s.d.diff) : fmt((s.k === 'Plays' ? data.totals.plays : s.k === 'Artists' ? data.totals.artists : data.totals.tracks) - s.d.diff)}">
					{pct(s.d.pct)} <small>vs {data.period.prev.label}</small>
				</span>
			</div>
		{/each}
		{#if data.busiest}
			<div>
				<dt>Busiest day</dt>
				<dd class="day">{data.busiest.label}</dd>
				<span class="delta">{fmt(data.busiest.plays)} plays</span>
			</div>
		{/if}
	</dl>

	{#if data.series}
		<section class="panel">
			<h2>Plays over {data.period.label} <small>{data.period.prev.label} alongside</small></h2>
			<Columns labels={data.series.labels} values={data.series.cur} prev={data.series.prev} name={data.period.label} prevName={data.period.prev.label} />
		</section>
	{/if}

	<div class="grid3">
		<section class="panel"><h2>Top 10 songs</h2><CoverGrid items={list(data.tracks, 'track')} sort={rankBy} min={100} /></section>
		<section class="panel"><h2>Top 10 albums</h2><CoverGrid items={list(data.albums, 'album')} sort={rankBy} min={100} /></section>
		<section class="panel"><h2>Top 10 artists</h2><CoverGrid items={list(data.artists, 'artist')} sort={rankBy} round min={100} /></section>
	</div>

	<div class="grid2">
		<section class="panel">
			<h2>Top 10 genres</h2>
			{#if data.genres.length}
				<BarList items={data.genres.map((g) => ({ ...g, href: u(`/genre/${encodeURIComponent(g.name)}`) }))} {rankBy} covers={false} />
			{:else}
				<p class="muted">No genre data for this period yet.</p>
			{/if}
		</section>
		<section class="panel">
			<h2>New to you <small>Artists first played in {data.period.label}</small></h2>
			{#if data.newArtists.length}
				<CoverGrid items={list(data.newArtists, 'artist')} sort={rankBy} round min={110} />
			{:else}
				<p class="muted">No new artists this period.</p>
			{/if}
		</section>
	</div>

	<p class="muted small"><a href={u(`/history?range=all&month=${data.period.m === null ? `${data.period.y}-01` : data.period.id}`)}>Browse these plays in History</a>{#if data.period.m === null} · <a href={u(`/wrapped/${data.period.y}`)}>Year in review</a>{/if}</p>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.head p {
		margin: 4px 0 0;
	}
	.picker {
		display: grid;
		gap: 6px;
		justify-items: end;
	}
	.years,
	.months {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		background: var(--surface);
		padding: 3px;
		border-radius: 8px;
	}
	.picker a {
		padding: 4px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink-2);
		font-size: 0.85rem;
	}
	.picker a.empty {
		color: var(--muted);
	}
	.picker a:hover {
		background: var(--surface-2);
	}
	.picker a[aria-current] {
		background: var(--ink);
		color: var(--page);
		font-weight: 600;
	}
	.totals {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 40px;
		margin: 0 0 20px;
		padding: 0 4px;
	}
	.totals div {
		display: grid;
	}
	dt {
		color: var(--muted);
		font-size: 0.8rem;
		order: -1;
	}
	dd {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		font-stretch: 80%;
	}
	dd.day {
		font-size: 1.2rem;
	}
	.delta {
		font-size: 0.85rem;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.delta.up {
		color: var(--good);
	}
	.delta.down {
		color: var(--critical);
	}
	.delta small {
		color: var(--muted);
	}
	.panel {
		margin-bottom: 20px;
	}
	.grid3,
	.grid2 {
		display: grid;
		gap: 20px;
		margin-bottom: 20px;
	}
	.grid3 {
		grid-template-columns: repeat(3, 1fr);
	}
	.grid2 {
		grid-template-columns: 1fr 1fr;
	}
	.grid3 .panel,
	.grid2 .panel {
		margin-bottom: 0;
	}
	.small {
		font-size: 0.85rem;
	}
	@media (max-width: 1000px) {
		.grid3 {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 800px) {
		.grid2 {
			grid-template-columns: 1fr;
		}
		.picker {
			justify-items: start;
		}
	}
</style>
