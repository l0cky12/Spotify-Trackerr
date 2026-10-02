<script lang="ts">
	let { src, alt, size = 48, round = false }: { src?: string | null; alt: string; size?: number; round?: boolean } = $props();
	let failed = $state(false);
	const initials = $derived(
		alt
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase())
			.join('')
	);
</script>

{#if src && !failed}
	<img class="cover" class:round {src} {alt} width={size} height={size} loading="lazy" onerror={() => (failed = true)} style:--s="{size}px" />
{:else}
	<span class="cover ph" class:round style:--s="{size}px" role="img" aria-label={alt}>{initials}</span>
{/if}

<style>
	.cover {
		width: var(--s);
		height: var(--s);
		flex: none;
		object-fit: cover;
		border-radius: 3px;
		background: var(--surface-2);
	}
	.round {
		border-radius: 50%;
	}
	.ph {
		display: inline-grid;
		place-items: center;
		color: var(--muted);
		font-size: calc(var(--s) * 0.32);
		font-weight: 600;
		font-stretch: 75%;
	}
</style>
