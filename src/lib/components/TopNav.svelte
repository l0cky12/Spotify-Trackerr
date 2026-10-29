<script lang="ts">
	import { u } from '#lib/nav.js';
	// Songs / Albums / Artists / Charts tabs shared by the top pages.
	let { current, range }: { current: string; range: string } = $props();
	const tabs = [
		{ id: 'track', label: 'Songs' },
		{ id: 'album', label: 'Albums' },
		{ id: 'artist', label: 'Artists' },
		{ id: 'charts', label: 'Charts' }
	];
</script>

<nav class="tabs" aria-label="Top lists">
	{#each tabs as t (t.id)}
		<a href={u(`/top/${t.id}?range=${range}`)} aria-current={t.id === current ? 'page' : undefined}>{t.label}</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		gap: 2px;
		margin-top: 8px;
		font-size: 0.9rem;
	}
	a {
		padding: 4px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink-2);
	}
	a:hover {
		background: var(--surface);
		color: var(--ink);
	}
	a[aria-current] {
		background: var(--surface-2);
		color: var(--ink);
		font-weight: 600;
	}
</style>
