<script lang="ts">
	// PROTOTYPE: three settings layouts switchable via ?variant=A|B|C. Section bodies are shared snippets; only the layout differs.
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatWhen, formatDate } from '#lib/time.js';
	import { fmt } from '#lib/nav.js';
	import PrototypeSwitcher from '#lib/components/PrototypeSwitcher.svelte';

	let { data, form } = $props();
	let importing = $state(false);
	const msg = (section: string) => (form?.section === section ? form : null);
	const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

	const variant = $derived(page.url.searchParams.get('variant') ?? 'A');
	const sections = $derived([
		{ id: 'spotify', group: 'Connections', title: 'Spotify', blurb: 'Syncs new plays every 5 minutes.', status: data.u.syncError ? 'Sync stopped' : data.u.linked ? `Linked${data.u.lastSync ? ` · checked ${formatWhen(data.u.lastSync, data.u.timezone)}` : ''}` : 'Not linked', bad: !!data.u.syncError || !data.u.linked, body: s_spotify },
		{ id: 'listenbrainz', group: 'Connections', title: 'ListenBrainz', blurb: 'Powers the Discover page.', status: data.u.hasListenbrainz ? 'Token saved' : data.serverListenbrainz ? "Using the server's token" : 'Not set up', bad: !data.u.hasListenbrainz && !data.serverListenbrainz, body: s_listenbrainz },
		{ id: 'own-app', group: 'Connections', title: 'Your own Spotify app', blurb: 'Only needed if the server app is full.', status: data.u.ownClientId ? 'Using your app' : "Using the server's app", bad: false, body: s_own_app },
		{ id: 'import', group: 'Your data', title: 'Import history', blurb: 'Fill in plays from before you joined.', status: data.imports.length ? `${data.imports.length} import${data.imports.length === 1 ? '' : 's'}` : 'Nothing imported yet', bad: false, body: s_import },
		{ id: 'prefs', group: 'Profile', title: 'Preferences', blurb: 'Name, time zone, ranking and privacy.', status: `${data.u.timezone} · by ${data.u.rankBy}${data.u.public ? ' · public' : ' · private'}`, bad: false, body: s_prefs },
		{ id: 'password', group: 'Profile', title: 'Username and password', blurb: 'Log in without Spotify.', status: data.u.hasPassword ? (data.u.username ?? '') : 'Not set', bad: !data.u.hasPassword, body: s_password },
		...(data.admin ? [{ id: 'admin', group: 'Server', title: 'Admin', blurb: 'People on this server and sign-up rules.', status: `${data.admin!.users.length} ${data.admin!.users.length === 1 ? 'person' : 'people'}`, bad: false, body: s_admin }] : []),
		{ id: 'account', group: 'Profile', title: 'Log out or delete account', blurb: 'Deleting removes all your plays.', status: '', bad: false, body: s_account }
	]);
	const groups = $derived([...new Set(sections.map((s) => s.group))]);

	// A: one section at a time, picked from a sidebar
	let picked = $state('spotify');
	const current = $derived(sections.find((s) => s.id === picked) ?? sections[0]);

	// B: tabs per group
	let tab = $state('Connections');
</script>

<h1>Settings</h1>

