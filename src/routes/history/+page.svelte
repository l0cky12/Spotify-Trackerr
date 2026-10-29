<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
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

	// Search-as-you-type: picking a suggestion filters the list to that song, artist or album.
	type Hit = { id: number; name: string; sub: string | null; image: string | null; plays: number };
	const GROUPS = [
		['tracks', 'track', 'Songs'],
		['artists', 'artist', 'Artists'],
		['albums', 'album', 'Albums']
	] as const;
	let query = $derived(data.search);
	let results = $state<Record<'tracks' | 'artists' | 'albums', Hit[]> | null>(null);
	let open = $state(false);
	let active = $state(-1);
	let timer: ReturnType<typeof setTimeout>;
	let seq = 0;
	const hits = $derived(
		results
			? GROUPS.flatMap(([key, kind, heading]) =>
					results![key].map((h, i) => ({
						...h,
						kind,
						heading: i === 0 ? heading : null,
						href: withParams({ track: null, album: null, artist: null, month: null, q: null, before: null, date: null, [kind]: String(h.id) })
					}))
				)
			: []
	);

	function suggest() {
		clearTimeout(timer);
		const q = query.trim();
		const mine = ++seq;
		if (!q) return (results = null);
		timer = setTimeout(async () => {
			const params = new URLSearchParams({ q });
			for (const k of ['user', 'range']) if (page.url.searchParams.get(k)) params.set(k, page.url.searchParams.get(k)!);
			const res = await fetch(`/api/search?${params}`).catch(() => null);
			const body = res?.ok ? await res.json() : null;
			if (mine !== seq) return; // a newer keystroke already asked again
			results = body;
			active = -1;
			open = true;
		}, 120);
	}

	function pick() {
		open = false;
		query = '';
		results = null;
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
		if (!open || !hits.length) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (e.key === 'ArrowDown') active = (active + 1) % hits.length;
			else active = active <= 0 ? hits.length - 1 : active - 1;
			document.getElementById(`hit-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && active >= 0) {
			e.preventDefault();
			goto(hits[active].href);
			pick();
		}
	}
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
	<div class="grow combo">
		<label for="q">Search songs, artists and albums</label>
		<input
			id="q"
			name="q"
			type="search"
			autocomplete="off"
			role="combobox"
			aria-autocomplete="list"
			aria-controls="suggestions"
			aria-expanded={open && !!results}
			aria-activedescendant={active >= 0 ? `hit-${active}` : undefined}
			bind:value={query}
			oninput={suggest}
			onkeydown={keys}
			onfocus={() => (open = true)}
			onblur={() => (open = false)}
		/>
		{#if open && results}
			<!-- mousedown would blur the input and close the list before the click lands -->
			<ul id="suggestions" role="listbox" aria-label="Suggestions" onmousedown={(e) => e.preventDefault()}>
				{#each hits as h, i (h.kind + h.id)}
					{#if h.heading}<li class="heading" role="presentation">{h.heading}</li>{/if}
					<li id="hit-{i}" role="option" aria-selected={i === active}>
						<a href={h.href} tabindex="-1" onclick={pick} onmouseenter={() => (active = i)}>
							<Cover src={h.image} alt={h.name} size={32} round={h.kind === 'artist'} />
							<span class="what">
								<span>{h.name}</span>
								{#if h.sub}<small>{h.sub}</small>{/if}
							</span>
							<small>{fmt(h.plays)} plays</small>
						</a>
					</li>
				{:else}
					<li class="heading" role="presentation">Nothing played matches “{query.trim()}”</li>
				{/each}
			</ul>
		{/if}
	</div>
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
	.combo {
		position: relative;
		display: grid;
		gap: 4px;
		font-size: 0.9rem;
	}
	[role='listbox'] {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 4;
		margin: 4px 0 0;
		padding: 6px;
		list-style: none;
		background: var(--surface-3);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		max-height: 420px;
		overflow-y: auto;
	}
	.heading {
		font-size: 0.75rem;
		color: var(--muted);
		padding: 8px 8px 4px;
	}
	[role='option'] a {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 5px 8px;
		border-radius: 6px;
		color: var(--ink);
		text-decoration: none;
	}
	[role='option'][aria-selected='true'] a {
		background: var(--surface-2);
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
