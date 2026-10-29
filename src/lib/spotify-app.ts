// How long a click on a Spotify link waits for the desktop app before opening the web page instead.
export const APP_WAIT_MS = 1500;

/** The desktop app's spotify: address for an open.spotify.com link, or null for any other link. */
export function appUri(href: string): string | null {
	const m = /^https:\/\/open\.spotify\.com\/(track|album|artist|playlist|search)\/([^/?#]+)/.exec(href);
	return m ? `spotify:${m[1]}:${m[2]}` : null;
}

/**
 * Click handler for the whole page: a plain click on a Spotify link opens the desktop app instead of a tab.
 * Browsers can't tell a page whether the app is installed, but opening it (or the browser asking first) takes
 * focus from the page; if the page still has focus after a moment, there's no app, so the link opens on the web.
 * Modified clicks, and phones (which already hand open.spotify.com links to the app), keep the normal link.
 */
export function openInApp(e: MouseEvent) {
	if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
	if (matchMedia('(pointer: coarse)').matches) return;
	const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
	const uri = a && appUri(a.href);
	if (!a || !uri) return;
	e.preventDefault();
	let left = false;
	const leave = () => (left = true);
	window.addEventListener('blur', leave);
	document.addEventListener('visibilitychange', leave);
	location.href = uri;
	setTimeout(() => {
		window.removeEventListener('blur', leave);
		document.removeEventListener('visibilitychange', leave);
		if (!left) window.open(a.href, '_blank', 'noopener');
	}, APP_WAIT_MS);
}
