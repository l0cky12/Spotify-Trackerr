import { expect, test, type Page } from '@playwright/test';

// The login page uses the app layout, so its page-wide Spotify link handler runs without signing in.
async function spotifyLink(page: Page) {
	await page.context().route('https://open.spotify.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'Spotify web player' }));
	await page.goto('/login');
	await page.evaluate(() => {
		const a = Object.assign(document.createElement('a'), { href: 'https://open.spotify.com/artist/ci-artist', target: '_blank', rel: 'noopener', textContent: 'Open in Spotify' });
		document.body.prepend(a);
	});
	return page.getByRole('link', { name: 'Open in Spotify' });
}

test('a Spotify link falls back to the web when no desktop app opens', async ({ page, context }) => {
	const link = await spotifyLink(page);
	const opened = context.waitForEvent('page');
	const clicked = Date.now();
	await link.click();
	const web = await opened;
	expect(Date.now() - clicked).toBeGreaterThanOrEqual(1000);
	await expect(web).toHaveURL('https://open.spotify.com/artist/ci-artist');
	await expect(page).toHaveURL(/\/login$/);
});

test('a Spotify link opens no web tab once the desktop app takes focus', async ({ page, context }) => {
	const link = await spotifyLink(page);
	const tabs: Page[] = [];
	context.on('page', (p) => tabs.push(p));
	await link.click();
	// What the browser's "Open Spotify?" prompt or the app itself does to the page.
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await page.waitForTimeout(2500);
	expect(tabs).toHaveLength(0);
	await expect(page).toHaveURL(/\/login$/);
});

test('modified clicks on a Spotify link keep the browser default', async ({ page }) => {
	const link = await spotifyLink(page);
	// Window listeners run after the page-wide handler on document, so they see whether it took over the click.
	await page.evaluate(() => {
		addEventListener('click', (e) => {
			(window as any).taken = e.defaultPrevented;
			e.preventDefault();
		});
	});
	for (const modifiers of [['ControlOrMeta'], ['Shift'], ['Alt']] as const) {
		await link.click({ modifiers: [...modifiers] });
		expect(await page.evaluate(() => (window as any).taken), modifiers.join('+')).toBe(false);
	}
});
