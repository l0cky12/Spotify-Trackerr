<script lang="ts">
	import '@fontsource-variable/archivo/wdth.css';
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { u } from '#lib/nav.js';
	import { formatDate } from '#lib/time.js';

	let { data, children } = $props();
	const links = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/history', label: 'History' },
		{ href: '/wrapped', label: 'Year in review' },
		{ href: '/discover', label: 'Discover', own: true },
		{ href: '/people', label: 'People', own: true },
		{ href: '/settings', label: 'Settings', own: true }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Spotify Trackerr</title>
</svelte:head>

{#if data.me}
	<header>
		<a class="brand" href="/">Trackerr</a>
		<nav>
			{#each links as l (l.href)}
				<a href={l.own ? l.href : u(l.href)} aria-current={active(l.href) ? 'page' : undefined}>{l.label}</a>
			{/each}
		</nav>
	</header>
	{#if data.viewing}
		<div class="banner view">
			Viewing {data.viewing}'s listening. <a href={page.url.pathname}>Back to mine</a>
		</div>
	{/if}
	{#if data.me.reauth}
		<div class="banner warn">Spotify sync stopped because the link expired. <a href="/auth/spotify?mode=link">Reconnect Spotify</a></div>
	{:else if data.me.spotifyLinked && data.me.expiringSoon && data.me.linkExpires}
		<div class="banner warn">
			Spotify ends this app's access on {formatDate(data.me.linkExpires, data.me.tz)}. <a href="/auth/spotify?mode=link">Reconnect Spotify</a> to keep syncing.
		</div>
	{/if}
{/if}

<main>
	{@render children()}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 28px;
		padding: 14px 28px;
		border-bottom: 1px solid var(--grid);
		flex-wrap: wrap;
	}
	.brand {
		font-weight: 800;
		font-stretch: 70%;
		font-size: 1.35rem;
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	nav a {
		padding: 6px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink-2);
	}
	nav a:hover {
		color: var(--ink);
		background: var(--surface);
	}
	nav a[aria-current] {
		color: var(--ink);
		background: var(--surface-2);
	}
	.banner {
		padding: 8px 28px;
		font-size: 0.9rem;
	}
	.banner.view {
		background: #1f2a3d;
	}
	.banner.warn {
		background: #3d2e12;
	}
	main {
		max-width: 1280px;
		margin: 0 auto;
		padding: 28px;
	}
	@media (max-width: 640px) {
		header,
		main {
			padding: 14px;
		}
	}
</style>
