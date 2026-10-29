<script lang="ts">
	import { enhance } from '$app/forms';
	import Cover from '#lib/components/Cover.svelte';
	import { fmt } from '#lib/nav.js';

	let { data, form } = $props();
	// One template is open for editing at a time: an existing id, 'new', or nothing.
	let editing = $state<number | 'new' | null>(null);
	let kind = $state('top');
	let busy = $state<number | null>(null);
	$effect(() => {
		if (form?.saved) editing = null;
		if (form?.editing !== undefined) editing = form.editing as number | 'new';
	});
	const kindLabel = (id: string) => data.kinds.find((k) => k.id === id)?.label ?? id;
	const periodLabel = (p?: string) => (!p || p === 'all' ? 'all time' : (data.months.find((m) => m.id === p)?.label ?? p));
	const describe = (t: (typeof data.templates)[number]) =>
		t.kind === 'top'
			? `Top ${t.params.n} songs of ${periodLabel(t.params.period)}`
			: t.kind === 'artist_first'
				? `${data.artists.find((a) => a.id === t.params.artistId)?.name ?? 'An artist'}, songs first heard in ${t.params.year}, up to ${t.params.n}`
				: `Up to ${t.params.n} songs from this day in earlier years`;
	function open(t: (typeof data.templates)[number] | null) {
		editing = t ? t.id : 'new';
		kind = t?.kind ?? 'top';
	}
</script>

<div class="head">
	<div>
		<h1>Playlists</h1>
		<p class="muted">Templates that turn your own play history into Spotify playlists. Save one, preview it, then create it on your account.</p>
	</div>
	<button onclick={() => open(null)}>New template</button>
</div>

{#if !data.spotify.linked}
	<p class="banner">Creating playlists needs Spotify linked. <a href="/settings?section=spotify">Link Spotify in Settings</a>. You can still save and preview templates.</p>
{/if}
{#if form?.error && form.createId === undefined && form.editing === undefined}<p class="error">{form.error}</p>{/if}

{#if editing === 'new'}
	{@render editor(null)}
{/if}

<ul class="templates">
	{#each data.templates as t (t.id)}
		<li class="panel">
			{#if editing === t.id}
				{@render editor(t)}
			{:else}
				<div class="row">
					<div class="grow">
						<strong>{t.name}</strong>
						<p class="muted small">{kindLabel(t.kind)} · {describe(t)}</p>
						{#if t.last_playlist_url}<p class="small"><a href={t.last_playlist_url} target="_blank" rel="noopener">Open the last playlist made from this</a></p>{/if}
					</div>
					<div class="actions">
						<form method="POST" action="?/preview" use:enhance><input type="hidden" name="id" value={t.id} /><button class="secondary">Preview</button></form>
						<form
							method="POST"
							action="?/create"
							use:enhance={() => {
								busy = t.id;
								return async ({ update }) => {
									await update();
									busy = null;
								};
							}}
						>
							<input type="hidden" name="id" value={t.id} />
							<button disabled={!data.spotify.linked || busy === t.id}>{busy === t.id ? 'Creating…' : 'Create on Spotify'}</button>
						</form>
						<button class="secondary" onclick={() => open(t)}>Edit</button>
						<form method="POST" action="?/delete" use:enhance><input type="hidden" name="id" value={t.id} /><button class="danger">Delete</button></form>
					</div>
				</div>
				{#if form?.createId === t.id && form.error}<p class="error">{form.error}</p>{/if}
				{#if form?.created?.id === t.id}
					<p class="ok">
						Created with {fmt(form.created.added)} songs. <a href={form.created.url} target="_blank" rel="noopener">Open in Spotify</a>
						{#if form.created.skipped}<span class="muted">({fmt(form.created.skipped)} skipped: no Spotify id yet)</span>{/if}
					</p>
				{/if}
				{#if form?.preview?.id === t.id}
					<div class="preview">
						<h3>{form.preview.title} <small>{fmt(form.preview.picks.length)} songs</small></h3>
						{#if form.preview.picks.length}
							<ol>
								{#each form.preview.picks as p (p.id)}
									<li class:missing={!p.spotify_id} title={p.spotify_id ? '' : 'No Spotify id yet; will be skipped'}>
										<Cover src={p.image} alt={p.name} size={28} />
										<span class="what"><a href="/track/{p.id}">{p.name}</a><small>{p.artist}{p.note ? ` · ${p.note}` : ''}</small></span>
										<small>{fmt(p.plays)} plays</small>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="muted">Nothing matches yet.</p>
						{/if}
					</div>
				{/if}
			{/if}
		</li>
	{:else}
		{#if editing !== 'new'}<li class="muted">No templates yet. Start with “Top songs of a period”.</li>{/if}
	{/each}
</ul>

{#snippet editor(t: (typeof data.templates)[number] | null)}
	<form method="POST" action="?/save" use:enhance class="panel editor stack">
		{#if t}<input type="hidden" name="id" value={t.id} />{/if}
		<h2>{t ? 'Edit template' : 'New template'}</h2>
		<label>Name <input name="name" value={t?.name ?? ''} maxlength="80" required /></label>
		<label>
			Type
			<select name="kind" bind:value={kind}>
				{#each data.kinds as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
			</select>
			<small class="muted">{data.kinds.find((k) => k.id === kind)?.blurb}</small>
		</label>
		{#if kind === 'top'}
			<label>
				Period
				<select name="period" value={t?.params.period ?? 'all'}>
					<option value="all">All time</option>
					{#each data.years as y (y)}<option value={String(y)}>{y}</option>{/each}
					{#each data.months as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
				</select>
			</label>
		{:else if kind === 'artist_first'}
			<label>
				Artist
				<select name="artist" value={t?.params.artistId ?? ''} required>
					<option value="" disabled>Pick an artist</option>
					{#each data.artists as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
			</label>
			<label>
				First heard in
				<select name="year" value={t?.params.year ?? data.years.at(-1)}>
					{#each data.years as y (y)}<option value={y}>{y}</option>{/each}
				</select>
			</label>
		{/if}
		<label>Up to how many songs <input name="n" type="number" min="1" max="500" value={t?.params.n ?? 50} /></label>
		<div class="row">
			<button>Save template</button>
			<button type="button" class="secondary" onclick={() => (editing = null)}>Cancel</button>
		</div>
		{#if form?.error && form.editing === (t?.id ?? 'new')}<p class="error">{form.error}</p>{/if}
	</form>
{/snippet}

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
		max-width: 60ch;
	}
	.banner {
		background: #3d2e12;
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 0.9rem;
	}
	.templates {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 14px;
	}
	.row {
		display: flex;
		gap: 12px;
		align-items: start;
		flex-wrap: wrap;
	}
	.grow {
		flex: 1;
		min-width: 240px;
	}
	.grow p {
		margin: 2px 0 0;
	}
	.small {
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.stack {
		display: grid;
		gap: 12px;
		max-width: 520px;
	}
	.editor {
		margin-bottom: 14px;
	}
	.preview {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--grid);
	}
	.preview h3 {
		font-size: 0.9rem;
		margin: 0 0 8px;
	}
	.preview h3 small {
		color: var(--muted);
		font-weight: 400;
		margin-left: 8px;
	}
	.preview ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 5px;
		max-height: 420px;
		overflow-y: auto;
	}
	.preview li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: center;
		font-size: 0.9rem;
	}
	.preview li.missing {
		opacity: 0.55;
	}
	.what {
		display: grid;
		min-width: 0;
	}
	.what a,
	.what small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preview small {
		color: var(--ink-2);
		font-size: 0.78rem;
	}
</style>
