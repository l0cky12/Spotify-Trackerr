<script lang="ts">
	import { enhance } from '$app/forms';
	import RecList from '#lib/components/RecList.svelte';
	import { formatWhen } from '#lib/time.js';
	import { page } from '$app/state';
	let { data, form } = $props();
	let busy = $state(false);
	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<h1>Discover</h1>
<p class="muted lede">Songs you haven't played yet, picked by ListenBrainz Radio from the artists you've played most in the last 30 days.</p>

{#if !data.enabled}
	<section class="panel">
		<p>Discover needs a ListenBrainz token. The admin can add <code>LISTENBRAINZ_TOKEN</code> to the server settings; a free account at listenbrainz.org provides one.</p>
	</section>
{:else}
	<div class="actions">
		<form method="POST" action="?/refresh" use:enhance={submit}>
			<button disabled={busy}>{busy ? 'Building…' : data.playlist ? 'Make a new playlist' : 'Make my playlist'}</button>
		</form>
		{#if data.playlist && data.linked}
			<form method="POST" action="?/save" use:enhance={submit}>
				<button class="secondary" disabled={busy}>Save to Spotify</button>
			</form>
		{/if}
	</div>
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.savedUrl}<p class="ok">Saved {form.savedCount} songs to Spotify. <a href={form.savedUrl} target="_blank" rel="noopener">Open the playlist</a></p>{/if}

	{#if data.playlist}
		<section class="panel">
			<h2>
				{data.playlist.songs.length} songs
				<small>Based on {data.playlist.seeds.join(', ')}. Made {formatWhen(data.playlist.at, page.data.me.tz)}</small>
			</h2>
			<RecList recs={data.playlist.songs} />
		</section>
	{/if}
{/if}

<style>
	.lede {
		margin: 6px 0 20px;
		max-width: 60ch;
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-bottom: 16px;
	}
	code {
		background: var(--surface-2);
		padding: 1px 5px;
		border-radius: 4px;
	}
</style>
