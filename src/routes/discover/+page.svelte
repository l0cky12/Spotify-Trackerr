<script lang="ts">
	import { enhance } from '$app/forms';
	import Cover from '#lib/components/Cover.svelte';
	import { formatWhen } from '#lib/time.js';
	import { u } from '#lib/nav.js';
	import { page } from '$app/state';
	let { data, form } = $props();
	let busy = $state(false);
	// Shelves scroll sideways; "See all" wraps one into a grid.
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
	type Pick = (typeof shelves)[number]['items'][number];
	const name = (r: Pick) => r.title ?? r.album ?? r.artist;
	const local = (r: Pick) => (r.trackId ? `/track/${r.trackId}` : r.albumId ? `/album/${r.albumId}` : !r.title && !r.album && r.artistId ? `/artist/${r.artistId}` : null);
</script>

<h1>Discover</h1>
<p class="muted lede">
	Artists, albums and songs you haven't played yet, picked by Last.fm from
	{data.lastfmUser ? 'your Last.fm top artists and songs' : "what you've played most"} in the last month.
</p>

{#if !data.enabled}
	<section class="panel">
		<p>Discover needs Last.fm. The admin can add <code>LASTFM_API_KEY</code> to the server settings; a free app at last.fm/api provides one.</p>
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
		<span class="muted small">
			{#if data.lastfmUser}Using Last.fm account <b>{data.lastfmUser}</b>{:else}<a href="/settings?section=lastfm">Sign in with Last.fm</a> for picks from everything you scrobble{/if}
			{#if data.picks}· Updated {formatWhen(data.picks.at, page.data.me.tz)}{/if}
		</span>
	</div>
	{#if form?.error}<p class="error">{form.error}</p>{/if}

	{#each shelves as s (s.id)}
		<section class="panel">
			<h2>
				{s.title}
				<small>
					{s.items.length} picks
					{#if s.items.length > 6}· <button class="link" onclick={() => (open[s.id] = !open[s.id])}>{open[s.id] ? 'Show less' : 'See all'}</button>{/if}
				</small>
			</h2>
			{#if s.items.length}
				<ul class="shelf" class:all={open[s.id]}>
					{#each s.items as r, i (i)}
						{@const href = local(r)}
						<li class:round={s.round}>
							<a href={href ? u(href) : r.url} target={href ? undefined : '_blank'} rel={href ? undefined : 'noopener'}>
								<Cover src={r.image} alt={name(r)} size={140} round={s.round} />
								<span class="name" title={name(r)}>{name(r)}</span>
							</a>
							<span class="sub">{s.round ? `Like ${r.why}` : r.artist}</span>
						</li>
					{/each}
				</ul>
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
	button.link {
		background: none;
		padding: 0;
		color: inherit;
		font-size: inherit;
		text-decoration: underline;
		text-decoration-color: var(--axis);
		text-underline-offset: 3px;
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
	code {
		background: var(--surface-2);
		padding: 1px 5px;
		border-radius: 4px;
	}
</style>
