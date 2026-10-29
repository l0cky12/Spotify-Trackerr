import { syncAll } from './spotify.js';
import { deezerStep, itunesStep, genreStep, retryGenresWithLastfm } from './enrich.js';

/** A loop that runs `step` every `ms`, never overlapping itself, and logs instead of crashing. */
function every(ms: number, step: () => Promise<unknown>) {
	let busy = false;
	setInterval(async () => {
		if (busy) return;
		busy = true;
		try {
			await step();
		} catch (e) {
			console.error('job failed:', e);
		} finally {
			busy = false;
		}
	}, ms).unref();
}

export function startJobs() {
	const g = globalThis as { __trackerrJobs?: boolean };
	if (g.__trackerrJobs) return;
	g.__trackerrJobs = true;

	retryGenresWithLastfm();

	setTimeout(() => syncAll().catch((e) => console.error('sync failed:', e)), 5000).unref();
	every(5 * 60_000, syncAll);
	// Deezer allows 50 requests / 5 s; one song costs 1-3 requests, so 2.5 songs/s stays under.
	every(400, deezerStep);
	every(3500, itunesStep);
	every(1500, genreStep);
}