{#if data.welcome}<p class="ok">Welcome! Your account is ready. Import your Spotify history below to fill in the past.</p>{/if}
{#if data.error}<p class="error">{data.error}</p>{/if}

{#if variant === 'A'}
	<div class="a-layout">
		<nav class="a-nav" aria-label="Settings sections">
			{#each groups as g (g)}
				<p class="a-group">{g}</p>
				{#each sections.filter((s) => s.group === g) as s (s.id)}
					<button class="a-item" aria-current={s.id === current.id ? 'true' : undefined} onclick={() => (picked = s.id)}>
						{s.title}
						{#if s.bad}<span class="dot" aria-label="Needs attention"></span>{/if}
					</button>
				{/each}
			{/each}
		</nav>
		<section class="panel a-body">
			<h2>{current.title}</h2>
			{@render current.body()}
		</section>
	</div>
{:else if variant === 'B'}
	<div class="b-tabs" role="tablist">
		{#each groups as g (g)}
			<button role="tab" aria-selected={g === tab} onclick={() => (tab = g)}>{g}</button>
		{/each}
	</div>
	<div class="b-rows">
		{#each sections.filter((s) => s.group === tab) as s (s.id)}
			<div class="b-row">
				<div class="b-label">
					<h2>{s.title}</h2>
					<p class="muted small">{s.blurb}</p>
				</div>
				<div class="b-body">{@render s.body()}</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="c-list">
		{#each groups as g (g)}
			<p class="c-group">{g}</p>
			<div class="c-card">
				{#each sections.filter((s) => s.group === g) as s (s.id)}
					<details id={s.id}>
						<summary>
							<span class="c-title">{s.title}</span>
							<span class="c-status" class:error={s.bad}>{s.status}</span>
							<span class="c-chev" aria-hidden="true">›</span>
						</summary>
						<div class="c-body">{@render s.body()}</div>
					</details>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<PrototypeSwitcher variants={[{ key: 'A', name: 'Sidebar' }, { key: 'B', name: 'Tabs' }, { key: 'C', name: 'Status list' }]} />

{#snippet s_spotify()}
{#if data.u.linked}
	<p>
		{#if data.u.syncError === 'reauth'}
			<span class="error">Sync stopped: Spotify ended this app's access.</span>
		{:else if data.u.syncError}
			<span class="error">Last sync failed: {data.u.syncError}</span>
		{:else}
			<span class="ok">Linked.</span> New plays sync every 5 minutes{#if data.u.lastSync}; last checked {formatWhen(data.u.lastSync, data.u.timezone)}{/if}.
		{/if}
	</p>
	{#if data.u.linkExpires}<p class="muted">Spotify ends this link on {formatDate(data.u.linkExpires, data.u.timezone)}, six months after you signed in. Reconnect any time to reset it.</p>{/if}
	<div class="row">
		<a class="button" href="/auth/spotify?mode=link">Reconnect Spotify</a>
		<form method="POST" action="?/unlink" use:enhance><button class="secondary">Unlink Spotify</button></form>
	</div>
	<p class="muted small">Unlinking stops syncing. Your history stays.</p>
{:else if data.serverApp || data.u.ownClientId}
	<p>Sign in with Spotify to track new plays automatically. Past plays come from the history file below.</p>
	<a class="button" href="/auth/spotify?mode=link">Sign in with Spotify</a>
{:else}
	<p class="muted">No Spotify app is set up on this server yet. Add your own below, or ask the admin to set one up.</p>
{/if}
{#if msg('spotify')?.error}<p class="error">{msg('spotify')?.error}</p>{/if}
{/snippet}

{#snippet s_import()}
<p>
	Request <strong>Extended streaming history</strong> on Spotify's
	<a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">privacy page</a>. It can take up to 30 days to arrive. Upload the .zip, or the
	<code>Streaming_History_Audio_*.json</code> files inside it. Importing again is safe: plays already here are skipped.
</p>
<form
	method="POST"
	action="?/import"
	enctype="multipart/form-data"
	use:enhance={() => {
		importing = true;
		return async ({ update }) => {
			await update();
			importing = false;
		};
	}}
>
	<input type="file" name="files" accept=".json,.zip,application/json,application/zip" multiple required />
	<button disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
</form>
{#if msg('import')?.error}<p class="error">{msg('import')?.error}</p>{/if}
{#if msg('import')?.summary}
	{@const s = msg('import')!.summary!}
	<p class="ok">Added {fmt(s.added)} plays.</p>
	<p class="muted small">
		Skipped {fmt(s.duplicates)} already here, {fmt(s.skipped_short)} played under 30 seconds, {fmt(s.skipped_private)} from private sessions, {fmt(s.skipped_other)} podcasts, audiobooks or videos.
	</p>
{/if}
{#if data.pending}<p class="muted small">Looking up artwork and genres for {fmt(data.pending)} songs in the background.</p>{/if}
{#if data.imports.length}
	<table>
		<thead><tr><th>When</th><th>Added</th><th>Already here</th><th>Under 30 s</th><th>Private</th><th>Other</th></tr></thead>
		<tbody>
			{#each data.imports as i (i.id)}
				<tr title={i.files}>
					<td>{formatWhen(i.created_at, data.u.timezone)}</td>
					<td>{fmt(i.added)}</td>
					<td>{fmt(i.duplicates)}</td>
					<td>{fmt(i.skipped_short)}</td>
					<td>{fmt(i.skipped_private)}</td>
					<td>{fmt(i.skipped_other)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
{/snippet}

{#snippet s_prefs()}
<form method="POST" action="?/prefs" use:enhance={() => ({ update }) => update({ reset: false })} class="stack">
	<label>Display name <input name="display_name" value={data.u.displayName} maxlength="60" /></label>
	<label>
		Time zone
		<select name="timezone" value={data.u.timezone}>
			{#each data.timezones as tz (tz)}<option value={tz}>{tz}</option>{/each}
			{#if !data.timezones.includes('UTC')}<option value="UTC">UTC</option>{/if}
		</select>
		{#if browserTz !== data.u.timezone}<small class="muted">Your browser is set to {browserTz}.</small>{/if}
	</label>
	<fieldset>
		<legend>Rank top songs, albums and artists by</legend>
		<label class="inline"><input type="radio" name="rank_by" value="plays" checked={data.u.rankBy === 'plays'} /> Number of plays</label>
		<label class="inline"><input type="radio" name="rank_by" value="minutes" checked={data.u.rankBy === 'minutes'} /> Minutes listened</label>
	</fieldset>
	<label class="inline"><input type="checkbox" name="public" checked={data.u.public} /> Let other people on this server see my listening</label>
	<button>Save preferences</button>
	{#if msg('prefs')?.saved}<p class="ok">Saved.</p>{/if}
	{#if msg('prefs')?.error}<p class="error">{msg('prefs')?.error}</p>{/if}
</form>
{/snippet}

{#snippet s_password()}
{#if !data.u.hasPassword}<p class="muted">Lets you log in without Spotify.</p>{/if}
<form method="POST" action="?/password" use:enhance class="stack">
	<label>Username <input name="username" value={data.u.username ?? ''} autocomplete="username" required /></label>
	{#if data.u.hasPassword}<label>Current password <input name="current" type="password" autocomplete="current-password" required /></label>{/if}
	<label>New password <input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
	<button>Save password</button>
	{#if msg('password')?.saved}<p class="ok">Saved.</p>{/if}
	{#if msg('password')?.error}<p class="error">{msg('password')?.error}</p>{/if}
</form>
{/snippet}

{#snippet s_own_app()}
<p class="muted">
	Spotify lets each app link only 5 accounts. If this server's app is full, create your own free app at
	<a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> (the app's owner needs Premium), add this
	redirect address, then paste its Client ID and secret here and sign in with Spotify again.
</p>
<p><code>{data.callback}</code></p>
<form method="POST" action="?/ownApp" use:enhance class="stack">
	<label>Client ID <input name="client_id" value={data.u.ownClientId ?? ''} autocomplete="off" /></label>
	<label>Client secret <input name="client_secret" type="password" placeholder={data.u.ownClientId ? 'Saved' : ''} autocomplete="off" /></label>
	<div class="row">
		<button>Save my app</button>
		{#if data.u.ownClientId}<button class="secondary" name="clear" value="1">Stop using my app</button>{/if}
	</div>
	{#if msg('ownApp')?.saved}<p class="ok">Saved. Sign in with Spotify again to link through it.</p>{/if}
	{#if msg('ownApp')?.error}<p class="error">{msg('ownApp')?.error}</p>{/if}
</form>
{/snippet}

{#snippet s_listenbrainz()}
<p class="muted">
	Discover uses ListenBrainz Radio to find new songs. Make a free account at
	<a href="https://listenbrainz.org/settings/" target="_blank" rel="noopener">listenbrainz.org/settings</a>, copy your user token and paste it here.
</p>
{#if !data.u.hasListenbrainz && data.serverListenbrainz}<p class="muted small">Until you add your own, Discover uses this server's token.</p>{/if}
<form method="POST" action="?/listenbrainz" use:enhance class="stack">
	<label>User token <input name="token" type="password" placeholder={data.u.hasListenbrainz ? 'Saved' : ''} autocomplete="off" /></label>
	<div class="row">
		<button>Save token</button>
		{#if data.u.hasListenbrainz}<button class="secondary" name="clear" value="1">Remove token</button>{/if}
	</div>
	{#if msg('listenbrainz')?.saved}<p class="ok">Saved{#if msg('listenbrainz')?.lbUser} as {msg('listenbrainz')?.lbUser}{/if}. <a href="/discover">Go to Discover</a></p>{/if}
	{#if msg('listenbrainz')?.error}<p class="error">{msg('listenbrainz')?.error}</p>{/if}
</form>
{/snippet}

{#snippet s_account()}
<form method="POST" action="/logout"><button class="secondary">Log out</button></form>
<form method="POST" action="?/deleteAccount" use:enhance class="stack danger-zone">
	<label>Delete my account and all my plays. Type DELETE to confirm. <input name="confirm" autocomplete="off" /></label>
	<button class="danger">Delete account</button>
	{#if msg('account')?.error}<p class="error">{msg('account')?.error}</p>{/if}
</form>
{/snippet}

{#snippet s_admin()}
{#if data.admin}
	<form method="POST" action="?/adminSignup" use:enhance={() => ({ update }) => update({ reset: false })}>
		<label class="inline">
			<input type="checkbox" name="allow" checked={data.admin.allowSignup} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
			Anyone can create an account with a username and password
		</label>
	</form>
	<p class="muted small">Spotify sign-in always creates an account, but only for Spotify accounts you've added to the app's user list in the Spotify dashboard (up to 5).</p>
	{#if data.serverApp}<p class="muted small">Register <code>{data.callback}</code> (and the same path on your other address) as a redirect URI in the server's Spotify app.</p>{/if}
	<table>
		<thead><tr><th>Name</th><th>Username</th><th>Spotify</th><th>Plays</th><th>Admin</th><th></th></tr></thead>
		<tbody>
			{#each data.admin.users as usr (usr.id)}
				<tr>
					<td>{usr.display_name}</td>
					<td>{usr.username ?? ''}</td>
					<td>{usr.linked ? 'Linked' : ''}</td>
					<td>{fmt(usr.plays)}</td>
					<td>
						<form method="POST" action="?/adminToggle" use:enhance>
							<input type="hidden" name="id" value={usr.id} />
							<button class="secondary small-btn">{usr.is_admin ? 'Remove admin' : 'Make admin'}</button>
						</form>
					</td>
					<td>
						<form method="POST" action="?/adminDelete" use:enhance={({ cancel }) => { if (!confirm(`Delete ${usr.display_name} and all their plays?`)) cancel(); }}>
							<input type="hidden" name="id" value={usr.id} />
							<button class="danger small-btn">Delete</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<form method="POST" action="?/adminCreate" use:enhance class="row create">
		<label>Username <input name="username" required /></label>
		<label>Password <input name="password" type="password" minlength="8" required autocomplete="new-password" /></label>
		<button>Create user</button>
	</form>
	{#if msg('admin')?.error}<p class="error">{msg('admin')?.error}</p>{/if}
{/if}
{/snippet}

<style>
	h1 {
		margin-bottom: 20px;
	}
	.panel p {
		margin: 0 0 10px;
		max-width: 70ch;
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: end;
		flex-wrap: wrap;
	}
	.stack {
		display: grid;
		gap: 12px;
	}
	.inline {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 6px;
	}
	legend {
		font-size: 0.9rem;
		margin-bottom: 6px;
	}
	.small {
		font-size: 0.85rem;
	}
	code {
		background: var(--surface-2);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.85rem;
		word-break: break-all;
	}
	table {
		border-collapse: collapse;
		font-size: 0.85rem;
		margin: 12px 0;
		font-variant-numeric: tabular-nums;
		width: 100%;
	}
	th {
		text-align: left;
		color: var(--muted);
		font-weight: 400;
	}
	td,
	th {
		padding: 5px 10px 5px 0;
		border-bottom: 1px solid var(--grid);
	}
	.small-btn {
		padding: 3px 9px;
		font-size: 0.8rem;
	}
	.create {
		margin-top: 8px;
	}
	.danger-zone {
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--grid);
	}
	form + form {
		margin-top: 0;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--critical);
		display: inline-block;
		margin-left: 6px;
	}
	/* A: sidebar */
	.a-layout {
		display: grid;
		grid-template-columns: 220px minmax(0, 760px);
		gap: 28px;
		align-items: start;
	}
	.a-nav {
		display: grid;
		gap: 2px;
		position: sticky;
		top: 20px;
	}
	.a-group {
		margin: 14px 0 4px 10px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.a-group:first-child {
		margin-top: 0;
	}
	.a-item {
		background: none;
		color: var(--ink-2);
		text-align: left;
		padding: 7px 10px;
	}
	.a-item:hover {
		background: var(--surface);
		color: var(--ink);
	}
	.a-item[aria-current] {
		background: var(--surface-2);
		color: var(--ink);
	}
	.a-body {
		padding: 24px 28px;
	}
	/* B: tabs + label/body rows */
	.b-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--grid);
		margin-bottom: 8px;
	}
	.b-tabs button {
		background: none;
		color: var(--ink-2);
		border-radius: 0;
		padding: 10px 14px;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.b-tabs button[aria-selected='true'] {
		color: var(--ink);
		border-bottom-color: var(--series-1);
	}
	.b-row {
		display: grid;
		grid-template-columns: 280px minmax(0, 640px);
		gap: 40px;
		padding: 28px 0;
		border-bottom: 1px solid var(--grid);
	}
	.b-label h2 {
		margin-bottom: 6px;
	}
	/* C: status list */
	.c-list {
		max-width: 760px;
		margin: 0 auto;
	}
	.c-group {
		margin: 22px 0 8px 4px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.c-card {
		background: var(--surface);
		border-radius: 10px;
		overflow: hidden;
	}
	.c-card details + details {
		border-top: 1px solid var(--grid);
	}
	summary {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		background: var(--surface-2);
	}
	.c-title {
		font-weight: 600;
	}
	.c-status {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9rem;
		text-align: right;
	}
	.c-chev {
		color: var(--muted);
		font-size: 1.3rem;
		line-height: 1;
		transition: rotate 0.15s;
	}
	details[open] .c-chev {
		rotate: 90deg;
	}
	.c-body {
		padding: 4px 18px 20px;
	}
	@media (max-width: 760px) {
		.a-layout,
		.b-row {
			grid-template-columns: 1fr;
			gap: 14px;
		}
		.a-nav {
			position: static;
		}
	}
</style>
