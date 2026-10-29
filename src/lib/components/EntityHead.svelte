<script lang="ts">
	import type { Snippet } from 'svelte';
	import Cover from './Cover.svelte';
	import Columns from './Columns.svelte';
	import { u, fmt, listened, timeUnitTitle } from '#lib/nav.js';
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
		bannedBy = null,
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
		/** The viewer's ban hiding this page's plays: on the item itself, or on its album or artist. */
		bannedBy?: { kind: 'track' | 'album' | 'artist'; id: number; name: string } | null;
		form: any;
		children?: Snippet;
	} = $props();

	const NOUN = { track: 'song', album: 'album', artist: 'artist' };
	const month = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
	const peakIndex = $derived(monthly.peak ? monthly.months.findIndex((m) => m.y === monthly.peak!.y && m.m === monthly.peak!.m) : -1);
</script>

{#if bannedBy}
	<section class="banned" role="status">
		<p>
			{#if bannedBy.kind === kind}
				<strong>You banned this {NOUN[kind]}.</strong> Your plays of it are left out of your stats, lists, charts, history and search.
			{:else}
				<strong>Hidden by a ban.</strong> You banned the {NOUN[bannedBy.kind]}
				<a href={u(`/${bannedBy.kind}/${bannedBy.id}`)}>{bannedBy.name}</a>, so plays of this {NOUN[kind]} are left out of your stats too.
			{/if}
		</p>
		<form method="POST" action="?/unban">
			<input type="hidden" name="kind" value={bannedBy.kind} />
			<input type="hidden" name="id" value={bannedBy.id} />
			<button>Unban {bannedBy.kind === kind ? `this ${NOUN[kind]}` : bannedBy.name}</button>
		</form>
	</section>
{/if}

<section class="head">
	<Cover src={image} alt={title} size={220} {round} />
	<div class="info">
		<h1>{title}</h1>
		{@render children?.()}
		{#if !readonly && !bannedBy}
			<form class="ban" method="POST" action="?/ban">
				<button class="secondary" title="Hide this {NOUN[kind]} everywhere and leave its plays out of your stats. You can unban it any time.">Ban {NOUN[kind]}</button>
				<span class="muted">Hides it everywhere and removes it from your stats.</span>
			</form>
		{/if}
		{#if form?.banError}<p class="error">{form.banError}</p>{/if}
		<dl>
			<div><dt>Plays</dt><dd>{fmt(totals.plays)}</dd></div>
			<div><dt>{timeUnitTitle()}</dt><dd>{listened(totals.ms)}</dd></div>
			{#if monthly.peak}<div><dt>Most played month</dt><dd>{monthName(monthly.peak.m)} {monthly.peak.y} <small>{fmt(monthly.peak.plays)} plays</small></dd></div>{/if}
			{#if monthly.peakYear}<div><dt>Most played year</dt><dd>{monthly.peakYear.year} <small>{fmt(monthly.peakYear.plays)} plays</small></dd></div>{/if}
		</dl>
		{#if totals.first}
			<p class="muted">
				First played {formatWhen(totals.first, tz)}, last played {formatWhen(totals.last!, tz)}.
				<a href={u(`/history?${kind}=${id}&range=all`)}>See every play</a>
			</p>
		{:else if bannedBy}
			<p class="muted">Plays are hidden while it's banned.</p>
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
	.banned {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 20px;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
		padding: 14px 18px;
		border-radius: 12px;
		background: var(--surface-2);
		border-left: 4px solid var(--critical);
	}
	.banned p {
		margin: 0;
		flex: 1 1 320px;
	}
	.ban {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 0.85rem;
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
