import { expect, test } from '@playwright/test';

test('signed-out requests cannot read data or trust an unknown host', async ({ request }) => {
	const page = await request.get('/settings', { maxRedirects: 0 });
	expect(page.status()).toBe(303);
	expect(page.headers().location).toBe('/login');
	expect((await request.get('/api/search?q=song')).status()).toBe(401);
	expect((await request.get('/login', { headers: { Host: 'untrusted.example' } })).status()).toBe(421);
	const crossOrigin = await request.post('/login?/signup', {
		headers: { Origin: 'http://untrusted.example' },
		form: { username: 'untrusted-user', password: 'test-only-password' }
	});
	expect(crossOrigin.status()).toBe(403);
});

test('signup, import, permissions, logout, and login work in the production build', async ({ page, context, browser, baseURL }) => {
	await page.goto('/login');
	await page.getByLabel('Username', { exact: true }).fill('ci-admin');
	await page.getByLabel('Password', { exact: true }).fill('test-only-password');
	await page.getByRole('button', { name: 'Create account', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	expect((await context.cookies()).find((c) => c.name === 'session')).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'No listening history yet' })).toBeVisible();
	await page.goto('/settings?section=import');
	const historyFile = {
		name: 'Streaming_History_Audio_ci.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify([{
			ts: new Date(Date.now() - 60_000).toISOString(),
			ms_played: 180_000,
			master_metadata_track_name: 'CI Song',
			master_metadata_album_artist_name: 'CI Artist',
			master_metadata_album_album_name: 'CI Album',
			spotify_track_uri: 'spotify:track:ci-fixture'
		}]))
	};
	await page.locator('input[type=file]').setInputFiles(historyFile);
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByText('Added 1 plays.', { exact: true })).toBeVisible();
	await page.locator('input[type=file]').setInputFiles(historyFile);
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByText('Added 0 plays.', { exact: true })).toBeVisible();
	await page.goto('/history?range=all');
	await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'CI Song', exact: true })).toBeVisible();
	await page.goto('/?range=all');
	await expect(page.getByRole('heading', { name: 'No listening history yet' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Top songs' })).toBeVisible();

	await page.goto('/settings?section=admin');
	await page.getByLabel('Username', { exact: true }).fill('ci-reader');
	await page.getByLabel('Password', { exact: true }).fill('test-only-password');
	await page.getByRole('button', { name: 'Create user', exact: true }).click();
	await expect(page.getByRole('row').filter({ hasText: 'ci-reader' })).toBeVisible();
	const reader = await browser.newContext({ baseURL });
	try {
		const login = await reader.request.post('/login?/login', {
			headers: { Origin: baseURL!, Accept: 'text/html' },
			form: { username: 'ci-reader', password: 'test-only-password' },
			maxRedirects: 0
		});
		expect(login.status()).toBe(303);
		expect((await reader.request.get('/history?user=1')).status()).toBe(404);
		const adminAction = await reader.request.post('/settings?/adminSignup', {
			headers: { Origin: baseURL!, Accept: 'text/html' },
			form: { allow: 'on' },
			maxRedirects: 0
		});
		expect(adminAction.status()).toBe(303);
		expect(adminAction.headers().location).toBe('/settings');
	} finally {
		await reader.close();
	}
	await page.reload();
	await expect(page.getByRole('checkbox', { name: 'Anyone can create an account with a username and password' })).not.toBeChecked();

	await page.goto('/settings?section=account');
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL(/\/login$/);
	expect((await context.cookies()).find((c) => c.name === 'session')).toBeUndefined();
	expect((await page.request.get('/api/search')).status()).toBe(401);
	await page.getByLabel('Username', { exact: true }).fill('ci-admin');
	await page.getByLabel('Password', { exact: true }).fill('wrong-password');
	await page.getByRole('button', { name: 'Log in', exact: true }).click();
	await expect(page.getByText("That username and password don't match.", { exact: true })).toBeVisible();
	await page.getByLabel('Password', { exact: true }).fill('test-only-password');
	await page.getByRole('button', { name: 'Log in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Your listening', exact: true })).toBeVisible();
});
