<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatWhen, formatDate } from '#lib/time.js';
	import { fmt } from '#lib/nav.js';

	let { data, form } = $props();
	let importing = $state(false);
	const msg = (section: string) => (form?.section === section ? form : null);
	const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

	// One section shows at a time, picked by ?section= so it renders on the server and works without JavaScript.
	// Each form posts to ?section=<id>&/<action> so the same section reopens with its result.
	const sections = $derived([
		{ id: 'spotify', group: 'Connections', title: 'Spotify', alert: !data.u.linked || !!data.u.syncError, body: spotifySection },
		{ id: 'lastfm', group: 'Connections', title: 'Last.fm', alert: false, body: lastfmSection },
		{ id: 'ownApp', group: 'Connections', title: 'Your own Spotify app', alert: false, body: ownAppSection },
		{ id: 'import', group: 'Your data', title: 'Import your Spotify history', alert: false, body: importSection },
		{ id: 'prefs', group: 'Profile', title: 'Preferences', alert: false, body: prefsSection },
		{ id: 'password', group: 'Profile', title: data.u.hasPassword ? 'Username and password' : 'Add a username and password', alert: false, body: passwordSection },
		{ id: 'account', group: 'Profile', title: 'Account', alert: false, body: accountSection },
		...(data.admin ? [{ id: 'admin', group: 'Server', title: 'Admin', alert: false, body: adminSection }] : [])
	]);
	const groups = $derived([...new Set(sections.map((s) => s.group))]);
	const current = $derived(sections.find((s) => s.id === (page.url.searchParams.get('section') ?? (data.welcome ? 'import' : 'spotify'))) ?? sections[0]);
</script>

<h1>Settings</h1>

