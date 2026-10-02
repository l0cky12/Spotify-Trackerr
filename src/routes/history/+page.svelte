<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Cover from '#lib/components/Cover.svelte';
	import RangePicker from '#lib/components/RangePicker.svelte';
	import { u, fmt, withParams } from '#lib/nav.js';
	import { formatWhen, formatDate, monthName } from '#lib/time.js';

	let { data } = $props();
	const keep = ['user', 'track', 'album', 'artist', 'month', 'range'];
	const hidden = $derived(keep.filter((k) => page.url.searchParams.get(k)).map((k) => [k, page.url.searchParams.get(k)!]));
	const monthLabel = $derived(data.month ? `${monthName(Number(data.month.slice(5)) - 1)} ${data.month.slice(0, 4)}` : null);
	const dayOf = (ts: number) => formatDate(ts, data.view.tz);
	const summary = $derived(
		[`${fmt(data.total)} plays`, data.filterName && `of ${data.filterName}`, monthLabel && `in ${monthLabel}`, data.search && `matching “${data.search}”`].filter(Boolean).join(' ')
	);
	// Keep the current filters when posting, so the list reloads as it was.
	const deleteAction = $derived(page.url.search ? `${page.url.search}&/delete` : '?/delete');
</script>

<div class="head">
	<div>
		<h1>History</h1>
		<p class="muted">
			{summary}
			{#if data.filterName || data.month}<a href={withParams({ track: null, album: null, artist: null, month: null, before: null })}>Clear filter</a>{/if}
		</p>
	</div>
	<RangePicker value={data.range} />
</div>

<form class="tools" method="GET">
	{#each hidden as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
	<label class="grow">Search songs, artists and albums <input name="q" type="search" value={data.search} /></label>
	<label>Jump to date <input name="date" type="date" /></label>
	<button>Go</button>
</form>

<ol class="plays">
	{#each data.plays as p, i (p.id)}
		{#if i === 0 || dayOf(p.played_at) !== dayOf(data.plays[i - 1].played_at)}
			<li class="day">{dayOf(p.played_at)}</li>
		{/if}
		<li class="play">
			<Cover src={p.image} alt={p.album ?? p.track} size={40} />
			<span class="what">
				<a href={u(`/track/${p.track_id}`)}>{p.track}</a>
				<small>
					<a href={u(`/artist/${p.artist_id}`)}>{p.artist}</a>{#if p.album_id}, <a href={u(`/album/${p.album_id}`)}>{p.album}</a>{/if}
				</small>
			</span>
			<time datetime={new Date(p.played_at * 1000).toISOString()} title={formatWhen(p.played_at, data.view.tz)}>
				{new Date(p.played_at * 1000).toLocaleTimeString('en-US', { timeZone: data.view.tz, hour: 'numeric', minute: '2-digit' })}
			</time>
			<details class="menu">
				<summary aria-label="Options for this play">⋮</summary>
				<div class="pop">
					{#if p.spotify_id}<a href="https://open.spotify.com/track/{p.spotify_id}" target="_blank" rel="noopener">Open in Spotify</a>{/if}
					{#if !data.view.readonly}
						<form method="POST" action={deleteAction} use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class="danger">Delete this play</button>
						</form>
					{/if}
				</div>
			</details>
		</li>
	{:else}
		<li class="muted">No plays match.</li>
	{/each}
</ol>

<nav class="pager">
	{#if data.before}<a href={withParams({ before: null, date: null })}>Newest</a>{/if}
	{#if data.next}<a href={withParams({ before: String(data.next), date: null })}>Older plays</a>{/if}
</nav>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.head p {
		margin: 4px 0 0;
	}
	.head p a {
		margin-left: 8px;
	}
	.tools {
		display: flex;
		gap: 12px;
		align-items: end;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}
	.grow {
		flex: 1;
		min-width: 220px;
	}
	.plays {
		list-style: none;
		padding: 0;
		margin: 0;
		background: var(--surface);
		border-radius: 10px;
		padding: 6px 18px 12px;
	}
	.day {
		font-size: 0.8rem;
		color: var(--muted);
		padding: 14px 0 6px;
		border-bottom: 1px solid var(--grid);
	}
	.play {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 12px;
		align-items: center;
		padding: 7px 0;
	}
	.what {
		display: grid;
		min-width: 0;
	}
	.what > a,
	.what small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small {
		color: var(--ink-2);
	}
	time {
		color: var(--ink-2);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.menu {
		position: relative;
	}
	.menu summary {
		list-style: none;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: 4px;
		color: var(--muted);
	}
	.menu summary::-webkit-details-marker {
		display: none;
	}
	.menu summary:hover {
		background: var(--surface-2);
	}
	.pop {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: 3;
		background: var(--surface-3);
		border-radius: 8px;
		padding: 8px;
		display: grid;
		gap: 6px;
		min-width: 180px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.pop a {
		padding: 4px 6px;
	}
	.pop button {
		width: 100%;
		text-align: left;
	}
	.pager {
		display: flex;
		gap: 20px;
		margin-top: 16px;
	}
</style>
