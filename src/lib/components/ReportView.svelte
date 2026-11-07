<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PublicReport, PublicRow } from '#lib/server/shares.js';
	import type { Change } from '#lib/server/stats.js';
	import BarList from './BarList.svelte';
	import CoverGrid from './CoverGrid.svelte';
	import Columns from './Columns.svelte';
	import Cover from './Cover.svelte';
	import { u, fmt, listened } from '#lib/nav.js';
	import { scrollRow } from '#lib/scroll-row.js';

	// One Report, laid out the same for its owner (/reports) and for friends with its link (/share/…).
	// `linked` turns names into links into this server, which only signed-in people can follow.
	let {
		report,
		rankBy = 'plays',
		linked = true,
		title,
		eyebrow,
		actions,
		below
	}: { report: PublicReport; rankBy?: 'plays' | 'minutes'; linked?: boolean; title?: string; eyebrow: string; actions?: Snippet; below?: Snippet } = $props();

	const r = $derived(report);
	const href = (path: string) => (linked ? u(path) : undefined);
	const list = (rows: PublicRow[], kind: string) =>
		rows.map((row) => ({ ...row, href: row.id ? href(`/${kind}/${row.id}`) : undefined, sub: row.artist, subHref: row.artist_id ? href(`/artist/${row.artist_id}`) : undefined }));
	const change = ({ pct, diff }: Change) =>
		pct === null
			? { label: diff ? 'New' : 'Same', dir: diff > 0 ? 'up' : 'flat' }
			: { label: `${pct > 0 ? '+' : ''}${fmt(pct)}%`, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
	// While the period is under way its totals are compared with the same stretch of the one before.
	const vs = $derived(r.period.partial ? `vs this point in ${r.period.prev.label}` : `vs ${r.period.prev.label}`);
	const stats = $derived([
		{ k: 'Plays', n: r.totals.plays, d: r.delta.plays, show: fmt },
		{ k: 'Time listened', n: r.totals.ms, d: r.delta.ms, show: listened },
		{ k: 'Songs', n: r.totals.tracks, d: r.delta.tracks, show: fmt },
		{ k: 'Artists', n: r.totals.artists, d: r.delta.artists, show: fmt },
		{ k: 'New artists', n: r.totals.newArtists, d: r.delta.newArtists, show: fmt }
	]);
	// The hero's artwork: the top albums' covers, falling back to songs when albums have none.
	const mosaic = $derived([...r.albums, ...r.tracks].map((row) => row.image).filter((src, i, all): src is string => !!src && all.indexOf(src) === i).slice(0, 4));
	const backdrop = $derived(r.artists[0]?.image ?? mosaic[0] ?? null);
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const HOURS = Array.from({ length: 24 }, (_, h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`);
	const peak = (values: number[]) => values.indexOf(Math.max(...values));
	const artists = $derived(list(r.artists, 'artist'));
</script>

<header class="hero" class:has-art={!!backdrop}>
	{#if backdrop}<div class="backdrop" style:background-image="url({JSON.stringify(backdrop)})" aria-hidden="true"></div>{/if}
	<div class="hero-text">
		<p class="eyebrow">{eyebrow}{r.period.partial ? ' · so far' : ''}</p>
		<h1>{title ?? r.period.label}</h1>
		{#if r.totals.plays}
			<p class="lede">
				<strong>{fmt(r.totals.plays)}</strong> plays, <strong>{listened(r.totals.ms)}</strong> of music and
				<strong>{fmt(r.totals.artists)}</strong> artists{#if r.artists[0]}, with <strong>{r.artists[0].name}</strong> on top{/if}.
			</p>
		{/if}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{#if mosaic.length >= 4}
		<div class="mosaic" aria-hidden="true">
			{#each mosaic as src (src)}<img {src} alt="" loading="lazy" />{/each}
		</div>
	{/if}
</header>

{@render below?.()}

{#if !r.totals.plays}
	<p class="empty muted">No plays in {r.period.label}.</p>
{:else}
	<dl class="stats">
		{#each stats as s (s.k)}
			{@const c = change(s.d)}
			<div class="stat">
				<dt>{s.k}</dt>
				<dd>{s.show(s.n)}</dd>
				<dd class="delta {c.dir}" title="{r.period.prev.label}{r.period.partial ? ' at this point' : ''}: {s.show(s.n - s.d.diff)}">
					<span class="pill">{#if c.dir === 'up'}▲{:else if c.dir === 'down'}▼{/if} {c.label}</span>
					<span class="vs">{vs}</span>
				</dd>
			</div>
		{/each}
		{#if r.busiest}
			<div class="stat">
				<dt>Busiest day</dt>
				<dd class="day">{r.busiest.label}</dd>
				<dd class="delta"><span class="pill">{fmt(r.busiest.plays)} plays</span><span class="vs">{listened(r.busiest.ms)} that day</span></dd>
			</div>
		{/if}
	</dl>

	<section class="panel">
		<h2>Plays over {r.period.m === null ? 'the year' : 'the month'} <small>{r.period.prev.label} alongside</small></h2>
		<Columns labels={r.series.labels} values={r.series.cur} prev={r.series.prev} name={r.period.label} prevName={r.period.prev.label} />
	</section>

	<section class="panel artists">
		<h2>Top artists <small>{fmt(r.totals.artists)} in all</small></h2>
		<div class="podium" {@attach scrollRow()}><CoverGrid items={artists.slice(0, 5)} sort={rankBy} round min={100} /></div>
		{#if artists.length > 5}
			<ol class="runners" start="6">
				{#each artists.slice(5) as a, i (i)}
					<li>
						<span class="rank">{i + 6}</span>
						<Cover src={a.image} alt={a.name} size={40} round />
						<span class="who">
							{#if a.href}<a href={a.href}>{a.name}</a>{:else}<span>{a.name}</span>{/if}
							<small>{rankBy === 'minutes' ? listened(a.ms) : `${fmt(a.plays)} plays`}</small>
						</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<div class="pair">
		<section class="panel"><h2>Top songs <small>{fmt(r.totals.tracks)} in all</small></h2><BarList items={list(r.tracks, 'track')} {rankBy} /></section>
		<section class="panel"><h2>Top albums</h2><BarList items={list(r.albums, 'album')} {rankBy} /></section>
	</div>

	<div class="pair">
		<section class="panel">
			<h2>Days of the week <small>most on {WEEKDAYS[peak(r.weekdays)]}</small></h2>
			<Columns labels={WEEKDAYS} values={r.weekdays} height={170} name="Plays" />
		</section>
		<section class="panel">
			<h2>Hours of the day <small>peak around {HOURS[peak(r.hours)]}</small></h2>
			<Columns labels={HOURS} values={r.hours} height={170} name="Plays" />
		</section>
	</div>

	<div class="pair">
		<section class="panel">
			<h2>Top genres</h2>
			{#if r.genres.length}
				<BarList items={r.genres.map((g) => ({ ...g, href: href(`/genre/${encodeURIComponent(g.name)}`) }))} {rankBy} covers={false} />
			{:else}
				<p class="muted">No genre data for this period yet.</p>
			{/if}
		</section>
		<section class="panel">
			<h2>New to you <small>{fmt(r.totals.newArtists)} first played in {r.period.label}{#if r.totals.newArtists > r.newArtists.length}, top {r.newArtists.length}{/if}</small></h2>
			{#if r.newArtists.length}
				<BarList items={list(r.newArtists, 'artist')} {rankBy} round />
			{:else}
				<p class="muted">No new artists this period.</p>
			{/if}
		</section>
	</div>
{/if}

<style>
	.hero {
		position: relative;
		overflow: hidden;
		isolation: isolate;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 32px;
		padding: 40px 44px;
		margin-bottom: 20px;
		border-radius: 20px;
		border: 1px solid var(--border);
		background:
			radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--series-7) 38%, transparent), transparent 60%),
			radial-gradient(100% 120% at 100% 100%, color-mix(in srgb, var(--series-1) 30%, transparent), transparent 55%),
			var(--surface);
	}
	.backdrop {
		position: absolute;
		inset: -60px;
		z-index: -1;
		background-size: cover;
		background-position: center;
		filter: blur(56px) saturate(1.6);
		opacity: 0.7;
	}
	/* Darkest behind the words, so the art shows on the right without costing contrast. */
	.has-art::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(90deg, color-mix(in srgb, var(--page) 72%, transparent) 30%, color-mix(in srgb, var(--page) 15%, transparent));
	}
	.hero-text {
		min-width: 0;
		max-width: 640px;
	}
	.eyebrow {
		margin: 0 0 8px;
		color: var(--ink-2);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h1 {
		font-size: clamp(2.6rem, 7vw, 4.6rem);
		font-weight: 800;
		font-stretch: 68%;
		letter-spacing: -0.02em;
		line-height: 0.95;
		text-wrap: balance;
	}
	.lede {
		margin: 14px 0 0;
		font-size: 1.05rem;
		color: var(--ink-2);
		text-wrap: pretty;
	}
	.lede strong {
		color: var(--ink);
		font-weight: 650;
	}
	.actions {
		margin-top: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.mosaic {
		flex: none;
		display: grid;
		grid-template-columns: repeat(2, 96px);
		gap: 8px;
		transform: rotate(4deg);
	}
	.mosaic img {
		width: 96px;
		height: 96px;
		object-fit: cover;
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
	}
	.empty {
		padding: 24px 4px;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
		margin: 0 0 20px;
	}
	.stat {
		display: grid;
		align-content: start;
		gap: 2px;
		padding: 16px 18px;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	dt {
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	dd {
		margin: 0;
		font-size: 1.9rem;
		font-weight: 750;
		font-stretch: 78%;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
	}
	dd.day {
		font-size: 1.35rem;
		line-height: 1.6;
	}
	dd.delta {
		margin-top: 6px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 6px;
		align-items: center;
		font-size: 0.8rem;
		font-weight: 400;
		font-stretch: 100%;
		line-height: 1.4;
	}
	.pill {
		padding: 1px 8px;
		border-radius: 999px;
		font-weight: 650;
		background: var(--surface-2);
		color: var(--ink-2);
	}
	.up .pill {
		background: color-mix(in srgb, var(--good) 22%, transparent);
		color: #6bdc6b;
	}
	.down .pill {
		background: color-mix(in srgb, var(--critical) 20%, transparent);
		color: #f09a9a;
	}
	.vs {
		color: var(--muted);
	}
	.panel {
		margin-bottom: 20px;
		border-radius: 16px;
		border: 1px solid var(--border);
		padding: 20px 22px;
	}
	.panel > h2 {
		font-size: 1.15rem;
	}
	/* The top five large, the next five as a compact row beneath. */
	.podium :global(.grid) {
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 16px 18px;
	}
	.runners {
		list-style: none;
		margin: 20px 0 0;
		padding: 16px 0 0;
		border-top: 1px solid var(--grid);
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 12px 18px;
	}
	.runners li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.runners .rank {
		width: 1.2rem;
		text-align: right;
		color: var(--muted);
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	.who {
		display: grid;
		min-width: 0;
	}
	.who > a,
	.who > span,
	.who small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who > a,
	.who > span {
		font-weight: 600;
		text-decoration: none;
	}
	.who small {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		margin-bottom: 20px;
	}
	.pair .panel {
		margin-bottom: 0;
	}
	@media (max-width: 1000px) {
		.runners {
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		}
	}
	@media (max-width: 860px) {
		.pair {
			grid-template-columns: 1fr;
		}
		.hero {
			flex-direction: column-reverse;
			align-items: start;
			gap: 20px;
			padding: 24px 20px 26px;
		}
		.has-art::after {
			background: linear-gradient(180deg, color-mix(in srgb, var(--page) 20%, transparent), color-mix(in srgb, var(--page) 70%, transparent) 45%);
		}
		.mosaic {
			grid-template-columns: repeat(4, 60px);
			gap: 6px;
			transform: none;
		}
		.mosaic img {
			width: 60px;
			height: 60px;
			border-radius: 6px;
		}
		/* Five large covers would be tiny side by side; let them scroll sideways instead. */
		.podium {
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			margin: 0 -22px;
			padding: 0 22px 4px;
		}
		.podium :global(.grid) {
			grid-template-columns: repeat(5, 136px);
		}
		.podium :global(.grid li) {
			scroll-snap-align: start;
		}
		.podium:global(.more-right) {
			mask-image: linear-gradient(to right, #000 calc(100% - 56px), transparent);
		}
		.podium:global(.more-left) {
			mask-image: linear-gradient(to right, transparent, #000 56px);
		}
		.podium:global(.more-left.more-right) {
			mask-image: linear-gradient(to right, transparent, #000 56px, #000 calc(100% - 56px), transparent);
		}
	}
</style>
