import { test, expect } from 'vitest';
import { appUri } from './spotify-app.js';

test('open.spotify.com links map to the desktop app address', () => {
	expect(appUri('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('spotify:track:4uLU6hMCjMI75M1A2tKUQC');
	expect(appUri('https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF?si=abc')).toBe('spotify:artist:0OdUWJ0sBjDrqHygGUXeCF');
	expect(appUri('https://open.spotify.com/album/1A2GTWGtFfWp7KSQTwWOyo')).toBe('spotify:album:1A2GTWGtFfWp7KSQTwWOyo');
	expect(appUri(`https://open.spotify.com/search/${encodeURIComponent('Band of Horses Everything All the Time')}`)).toBe(
		'spotify:search:Band%20of%20Horses%20Everything%20All%20the%20Time'
	);
});

test('other links are left alone', () => {
	expect(appUri('https://www.spotify.com/account/privacy/')).toBeNull();
	expect(appUri('https://developer.spotify.com/dashboard')).toBeNull();
	expect(appUri('https://open.spotify.com/embed/track/abc')).toBeNull();
	expect(appUri('http://open.spotify.com.evil.example/track/abc')).toBeNull();
	expect(appUri('/track/12')).toBeNull();
});
