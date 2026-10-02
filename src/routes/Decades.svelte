<script lang="ts">
	import Columns from '#lib/components/Columns.svelte';
	let { years }: { years: { year: number; plays: number }[] } = $props();
	let decade = $state<number | null>(null);

	const decades = $derived.by(() => {
		const m = new Map<number, number>();
		for (const y of years) m.set(Math.floor(y.year / 10) * 10, (m.get(Math.floor(y.year / 10) * 10) ?? 0) + y.plays);
		return [...m].sort((a, b) => a[0] - b[0]);
	});
	const inDecade = $derived(
		decade === null ? [] : Array.from({ length: 10 }, (_, i) => ({ year: decade! + i, plays: years.find((y) => y.year === decade! + i)?.plays ?? 0 }))
	);
</script>

{#if !years.length}
	<p class="muted">Release years appear once albums have been looked up.</p>
{:else if decade === null}
	<div class="hits">
		{#each decades as [d, plays] (d)}
			<button class="secondary" onclick={() => (decade = d)}>{d}s: {plays.toLocaleString()} plays</button>
		{/each}
	</div>
	<Columns labels={decades.map(([d]) => `${d}s`)} values={decades.map(([, p]) => p)} height={180} />
{:else}
	<button class="secondary back" onclick={() => (decade = null)}>All decades</button>
	<Columns labels={inDecade.map((y) => String(y.year))} values={inDecade.map((y) => y.plays)} height={180} name="{decade}s" />
{/if}

<style>
	.hits {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.hits button,
	.back {
		font-size: 0.8rem;
		padding: 4px 10px;
		margin-bottom: 10px;
	}
</style>
