<script lang="ts">
	import { enhance } from '$app/forms';
	import ReportView from '#lib/components/ReportView.svelte';
	import { u, fmt } from '#lib/nav.js';
	import { formatDate, monthName } from '#lib/time.js';
	import { scrollRow } from '#lib/scroll-row.js';

	let { data, form } = $props();
	const shareUrl = $derived(data.share ? `${data.origin}/share/${data.share.token}` : null);
	const isShared = (id: string) => data.shared.includes(id);
	let copied = $state(false);
	let field = $state<HTMLInputElement>();
	async function copy() {
		try {
			await navigator.clipboard.writeText(shareUrl!);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			field?.select(); // no clipboard access (plain http): leave it selected to copy by hand
		}
	}
</script>

<nav class="picker" aria-label="Period">
	<div class="seg years" {@attach scrollRow(data.period.id)}>
		{#each data.years as y (y)}
			<a href={u(`/reports?period=${y}`)} aria-current={y === data.period.y && data.period.m === null ? 'page' : undefined} class:within={y === data.period.y && data.period.m !== null}>
				{y}{#if isShared(String(y))}<i class="dot" title="Shared"></i>{/if}
			</a>
		{/each}
	</div>
	<div class="seg months" {@attach scrollRow(data.period.id)}>
		<a href={u(`/reports?period=${data.period.y}`)} aria-current={data.period.m === null ? 'page' : undefined}>Whole year</a>
		{#each data.months as m (m.id)}
			<a href={u(`/reports?period=${m.id}`)} aria-current={m.id === data.period.id ? 'page' : undefined} class:empty={!m.plays} title="{fmt(m.plays)} plays{isShared(m.id) ? ', shared' : ''}">
				{monthName(m.m)}{#if isShared(m.id)}<i class="dot"></i>{/if}
			</a>
		{/each}
	</div>
</nav>

<ReportView report={data} rankBy={data.view.rankBy} eyebrow="{data.view.label ? `${data.view.label}'s` : 'Your'} listening report">
	{#snippet actions()}
		{#if !data.view.readonly && data.totals.plays && !data.share}
			<form method="POST" action="?/publish" use:enhance>
				<input type="hidden" name="period" value={data.period.id} />
				<button class="share-btn">Share with friends</button>
			</form>
		{/if}
		<a class="button secondary" href={u(`/reports/pdf?period=${data.period.id}`)} download>Download PDF</a>
		{#if data.period.m === null}<a class="button secondary" href={u(`/wrapped/${data.period.y}`)}>Year in review</a>{/if}
		<a class="quiet" href={u(`/history?range=all&month=${data.period.m === null ? `${data.period.y}-01` : data.period.id}`)}>Browse these plays</a>
	{/snippet}
	{#snippet below()}
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		{#if data.share && shareUrl}
			<section class="share" aria-label="Shared link">
				<p>
					<strong><i class="dot"></i>Shared</strong>
					<span class="muted">Friends with the link see this report as of {formatDate(data.share.updated_at, data.view.tz)}: totals and top lists, not your play history.</span>
				</p>
				<div class="share-row">
					<input bind:this={field} id="share-link" readonly value={shareUrl} aria-label="Link to this report" onfocus={(e) => e.currentTarget.select()} />
					<div class="share-buttons">
						<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
						<a class="button secondary" href={shareUrl} target="_blank" rel="noopener">Open</a>
						<form method="POST" action="?/publish" use:enhance>
							<input type="hidden" name="period" value={data.period.id} />
							<button class="secondary" title="Replace the shared copy with this report as it is now">Update</button>
						</form>
						<form method="POST" action="?/unpublish" use:enhance>
							<input type="hidden" name="period" value={data.period.id} />
							<button class="secondary stop">Stop sharing</button>
						</form>
					</div>
				</div>
			</section>
		{/if}
	{/snippet}
</ReportView>

<style>
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 16px;
	}
	.seg {
		position: relative;
		display: flex;
		gap: 2px;
		background: var(--surface);
		border: 1px solid var(--border);
		padding: 3px;
		border-radius: 10px;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	/* Fade an edge with more periods hidden past it. */
	.seg:global(.more-right) {
		mask-image: linear-gradient(to right, #000 calc(100% - 48px), transparent);
	}
	.seg:global(.more-left) {
		mask-image: linear-gradient(to right, transparent, #000 48px);
	}
	.seg:global(.more-left.more-right) {
		mask-image: linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 48px), transparent);
	}
	.seg a {
		position: relative;
		flex: none;
		padding: 5px 11px;
		border-radius: 7px;
		text-decoration: none;
		color: var(--ink-2);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.seg a.empty {
		color: var(--muted);
	}
	.seg a:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
	.seg a.within {
		background: var(--surface-3);
		color: var(--ink);
		font-weight: 650;
	}
	.seg a[aria-current] {
		background: var(--ink);
		color: var(--page);
		font-weight: 650;
	}
	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-left: 5px;
		vertical-align: 2px;
		border-radius: 50%;
		background: var(--good);
	}
	form {
		display: contents;
	}
	.share-btn {
		background: #1db954;
		color: #08130b;
		font-weight: 650;
	}
	.share-btn:hover {
		background: #2bd065;
	}
	.quiet {
		color: var(--ink-2);
		font-size: 0.9rem;
	}
	.share {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		align-items: center;
		gap: 12px 24px;
		margin-bottom: 20px;
		padding: 14px 18px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--good) 9%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--good) 35%, transparent);
	}
	.share p {
		margin: 0;
		display: grid;
		gap: 2px;
		font-size: 0.88rem;
	}
	.share .dot {
		margin: 0 6px 0 0;
	}
	.share-row {
		display: flex;
		gap: 8px;
		min-width: 0;
	}
	.share-row input {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 0.88rem;
	}
	.share-buttons {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.stop {
		color: #f09a9a;
	}
	.error {
		margin: 0 0 16px;
	}
	@media (max-width: 1100px) {
		.share {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 640px) {
		.picker {
			display: grid;
		}
		.share-row {
			flex-direction: column;
		}
		.share-buttons {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
		.share-buttons > :global(*) {
			text-align: center;
		}
	}
</style>
