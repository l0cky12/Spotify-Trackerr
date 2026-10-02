<script lang="ts">
	import { page } from '$app/state';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import BarList from '#lib/components/BarList.svelte';
	import Columns from '#lib/components/Columns.svelte';
	import Heatmap from '#lib/components/Heatmap.svelte';
	import Trends from '#lib/components/Trends.svelte';
	import Cover from '#lib/components/Cover.svelte';
	import NowPlaying from '#lib/components/NowPlaying.svelte';
	import Decades from './Decades.svelte';
	import { u, fmt, minutes, withParams } from '#lib/nav.js';
	import { RANGES } from '#lib/time.js';

	let { data } = $props();
	const rangeLabel = $derived(RANGES.find((r) => r.id === data.range)!.label.toLowerCase());
	const days = $derived(data.since ? (Date.now() / 1000 - data.since) / 86400 : null);
	const perDay = $derived(days ? data.totals.plays / days : null);
	const rankBy = $derived(data.view.rankBy);
	const value = (r: { plays: number; ms: number }) => (rankBy === 'minutes' ? minutes(r.ms) : r.plays);
	const unit = $derived(rankBy === 'minutes' ? 'minutes' : 'plays');
	const prevLabel = $derived(data.range === '24h' ? 'Previous 24 hours' : data.range === 'all' ? '' : `Previous ${RANGES.find((r) => r.id === data.range)!.label.toLowerCase()}`);
	const everyone = $derived(page.url.searchParams.get('user') === 'all');

	const sleeves = $derived([
		{ kind: 'Top song', item: data.tracks[0], href: data.tracks[0] && u(`/track/${data.tracks[0].id}`), round: false },
		{ kind: 'Top album', item: data.albums[0], href: data.albums[0] && u(`/album/${data.albums[0].id}`), round: false },
		{ kind: 'Top artist', item: data.artists[0], href: data.artists[0] && u(`/artist/${data.artists[0].id}`), round: true }
	]);
	const list = (rows: any[], kind: string) =>
		rows.map((r) => ({ ...r, href: u(`/${kind}/${r.id}`), sub: r.artist, subHref: r.artist_id ? u(`/artist/${r.artist_id}`) : undefined }));
</script>

<div class="top">
	<div>
		<h1>{data.view.label ?? 'Your listening'}</h1>
		<p class="muted">Last {rangeLabel === 'all time' ? 'everything' : rangeLabel}{data.view.rankBy === 'minutes' ? ', ranked by minutes listened' : ''}</p>
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
	<section class="sleeves">
		{#each sleeves as s (s.kind)}
			<a class="sleeve" href={s.href ?? undefined} class:none={!s.item}>
				<div class="art"><Cover src={s.item?.image} alt={s.item?.name ?? s.kind} size={480} round={s.round} /></div>
				<div class="meta">
					<span class="kind">{s.kind}</span>
					<span class="name">{s.item?.name ?? 'Nothing yet'}</span>
					{#if s.item?.artist}<span class="by">{s.item.artist}</span>{/if}
					{#if s.item}
						<span class="count"><span class="big">{fmt(value(s.item))}</span> {unit}</span>
						<span class="by">{rankBy === 'minutes' ? `${fmt(s.item.plays)} plays` : `${fmt(minutes(s.item.ms))} minutes`}</span>
					{/if}
				</div>
			</a>
		{/each}
	</section>

	<dl class="totals">
		<div><dt>Plays</dt><dd>{fmt(data.totals.plays)}</dd></div>
		<div><dt>Minutes</dt><dd>{fmt(minutes(data.totals.ms))}</dd></div>
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
				<BarList items={data.genres.rows.map((g) => ({ ...g, name: g.name }))} {rankBy} covers={false} />
			{:else}
				<p class="muted">Genres appear once artists have been looked up. That runs in the background after an import or sync.</p>
			{/if}
		</section>
		<section class="panel">
			<h2>When you listen</h2>
			<Heatmap grid={data.series.grid} />
		</section>
	</div>

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

	/* The three record sleeves are the one loud thing on the page. */
	.sleeves {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-bottom: 20px;
	}
	.sleeve {
		position: relative;
		display: block;
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		text-decoration: none;
		background: var(--surface);
	}
	.sleeve .art,
	.sleeve .art :global(.cover) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border-radius: 0;
		font-size: 5rem;
	}
	.sleeve .meta {
		position: absolute;
		inset: auto 0 0 0;
		padding: 48px 18px 16px;
		background: linear-gradient(transparent, rgba(10, 8, 14, 0.92) 55%);
		display: grid;
		gap: 1px;
	}
	.kind {
		font-size: 0.8rem;
		color: var(--ink-2);
	}
	.name {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.by {
		color: var(--ink-2);
		font-size: 0.85rem;
	}
	.count {
		margin-top: 8px;
		color: var(--ink-2);
	}
	.big {
		font-size: 3.2rem;
		font-weight: 800;
		font-stretch: 62%;
		color: var(--ink);
		line-height: 0.9;
		letter-spacing: -0.01em;
	}
	.sleeve:hover .name {
		text-decoration: underline;
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
		.grid2,
		.sleeves {
			grid-template-columns: 1fr;
		}
		.sleeve {
			aspect-ratio: 4 / 3;
		}
	}
</style>
