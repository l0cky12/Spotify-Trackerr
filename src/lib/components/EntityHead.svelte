<script lang="ts">
	import type { Snippet } from 'svelte';
	import Cover from './Cover.svelte';
	import Columns from './Columns.svelte';
	import { u, fmt, minutes } from '#lib/nav.js';
	import { formatWhen, monthName } from '#lib/time.js';

	let {
		kind,
		id,
		title,
		image,
		round = false,
		totals,
		monthly,
		tz,
		readonly,
		form,
		children
	}: {
		kind: 'track' | 'album' | 'artist';
		id: number;
		title: string;
		image: string | null;
		round?: boolean;
		totals: { plays: number; ms: number; first: number | null; last: number | null };
		monthly: { months: { y: number; m: number; label: string; plays: number }[]; peak: { y: number; m: number; plays: number } | null; peakYear: { year: number; plays: number } | null };
		tz: string;
		readonly: boolean;
		form: any;
		children?: Snippet;
	} = $props();

	const month = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
	const peakIndex = $derived(monthly.peak ? monthly.months.findIndex((m) => m.y === monthly.peak!.y && m.m === monthly.peak!.m) : -1);
</script>

<section class="head">
	<Cover src={image} alt={title} size={220} {round} />
	<div class="info">
		<h1>{title}</h1>
		{@render children?.()}
		<dl>
			<div><dt>Plays</dt><dd>{fmt(totals.plays)}</dd></div>
			<div><dt>Minutes</dt><dd>{fmt(minutes(totals.ms))}</dd></div>
			{#if monthly.peak}<div><dt>Most played month</dt><dd>{monthName(monthly.peak.m)} {monthly.peak.y} <small>{fmt(monthly.peak.plays)} plays</small></dd></div>{/if}
			{#if monthly.peakYear}<div><dt>Most played year</dt><dd>{monthly.peakYear.year} <small>{fmt(monthly.peakYear.plays)} plays</small></dd></div>{/if}
		</dl>
		{#if totals.first}
			<p class="muted">
				First played {formatWhen(totals.first, tz)}, last played {formatWhen(totals.last!, tz)}.
				<a href={u(`/history?${kind}=${id}&range=all`)}>See every play</a>
			</p>
		{:else}
			<p class="muted">No plays yet.</p>
		{/if}
	</div>
</section>

{#if monthly.months.length}
	<section class="panel">
		<h2>Plays per month <small>Click a month to see those plays</small></h2>
		<Columns
			labels={monthly.months.map((m) => m.label)}
			values={monthly.months.map((m) => m.plays)}
			hrefs={monthly.months.map((m) => u(`/history?${kind}=${id}&range=all&month=${month(m.y, m.m)}`))}
			highlight={peakIndex}
			name="Plays"
		/>
	</section>
{/if}

{#if !readonly}
	<details class="img">
		<summary>Change picture</summary>
		<form method="POST" action="?/image" enctype="multipart/form-data">
			<label>Paste an image address <input name="url" type="url" placeholder="https://" /></label>
			<label>or upload a file <input name="file" type="file" accept="image/*" /></label>
			<div class="row">
				<button>Save picture</button>
				<span class="muted">Save with both empty to go back to the automatic picture.</span>
			</div>
			{#if form?.imageError}<p class="error">{form.imageError}</p>{/if}
			{#if form?.imageSaved}<p class="ok">Picture saved.</p>{/if}
		</form>
	</details>
{/if}

<style>
	.head {
		display: flex;
		gap: 28px;
		align-items: end;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}
	.info {
		display: grid;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}
	h1 {
		font-size: 2.6rem;
		font-stretch: 75%;
	}
	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 36px;
		margin: 6px 0 0;
	}
	dl div {
		display: flex;
		flex-direction: column-reverse;
	}
	dt {
		font-size: 0.8rem;
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		font-stretch: 80%;
	}
	dd small {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--ink-2);
		font-stretch: 100%;
	}
	.info :global(p) {
		margin: 0;
	}
	.panel {
		margin-bottom: 20px;
	}
	.img {
		margin-bottom: 20px;
		color: var(--ink-2);
		font-size: 0.9rem;
	}
	.img form {
		display: grid;
		gap: 10px;
		max-width: 520px;
		margin-top: 10px;
	}
	.row {
		display: flex;
		gap: 12px;
		align-items: center;
	}
</style>
