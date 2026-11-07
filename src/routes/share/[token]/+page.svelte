<script lang="ts">
	import ReportView from '#lib/components/ReportView.svelte';
	import { formatListened } from '#lib/time.js';

	let { data } = $props();
	const r = $derived(data.report);
	const title = $derived(`${r.who}'s ${r.period.label}`);
</script>

<svelte:head>
	<title>{title} in music</title>
	<meta name="robots" content="noindex" />
	<meta property="og:title" content="{title} in music" />
	<meta property="og:description" content="{r.totals.plays.toLocaleString('en-US')} plays and {formatListened(r.totals.ms, data.timeUnit)} of music, tracked with Trackerr." />
</svelte:head>

<p class="bar"><span class="brand">Trackerr</span><span class="muted">A listening report shared with you</span></p>

<ReportView report={r} rankBy={data.rankBy} linked={false} {title} eyebrow="Listening report" />

<footer>{r.period.label} report shared by {r.who} · figures as of {r.generatedOn}</footer>

<style>
	.bar {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin: 0 0 16px;
		font-size: 0.85rem;
	}
	.brand {
		font-weight: 800;
		font-stretch: 70%;
		font-size: 1.35rem;
		letter-spacing: -0.01em;
	}
	footer {
		margin: 8px 0 12px;
		padding-top: 16px;
		border-top: 1px solid var(--grid);
		text-align: center;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
