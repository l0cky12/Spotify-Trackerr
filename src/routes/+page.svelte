<script lang="ts">
	import { page } from '$app/state';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import Columns from '#lib/components/Columns.svelte';
	import Heatmap from '#lib/components/Heatmap.svelte';
	import Trends from '#lib/components/Trends.svelte';
	import Cover from '#lib/components/Cover.svelte';
	import NowPlaying from '#lib/components/NowPlaying.svelte';
	import Sleeves from '#lib/components/Sleeves.svelte';
	import Decades from './Decades.svelte';
	import { u, fmt, listened, withParams } from '#lib/nav.js';
	import { RANGES } from '#lib/time.js';

	let { data } = $props();
	const rangeLabel = $derived(RANGES.find((r) => r.id === data.range)!.label.toLowerCase());
	const days = $derived(data.since ? (Date.now() / 1000 - data.since) / 86400 : null);
	const perDay = $derived(days ? data.totals.plays / days : null);
	const rankBy = $derived(data.view.rankBy);
	const prevLabel = $derived(data.range === '24h' ? 'Previous 24 hours' : data.range === 'all' ? '' : `Previous ${RANGES.find((r) => r.id === data.range)!.label.toLowerCase()}`);
	const everyone = $derived(page.url.searchParams.get('user') === 'all');

	const list = (rows: any[], kind: string) =>
		rows.map((r) => ({ ...r, href: u(`/${kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }));
</script>

<div class="top">
	<div>
		<h1>{data.view.label ?? 'Your listening'}</h1>
		<p class="muted">Last {rangeLabel === 'all time' ? 'everything' : rangeLabel}{data.view.rankBy === 'minutes' ? ', ranked by time listened' : ''}</p>
	</div>
	<div class="controls">
		{#if data.otherViewers && !data.view.readonly}
			<label class="check"><input type="checkbox" checked={everyone} onchange={(e) => (location.href = withParams({ user: e.currentTarget.checked ? 'all' : null }))} /> Everyone on this server</label>
		{/if}
		<RangePicker value={data.range} />
	</div>
</div>

{#if !data.view.readonly && !everyone}
	<div class="np"><NowPlaying userId={page.data.me.id} /></div>
{/if}

{#if !data.hasAny}
	<section class="panel empty">
		<h2>No listening history yet</h2>
		<p>Link Spotify to start tracking new plays, and import your Spotify history file to fill in the past.</p>
		<a class="button" href="/settings">Go to Settings</a>
	</section>
{:else}
	<Sleeves track={data.tracks[0]} album={data.albums[0]} artist={data.artists[0]} {rankBy} />

	<dl class="totals">
		<div><dt>Plays</dt><dd>{fmt(data.totals.plays)}</dd></div>
		<div><dt>Time listened</dt><dd>{listened(data.totals.ms)}</dd></div>
		<div><dt>Artists</dt><dd>{fmt(data.totals.artists)}</dd></div>
		<div><dt>Albums</dt><dd>{fmt(data.albumsCount)}</dd></div>
		<div><dt>Songs</dt><dd>{fmt(data.totals.tracks)}</dd></div>
	</dl>

	<section class="panel">
		<h2>
			Plays over time
			<small>{fmt(data.totals.plays)} plays{#if perDay !== null}, {perDay < 10 ? perDay.toFixed(1) : fmt(Math.round(perDay))} a day{/if}</small>
		</h2>
		<Columns labels={data.series.labels} values={data.series.cur} prev={data.series.prev} name="This period" prevName={prevLabel} />
	</section>

	<div class="grid3">
		<section class="panel">
			<h2>Top songs <a class="more" href={u(`/top/track?range=${data.range}`)}>View top 100</a></h2>
			<BarList items={list(data.tracks, 'track')} {rankBy} />
		</section>
		<section class="panel">
			<h2>Top albums <a class="more" href={u(`/top/album?range=${data.range}`)}>View top 100</a></h2>
			<BarList items={list(data.albums.slice(0, 10), 'album')} {rankBy} />
		</section>
		<section class="panel">
			<h2>Top artists <a class="more" href={u(`/top/artist?range=${data.range}`)}>View top 100</a></h2>
			<BarList items={list(data.artists, 'artist')} {rankBy} round />
		</section>
	</div>

	<div class="grid2">
		<section class="panel">
			<h2>
				Genres
				{#if data.totals.plays}<small>{Math.round((data.genres.covered / data.totals.plays) * 100)}% of plays have genre data</small>{/if}
			</h2>
			{#if data.genres.rows.length}
				<BarList items={data.genres.rows.map((g) => ({ ...g, href: u(`/genre/${encodeURIComponent(g.name)}?range=${data.range}`) }))} {rankBy} covers={false} />
			{:else}
				<p class="muted">Genres appear once artists have been looked up. That runs in the background after an import or sync.</p>
			{/if}
		</section>
		<section class="panel">
			<h2>When you listen <a class="more" href={u(`/top/charts?range=${data.range}`)}>Streaks and more charts</a></h2>
			<Heatmap grid={data.series.grid} />
		</section>
	</div>

	{#if data.lastMonth || data.blasts.length}
		<div class="grid2">
			{#if data.lastMonth}
				<section class="panel month">
					<h2>Last month: {data.lastMonth.label} <a class="more" href={u(`/reports?period=${data.lastMonth.id}`)}>Full report</a></h2>
					<dl class="mini">
						<div><dt>Plays</dt><dd>{fmt(data.lastMonth.totals.plays)}</dd></div>
						<div><dt>Time listened</dt><dd>{listened(data.lastMonth.totals.ms)}</dd></div>
						<div><dt>Artists</dt><dd>{fmt(data.lastMonth.totals.artists)}</dd></div>
					</dl>
					{#if data.lastMonth.discovery}
						<a class="discovery" href={u(`/artist/${data.lastMonth.discovery.id}`)}>
							<Cover src={data.lastMonth.discovery.image} alt={data.lastMonth.discovery.name} size={44} round />
							<span><small>Biggest new discovery</small><strong>{data.lastMonth.discovery.name}</strong><small>{fmt(data.lastMonth.discovery.plays)} plays, first heard that month</small></span>
						</a>
					{/if}
					<div class="pair">
						<div><h3>Top songs</h3><BarList items={list(data.lastMonth.tracks, 'track')} {rankBy} covers={false} /></div>
						<div><h3>Top artists</h3><BarList items={list(data.lastMonth.artists, 'artist')} {rankBy} covers={false} /></div>
					</div>
				</section>
			{/if}
			{#if data.blasts.length}
				<section class="panel">
					<h2>Blasts from the past <small>What you played on this day in earlier years</small></h2>
					<div class="blasts">
						{#each data.blasts as b (b.year)}
							<div class="blast">
								<h3>
									{b.yearsAgo === 1 ? 'A year' : `${b.yearsAgo} years`} ago{b.week ? ' this week' : ' today'}
									<small>{b.year}, {fmt(b.plays)} plays{b.week ? ' that week' : ''}</small>
								</h3>
								<ul>
									{#each b.tracks as t (t.id)}
										<li>
											<Cover src={t.image} alt={t.name} size={32} />
											<span class="what"><a href={u(`/track/${t.id}`)}>{t.name}</a><small>{t.artist}</small></span>
											<small class="n">{rankBy === 'minutes' ? listened(t.ms) : `${fmt(t.plays)}×`}</small>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}

	<section class="panel">
		<h2>Top artists over time</h2>
		<Trends labels={data.series.labels} series={data.series.trends} />
	</section>

	<div class="grid2">
		<section class="panel">
			<h2>Music by release decade <small>Click a decade to see its years</small></h2>
			<Decades years={data.years} />
		</section>
		<section class="panel">
			<h2>Top album covers</h2>
			<div class="collage">
				{#each data.albums as a (a.id)}
					<a href={u(`/album/${a.id}`)} title="{a.name} by {a.artist}: {fmt(a.plays)} plays"><Cover src={a.image} alt={a.name} size={160} /></a>
				{/each}
			</div>
		</section>
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
	.top p {
		margin: 4px 0 0;
	}
	.controls {
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
	}
	.check {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 0.85rem;
		color: var(--ink-2);
	}
	.np {
		margin-bottom: 20px;
		max-width: 520px;
	}
	.empty {
		display: grid;
		gap: 10px;
		justify-items: start;
	}
	.empty p {
		margin: 0;
		color: var(--ink-2);
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
	.panel {
		margin-bottom: 20px;
	}
	.grid3,
	.grid2 {
		display: grid;
		gap: 20px;
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
	.grid3,
	.grid2 {
		margin-bottom: 20px;
	}
	.more {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--ink-2);
	}
	.mini {
		display: flex;
		gap: 8px 32px;
		margin: 0 0 14px;
		flex-wrap: wrap;
	}
	.mini div {
		display: flex;
		flex-direction: column-reverse;
	}
	.mini dd {
		font-size: 1.3rem;
	}
	.discovery {
		display: flex;
		gap: 12px;
		align-items: center;
		text-decoration: none;
		padding: 10px 12px;
		background: var(--surface-2);
		border-radius: 8px;
		margin-bottom: 14px;
	}
	.discovery span {
		display: grid;
		min-width: 0;
	}
	.discovery small {
		color: var(--ink-2);
		font-size: 0.78rem;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	h3 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-2);
		margin: 0 0 8px;
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: baseline;
	}
	h3 small {
		font-weight: 400;
		color: var(--muted);
		font-size: 0.78rem;
	}
	.blasts {
		display: grid;
		gap: 16px;
	}
	.blast ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.blast li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: center;
	}
	.blast .what {
		display: grid;
		min-width: 0;
	}
	.blast .what a,
	.blast .what small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.blast small {
		color: var(--ink-2);
		font-size: 0.78rem;
	}
	.blast .n {
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 600px) {
		.pair {
			grid-template-columns: 1fr;
		}
	}
	.collage {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.collage :global(.cover) {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		border-radius: 2px;
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
	}
</style>
