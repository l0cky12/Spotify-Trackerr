<script lang="ts">
	// PROTOTYPE: floating variant picker. Delete once a variant wins.
	import { dev } from '$app/env';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { variants }: { variants: { key: string; name: string }[] } = $props();
	const i = $derived(Math.max(0, variants.findIndex((v) => v.key === (page.url.searchParams.get('variant') ?? variants[0].key))));
	const go = (step: number) => {
		const url = new URL(page.url.href);
		url.searchParams.set('variant', variants[(i + step + variants.length) % variants.length].key);
		goto(url, { replace: true, reset: false });
	};
	const onkeydown = (e: KeyboardEvent) => {
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === 'ArrowLeft') go(-1);
		if (e.key === 'ArrowRight') go(1);
	};
</script>

<svelte:window {onkeydown} />

{#if dev}
	<div class="switcher">
		<button onclick={() => go(-1)} aria-label="Previous variant">←</button>
		<span>{variants[i].key} ({variants[i].name})</span>
		<button onclick={() => go(1)} aria-label="Next variant">→</button>
	</div>
{/if}

<style>
	.switcher {
		position: fixed;
		bottom: 18px;
		left: 50%;
		translate: -50% 0;
		display: flex;
		gap: 10px;
		align-items: center;
		background: #fde047;
		color: #111;
		padding: 6px 8px;
		border-radius: 999px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
		font-weight: 600;
		z-index: 100;
	}
	button {
		background: #111;
		color: #fde047;
		border-radius: 999px;
		padding: 4px 12px;
	}
</style>
