<script lang="ts">
	import Cover from './Cover.svelte';
	let { userId, compact = false }: { userId: number; compact?: boolean } = $props();

	type NP = { playing: boolean; name: string; artist: string; image: string | null; progress: number; duration: number; trackId: number | null; url: string | null };
	let np = $state<NP | null>(null);
	let fetchedAt = $state(0);
	let tick = $state(Date.now());

	async function load() {
		const r = await fetch(`/api/now-playing?user=${userId}`).catch(() => null);
		np = r?.ok ? await r.json() : null;
		fetchedAt = Date.now();
	}
	$effect(() => {
		load();
		const poll = setInterval(load, 30_000);
		const clock = setInterval(() => (tick = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
	});
	const pct = $derived(np && np.duration ? Math.min(100, ((np.progress + (np.playing ? tick - fetchedAt : 0)) / np.duration) * 100) : 0);
</script>

{#if np}
	<div class="np" class:compact>
		<Cover src={np.image} alt={np.name} size={compact ? 32 : 44} />
		<div class="text">
			<span class="state">{np.playing ? 'Now playing' : 'Paused'}</span>
			<span class="title">
				{#if np.trackId}<a href="/track/{np.trackId}">{np.name}</a>{:else}{np.name}{/if}
				<span class="artist">{np.artist}</span>
			</span>
			{#if !compact}<span class="progress"><span style:width="{pct}%"></span></span>{/if}
		</div>
	</div>
{/if}

<style>
	.np {
		display: flex;
		gap: 12px;
		align-items: center;
		background: var(--surface);
		border-radius: 8px;
		padding: 8px 14px 8px 8px;
		min-width: 0;
	}
	.compact {
		background: none;
		padding: 0;
	}
	.text {
		display: grid;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.state {
		font-size: 0.72rem;
		color: var(--good);
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}
	.artist {
		color: var(--ink-2);
		margin-left: 6px;
	}
	.progress {
		height: 3px;
		background: var(--surface-3);
		border-radius: 2px;
		margin-top: 4px;
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: var(--ink-2);
	}
</style>
