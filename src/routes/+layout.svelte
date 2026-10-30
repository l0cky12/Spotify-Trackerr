<script lang="ts">
	import '@fontsource-variable/archivo/wdth.css';
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { u } from '#lib/nav.js';
	import { formatDate } from '#lib/time.js';
	import { openInApp } from '#lib/spotify-app.js';

	let { data, children } = $props();
	const links = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/history', label: 'History' },
		{ href: '/reports', label: 'Reports' },
		{ href: '/wrapped', label: 'Year in review' },
		{ href: '/discover', label: 'Discover', own: true },
		{ href: '/shows', label: 'Shows', own: true },
		{ href: '/playlists', label: 'Playlists', own: true },
		{ href: '/people', label: 'People', own: true },
		{ href: '/settings', label: 'Settings', own: true }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Spotify Trackerr</title>
</svelte:head>

<svelte:document onclick={openInApp} />

{#if data.me}
	<header>
		<a class="brand" href="/">Trackerr</a>
		<nav>
			{#each links as l (l.href)}
				<a href={l.own ? l.href : u(l.href)} aria-current={active(l.href) ? 'page' : undefined}>
					{l.label}{#if l.href === '/shows' && data.me.newShows}<span class="badge" title="{data.me.newShows} new shows near you">{data.me.newShows}</span><span class="sr-only"> new</span>{/if}
				</a>
			{/each}
		</nav>
	</header>
	{#if data.viewing}
		<div class="banner view">
			Viewing {data.viewing}'s listening. <a href={page.url.pathname}>Back to mine</a>
		</div>
	{/if}
	{#if data.me.spotify.needsReconnect}
		<div class="banner warn">Spotify sync stopped: this link can't be used any more. <a href="/auth/spotify?mode=link">Reconnect Spotify</a></div>
	{:else if data.me.spotify.linked && data.me.spotify.expiringSoon && data.me.spotify.expiresAt}
		<div class="banner warn">
			Spotify ends this app's access on {formatDate(data.me.spotify.expiresAt, data.me.tz)}. <a href="/auth/spotify?mode=link">Reconnect Spotify</a> to keep syncing.
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
	.badge {
		display: inline-block;
		min-width: 1.4em;
		margin-left: 5px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--series-1);
		color: var(--page);
		font-size: 0.72rem;
		font-weight: 700;
		text-align: center;
		line-height: 1.5;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
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
