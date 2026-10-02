<script lang="ts">
	import NowPlaying from '#lib/components/NowPlaying.svelte';
	import { fmt } from '#lib/nav.js';
	let { data } = $props();
</script>

<h1>People</h1>
<p class="muted lede">
	Everyone on this server who made their listening visible.
	{#if !data.mePublic}Yours is private; you can change that in <a href="/settings">Settings</a>.{/if}
</p>

{#if data.people.length}
	<ul class="people">
		{#each data.people as p (p.id)}
			<li class="panel">
				<div class="who">
					<a class="name" href="/?user={p.id}">{p.display_name}</a>
					<span class="muted">{fmt(p.today)} plays today</span>
				</div>
				{#if p.linked}<NowPlaying userId={p.id} compact />{/if}
				<nav>
					<a href="/?user={p.id}">Dashboard</a>
					<a href="/history?user={p.id}">History</a>
					<a href="/wrapped?user={p.id}">Year in review</a>
				</nav>
			</li>
		{/each}
	</ul>
	<p><a href="/?user=all">See everyone's listening combined</a></p>
{:else}
	<p>Nobody else has made their listening visible yet.</p>
{/if}

<style>
	.lede {
		margin: 6px 0 20px;
	}
	.people {
		list-style: none;
		padding: 0;
		margin: 0 0 20px;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 16px;
	}
	li {
		display: grid;
		gap: 12px;
	}
	.who {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.name {
		font-size: 1.2rem;
		font-weight: 700;
	}
	nav {
		display: flex;
		gap: 14px;
		font-size: 0.9rem;
	}
</style>