{#if data.welcome}<p class="ok">Welcome! Your account is ready. Import your Spotify history to fill in the past.</p>{/if}
{#if data.error}<p class="error">{data.error}</p>{/if}

<div class="layout">
	<nav aria-label="Settings sections">
		{#each groups as g (g)}
			<p class="group">{g}</p>
			{#each sections.filter((s) => s.group === g) as s (s.id)}
				<a href="?section={s.id}" aria-current={s.id === current.id ? 'true' : undefined}>
					{s.title}
					{#if s.alert}<span class="dot" aria-hidden="true"></span><span class="sr-only">(needs attention)</span>{/if}
				</a>
			{/each}
		{/each}
	</nav>
	<section class="panel" class:wide={current.id === 'admin'}>
		<h2>{current.title}</h2>
		{@render current.body()}
	</section>
</div>

{#snippet spotifySection()}
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
		<form method="POST" action="?section=spotify&/unlink" use:enhance><button class="secondary">Unlink Spotify</button></form>
	</div>
	<p class="muted small">Unlinking stops syncing. Your history stays.</p>
{:else if data.serverApp || data.u.ownClientId}
	<p>Sign in with Spotify to track new plays automatically. Past plays come from <a href="?section=import">your history file</a>.</p>
	<a class="button" href="/auth/spotify?mode=link">Sign in with Spotify</a>
{:else}
	<p class="muted">No Spotify app is set up on this server yet. <a href="?section=ownApp">Add your own</a>, or ask the admin to set one up.</p>
{/if}
{#if msg('spotify')?.error}<p class="error">{msg('spotify')?.error}</p>{/if}
{/snippet}

{#snippet importSection()}
<p>
	Request <strong>Extended streaming history</strong> on Spotify's
	<a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">privacy page</a>. It can take up to 30 days to arrive. Upload the .zip, or the
	<code>Streaming_History_Audio_*.json</code> files inside it. Importing again is safe: plays already here are skipped.
</p>
<form
	method="POST"
	action="?section=import&/import"
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

{#snippet prefsSection()}
<form method="POST" action="?section=prefs&/prefs" use:enhance={() => ({ update }) => update({ reset: false })} class="stack">
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

{#snippet passwordSection()}
{#if !data.u.hasPassword}<p class="muted">Lets you log in without Spotify.</p>{/if}
<form method="POST" action="?section=password&/password" use:enhance class="stack">
	<label>Username <input name="username" value={data.u.username ?? ''} autocomplete="username" required /></label>
	{#if data.u.hasPassword}<label>Current password <input name="current" type="password" autocomplete="current-password" required /></label>{/if}
	<label>New password <input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
	<button>Save password</button>
	{#if msg('password')?.saved}<p class="ok">Saved.</p>{/if}
	{#if msg('password')?.error}<p class="error">{msg('password')?.error}</p>{/if}
</form>
{/snippet}

{#snippet ownAppSection()}
<p class="muted">
	Spotify lets each app link only 5 accounts. If this server's app is full, create your own free app at
	<a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> (the app's owner needs Premium), add this
	redirect address, then paste its Client ID and secret here and sign in with Spotify again.
</p>
<p><code>{data.callback}</code></p>
<form method="POST" action="?section=ownApp&/ownApp" use:enhance class="stack">
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

{#snippet lastfmSection()}
{#if data.u.lastfmUser}
	<p>
		<span class="ok">Linked</span> as
		<a href="https://www.last.fm/user/{encodeURIComponent(data.u.lastfmUser)}" target="_blank" rel="noopener">{data.u.lastfmUser}</a>.
		<a href="/discover">Discover</a> picks new music from your Last.fm top artists and songs of the last month.
	</p>
	<div class="row">
		{#if data.lastfmLogin}<a class="button" href="/auth/lastfm">Reconnect Last.fm</a>{/if}
		<form method="POST" action="?section=lastfm&/lastfmUnlink" use:enhance><button class="secondary">Unlink Last.fm</button></form>
	</div>
	<p class="muted small">Unlinking makes Discover go back to what you've played here.</p>
{:else if data.lastfmLogin}
	<p>Sign in with Last.fm so <a href="/discover">Discover</a> picks new music from everything you scrobble, not just what you've played here.</p>
	<a class="button" href="/auth/lastfm">Sign in with Last.fm</a>
{:else if !data.admin}
	<p class="muted">Last.fm sign-in isn't turned on for this server yet. Ask the admin to turn it on.</p>
{:else if data.admin.lastfmFromEnv}
	<p class="muted">This server's Last.fm key is set in its <code>.env</code> file. Add <code>LASTFM_SHARED_SECRET</code> from the same Last.fm app there to turn on sign-in.</p>
{/if}
{#if data.admin && !data.admin.lastfmFromEnv}
	{#if data.lastfmLogin}
		<details>
			<summary class="muted small">Change this server's Last.fm app</summary>
			{@render lastfmAppForm()}
		</details>
	{:else}
		<p>
			Turn on Last.fm sign-in for everyone on this server. Create a free app at
			<a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a> (any name; leave the callback URL empty), then paste
			its API key and shared secret here.
		</p>
		{@render lastfmAppForm()}
	{/if}
{/if}
{#if msg('lastfm')?.error}<p class="error">{msg('lastfm')?.error}</p>{/if}
{/snippet}

{#snippet lastfmAppForm()}
<form method="POST" action="?section=lastfm&/lastfmApp" use:enhance class="stack">
	<label>API key <input name="api_key" value={data.admin?.lastfmKey} autocomplete="off" required /></label>
	<label>Shared secret <input name="shared_secret" type="password" placeholder={data.admin?.lastfmKey ? 'Saved' : ''} autocomplete="off" required /></label>
	<button>Save and turn on</button>
	<p class="muted small">The secret is stored encrypted.</p>
</form>
{/snippet}

{#snippet accountSection()}
<form method="POST" action="/logout"><button class="secondary">Log out</button></form>
<form method="POST" action="?section=account&/deleteAccount" use:enhance class="stack danger-zone">
	<label>Delete my account and all my plays. Type DELETE to confirm. <input name="confirm" autocomplete="off" /></label>
	<button class="danger">Delete account</button>
	{#if msg('account')?.error}<p class="error">{msg('account')?.error}</p>{/if}
</form>
{/snippet}

{#snippet adminSection()}
{#if data.admin}
	<form method="POST" action="?section=admin&/adminSignup" use:enhance={() => ({ update }) => update({ reset: false })}>
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
						<form method="POST" action="?section=admin&/adminToggle" use:enhance>
							<input type="hidden" name="id" value={usr.id} />
							<button class="secondary small-btn">{usr.is_admin ? 'Remove admin' : 'Make admin'}</button>
						</form>
					</td>
					<td>
						<form method="POST" action="?section=admin&/adminDelete" use:enhance={({ cancel }) => { if (!confirm(`Delete ${usr.display_name} and all their plays?`)) cancel(); }}>
							<input type="hidden" name="id" value={usr.id} />
							<button class="danger small-btn">Delete</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<form method="POST" action="?section=admin&/adminCreate" use:enhance class="row create">
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
	.layout {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	nav {
		display: grid;
		gap: 2px;
		position: sticky;
		top: 20px;
	}
	.group {
		margin: 14px 0 4px 10px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.group:first-child {
		margin-top: 0;
	}
	nav a {
		color: var(--ink-2);
		text-decoration: none;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 0.9rem;
	}
	nav a:hover {
		background: var(--surface);
		color: var(--ink);
	}
	nav a[aria-current] {
		background: var(--surface-2);
		color: var(--ink);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--critical);
		display: inline-block;
		margin-left: 6px;
		vertical-align: middle;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.panel {
		padding: 24px 28px;
		max-width: 760px;
	}
	.panel.wide {
		max-width: none;
	}
	@media (max-width: 760px) {
		.layout {
			grid-template-columns: 1fr;
			gap: 14px;
		}
		nav {
			position: static;
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
		}
		.group {
			display: none;
		}
		nav a {
			background: var(--surface);
		}
		.panel {
			padding: 18px 20px;
		}
	}
</style>
