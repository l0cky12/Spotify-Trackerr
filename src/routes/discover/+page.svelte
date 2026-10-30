<script lang="ts">
	import { enhance } from '$app/forms';
	import Cover from '#lib/components/Cover.svelte';
	import { formatWhen } from '#lib/time.js';
	import { u } from '#lib/nav.js';
	import { page } from '$app/state';
	let { data, form } = $props();
	let busy = $state(false);
	// A shelf shows its first 10 picks; "See more" opens it into a grid of all of them, "See all" opens every shelf.
	const SHOWN = 10;
	let open = $state<Record<string, boolean>>({});

	const shelves = $derived(
		data.picks
			? [
					{ id: 'artists', title: 'Artists', round: true, items: data.picks.artists },
					{ id: 'albums', title: 'Albums', round: false, items: data.picks.albums },
					{ id: 'songs', title: 'Songs', round: false, items: data.picks.songs }
				]
			: []
	);
	const long = $derived(shelves.filter((s) => s.items.length > SHOWN));
	const allOpen = $derived(long.every((s) => open[s.id]));
	const toggleAll = () => {
		const to = !allOpen;
		for (const s of long) open[s.id] = to;
	};
	type Pick = (typeof shelves)[number]['items'][number];
	const name = (r: Pick) => r.title ?? r.album ?? r.artist;
	// Albums and artists are like a seed artist; songs are like a seed song, named in full on hover.
	const like = (r: Pick) => `Like ${r.why}${r.whyBy ? ` by ${r.whyBy}` : ''}`;
	const local = (r: Pick) => (r.trackId ? `/track/${r.trackId}` : r.albumId ? `/album/${r.albumId}` : !r.title && !r.album && r.artistId ? `/artist/${r.artistId}` : null);
</script>

<h1>Discover</h1>
<p class="muted lede">
	Artists, albums and songs you haven't played yet, picked by Last.fm from
	{data.lastfmUser ? 'your Last.fm top artists and songs' : data.listenbrainzUser ? 'your ListenBrainz top artists and songs' : "what you've played most"} in the last month.
</p>

{#if !data.enabled}
	<section class="panel">
		<p>Discover needs Last.fm, which isn't turned on for this server yet. An admin can turn it on in <a href="/settings?section=lastfm">Settings → Last.fm</a>.</p>
	</section>
{:else}
	<div class="actions">
		<form
			method="POST"
			action="?/refresh"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<button disabled={busy}>{busy ? 'Finding new music…' : data.picks ? 'Refresh picks' : 'Find new music'}</button>
		</form>
		{#if long.length}<button class="secondary" aria-expanded={allOpen} onclick={toggleAll}>{allOpen ? 'Show less' : 'See all'}</button>{/if}
		<span class="muted small">
			{#if data.lastfmUser}Using Last.fm account <b>{data.lastfmUser}</b>{:else if data.listenbrainzUser}Using ListenBrainz account <b>{data.listenbrainzUser}</b>{:else}Sign in with <a href="/settings?section=lastfm">Last.fm</a> or <a href="/settings?section=listenbrainz">ListenBrainz</a> for picks from everything you listen to{/if}
			{#if data.picks}· Updated {formatWhen(data.picks.at, page.data.me.tz)}{/if}
			{#if data.checking}· Still looking up featured artists on {data.checking.toLocaleString()} songs, so a few artists you've heard on someone else's song may slip through until then{/if}
		</span>
	</div>
	{#if form?.error}<p class="error">{form.error}</p>{/if}

	{#each shelves as s (s.id)}
		<section class="panel">
			<h2>
				{s.title}
				<small>{s.items.length} picks</small>
			</h2>
			{#if s.items.length}
				<ul class="shelf" class:all={open[s.id]} id="shelf-{s.id}">
					{#each open[s.id] ? s.items : s.items.slice(0, SHOWN) as r, i (i)}
						{@const href = local(r)}
						<li class:round={s.round}>
							<a href={href ? u(href) : r.url} target={href ? undefined : '_blank'} rel={href ? undefined : 'noopener'}>
								<Cover src={r.image} alt={name(r)} size={140} round={s.round} />
								<span class="name" title={name(r)}>{name(r)}</span>
							</a>
							{#if !s.round}<span class="sub">{r.artist}</span>{/if}
							{#if r.why}<span class="sub" title={like(r)}>Like {r.why}</span>{/if}
						</li>
					{/each}
				</ul>
				{#if s.items.length > SHOWN}
					<button class="secondary more" aria-expanded={!!open[s.id]} aria-controls="shelf-{s.id}" onclick={() => (open[s.id] = !open[s.id])}>
						{open[s.id] ? 'Show less' : `See ${s.items.length - SHOWN} more`}
					</button>
				{/if}
			{:else}
				<p class="muted">No new {s.title.toLowerCase()} this time.</p>
			{/if}
		</section>
	{/each}
{/if}

<style>
	.lede {
		margin: 6px 0 20px;
		max-width: 60ch;
	}
	.actions {
		display: flex;
		gap: 14px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.small {
		font-size: 0.82rem;
	}
	.panel {
		margin-bottom: 16px;
	}
	.more {
		display: block;
		width: 100%;
		margin-top: 12px;
	}
	.shelf {
		list-style: none;
		margin: 0;
		padding: 0 0 6px;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 140px;
		gap: 18px;
		overflow-x: auto;
	}
	.shelf.all {
		grid-auto-flow: row;
		grid-template-columns: repeat(auto-fill, 140px);
		overflow: visible;
	}
	li {
		min-width: 0;
	}
	li a {
		display: grid;
		gap: 8px;
		text-decoration: none;
	}
	.name,
	.sub {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.name {
		font-weight: 600;
		font-size: 0.9rem;
	}
	a:hover .name {
		text-decoration: underline;
	}
	.sub {
		font-size: 0.8rem;
		color: var(--ink-2);
	}
	.round {
		text-align: center;
	}
</style>
