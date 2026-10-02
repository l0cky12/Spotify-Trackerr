<script lang="ts">
	import Cover from '#lib/components/Cover.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import Columns from '#lib/components/Columns.svelte';
	import Calendar from '#lib/components/Calendar.svelte';
	import { u, fmt, minutes } from '#lib/nav.js';
	import { monthName } from '#lib/time.js';

	let { data } = $props();
	const rankBy = $derived(data.view.rankBy);
	const MONTHS = Array.from({ length: 12 }, (_, m) => monthName(m));
	const ry = $derived.by(() => {
		if (!data.releaseYears.length) return null;
		const lo = data.releaseYears[0].year,
			hi = data.releaseYears.at(-1)!.year;
		const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
		return { labels: all.map(String), values: all.map((y) => data.releaseYears.find((r) => r.year === y)?.plays ?? 0) };
	});
	const list = (rows: any[], kind: string) => rows.map((r) => ({ ...r, href: u(`/${kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }));
</script>

<nav class="years" aria-label="Year">
	{#each data.years as y (y)}<a href={u(`/wrapped/${y}`)} aria-current={y === data.year ? 'page' : undefined}>{y}</a>{/each}
</nav>

<header class="hero">
	<span class="yr">{data.year}</span>
	<p>{data.view.label ? `${data.view.label}'s` : 'Your'} year in music</p>
</header>

{#if !data.totals.plays}
	<p class="muted">No plays in {data.year}.</p>
{:else}
	<dl class="headline">
		<div><dt>minutes listened</dt><dd>{fmt(minutes(data.totals.ms))}</dd></div>
		<div><dt>plays</dt><dd>{fmt(data.totals.plays)}</dd></div>
		<div><dt>artists</dt><dd>{fmt(data.totals.artists)}</dd></div>
		<div><dt>songs</dt><dd>{fmt(data.totals.tracks)}</dd></div>
		<div><dt>artists new to you</dt><dd>{fmt(data.newArtists)}</dd></div>
	</dl>

	<section class="tops">
		{#each [{ t: 'Top song', r: data.tracks[0], k: 'track' }, { t: 'Top album', r: data.albums[0], k: 'album' }, { t: 'Top artist', r: data.artists[0], k: 'artist' }] as s (s.t)}
			{#if s.r}
				<a class="top1" href={u(`/${s.k}/${s.r.id}`)}>
					<Cover src={s.r.image} alt={s.r.name} size={300} round={s.k === 'artist'} />
					<span class="kind">{s.t}</span>
					<strong>{s.r.name}</strong>
					<span class="muted">{s.r.artist ? `${s.r.artist}, ` : ''}{fmt(s.r.plays)} plays</span>
				</a>
			{/if}
		{/each}
	</section>

	<div class="grid3">
		<section class="panel"><h2>Top 5 songs</h2><BarList items={list(data.tracks, 'track')} {rankBy} /></section>
		<section class="panel"><h2>Top 5 albums</h2><BarList items={list(data.albums, 'album')} {rankBy} /></section>
		<section class="panel"><h2>Top 5 artists</h2><BarList items={list(data.artists, 'artist')} {rankBy} round /></section>
	</div>

	<section class="panel">
		<h2>
			Every day of {data.year}
			{#if data.bestDay}<small>Biggest day: {monthName(data.bestDay.month)} {data.bestDay.day}, with {fmt(data.bestDay.plays)} plays</small>{/if}
		</h2>
		<Calendar year={data.year} days={data.days} />
	</section>

	<div class="grid2">
		<section class="panel">
			<h2>Plays per month</h2>
			<Columns labels={MONTHS} values={data.months} name="Plays" highlight={data.months.indexOf(Math.max(...data.months))} />
		</section>
		<section class="panel">
			<h2>Top genres</h2>
			{#if data.genres.length}<BarList items={data.genres} {rankBy} covers={false} />{:else}<p class="muted">No genre data yet.</p>{/if}
		</section>
	</div>

	{#if ry}
		<section class="panel">
			<h2>When your music came out <small>Plays by release year</small></h2>
			<Columns labels={ry.labels} values={ry.values} name="Plays" />
		</section>
	{/if}
{/if}

<style>
	.years {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.years a {
		padding: 4px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink-2);
	}
	.years a[aria-current] {
		background: var(--ink);
		color: var(--page);
		font-weight: 600;
	}
	.hero {
		margin: 8px 0 24px;
	}
	.yr {
		display: block;
		font-size: clamp(5rem, 16vw, 11rem);
		font-weight: 900;
		font-stretch: 62%;
		line-height: 0.85;
		letter-spacing: -0.03em;
	}
	.hero p {
		margin: 8px 0 0;
		font-size: 1.3rem;
		color: var(--ink-2);
	}
	.headline {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 48px;
		margin: 0 0 28px;
	}
	.headline div {
		display: flex;
		flex-direction: column-reverse;
	}
	dt {
		color: var(--ink-2);
	}
	dd {
		margin: 0;
		font-size: 2.6rem;
		font-weight: 800;
		font-stretch: 70%;
		line-height: 1;
	}
	.tops {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-bottom: 20px;
	}
	.top1 {
		display: grid;
		gap: 4px;
		text-decoration: none;
	}
	.top1 :global(.cover) {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		margin-bottom: 8px;
	}
	.top1 strong {
		font-size: 1.3rem;
	}
	.kind {
		color: var(--ink-2);
		font-size: 0.85rem;
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
	@media (max-width: 900px) {
		.grid3,
		.grid2,
		.tops {
			grid-template-columns: 1fr;
		}
	}
</style>
