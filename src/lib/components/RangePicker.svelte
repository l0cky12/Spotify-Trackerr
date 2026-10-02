<script lang="ts">
	import { RANGES } from '#lib/time.js';
	import { withParams } from '#lib/nav.js';
	let { value }: { value: string } = $props();
</script>

<nav class="ranges" aria-label="Time range">
	{#each RANGES as r (r.id)}
		<a href={withParams({ range: r.id, before: null })} aria-current={r.id === value ? 'true' : undefined} data-sveltekit-noscroll>{r.label}</a>
	{/each}
</nav>

<style>
	.ranges {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		background: var(--surface);
		padding: 3px;
		border-radius: 8px;
		width: fit-content;
	}
	a {
		padding: 6px 12px;
		border-radius: 6px;
		color: var(--ink-2);
		text-decoration: none;
		font-size: 0.875rem;
		white-space: nowrap;
	}
	a:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
	a[aria-current] {
		background: var(--ink);
		color: var(--page);
		font-weight: 600;
	}
</style>
