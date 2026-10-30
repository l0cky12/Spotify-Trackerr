<script lang="ts">
	import { enhance } from '$app/forms';
	import Cover from '#lib/components/Cover.svelte';
	import { formatShowDate } from '#lib/time.js';

	let { data, form } = $props();
	const newCount = $derived(data.shows.filter((s) => !s.seen).length);
</script>

<div class="head">
	<h1>Shows</h1>
	<p class="muted">
		Watch the artists you'd go see, then let an AI assistant look for their concerts near you. It saves what it finds here, and new shows get a badge
		in the menu.
	</p>
</div>

{#if !data.hasKey}
	<p class="banner">
		No AI assistant is connected yet. <a href="/settings?section=mcp">Make an access key in Settings</a> and add this app as an MCP server in your
		assistant.
	</p>
{/if}

<div class="cols">
	<section class="panel shows">
		<h2>Upcoming shows {#if newCount}<small class="new-count">{newCount} new</small>{/if}</h2>
		{#if data.shows.length}
			<ul class="list">
				{#each data.shows as s (s.id)}
					<li class:fresh={!s.seen}>
						<Cover src={s.image} alt={s.artist} size={48} round />
						<div class="grow">
							<strong><a href="/artist/{s.artist_id}">{s.artist}</a></strong>
							{#if !s.seen}<span class="tag">New</span>{/if}
							<div>{formatShowDate(s.date)} · {s.venue}, {s.city}</div>
							{#if s.note}<small class="muted">{s.note}</small>{/if}
						</div>
						{#if s.url}<a class="button secondary small-btn" href={s.url} target="_blank" rel="noopener">Details</a>{/if}
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={s.id} />
							<button class="secondary small-btn" title="Remove this show">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else if data.watches.length}
			<p class="muted">No shows found yet. Ask your assistant to check for shows near you.</p>
		{:else}
			<p class="muted">Watch some artists first.</p>
		{/if}
	</section>

	<div class="side">
		<section class="panel">
			<h2>Home</h2>
			<form method="POST" action="?/home" use:enhance={() => ({ update }) => update({ reset: false })} class="stack">
				<label>Where you live <input name="location" value={data.home.location ?? ''} placeholder="City, state" maxlength="120" /></label>
				<label>How far you'd travel, in miles <input name="miles" type="number" min="1" max="3000" value={data.home.miles} required /></label>
				<button>Save</button>
				{#if form?.homeSaved}<p class="ok">Saved.</p>{/if}
				{#if form?.homeError}<p class="error">{form.homeError}</p>{/if}
			</form>
			<p class="muted small">Only you and your assistant can see this.</p>
		</section>

		<section class="panel">
			<h2>Watching <small>{data.watches.length} artists</small></h2>
			{#if data.suggestions.length}
				<form method="POST" action="?/watch" use:enhance class="row">
					<label class="grow">
						Add one of your top artists
						<select name="id" required>
							{#each data.suggestions as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
						</select>
					</label>
					<button>Watch</button>
				</form>
			{/if}
			{#if form?.watchError}<p class="error">{form.watchError}</p>{/if}
			<p class="muted small">You can also choose <strong>Watch for shows</strong> on any artist's page, or ask your assistant to watch an artist.</p>
			{#if data.watches.length}
				<ul class="list">
					{#each data.watches as w (w.id)}
						<li>
							<Cover src={w.image} alt={w.name} size={36} round />
							<a class="grow" href="/artist/{w.id}">{w.name}</a>
							<form method="POST" action="?/unwatch" use:enhance>
								<input type="hidden" name="id" value={w.id} />
								<button class="secondary small-btn">Stop watching</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	.head {
		margin-bottom: 20px;
	}
	.head p {
		max-width: 70ch;
		margin: 6px 0 0;
	}
	.banner {
		background: #1f2a3d;
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 0.9rem;
		margin-bottom: 20px;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
		gap: 20px;
		align-items: start;
	}
	.side {
		display: grid;
		gap: 20px;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 12px 0 0;
		display: grid;
	}
	.list li {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid var(--grid);
	}
	.shows li {
		padding: 10px 0;
	}
	.fresh {
		box-shadow: inset 3px 0 0 var(--series-1);
		padding-left: 10px !important;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.tag {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--series-1);
		color: var(--page);
		border-radius: 4px;
		padding: 1px 5px;
		margin-left: 6px;
	}
	.new-count {
		color: var(--series-1) !important;
		font-weight: 600 !important;
	}
	.stack {
		display: grid;
		gap: 12px;
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: end;
		margin-bottom: 8px;
	}
	.row select {
		width: 100%;
	}
	.small {
		font-size: 0.85rem;
		margin: 10px 0 0;
	}
	.small-btn {
		padding: 3px 9px;
		font-size: 0.8rem;
	}
	@media (max-width: 860px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
