# Demo screenshots

These PNGs are captured from the current production build. They use fictional artists, albums,
songs, artwork, people, listening history, cached recommendation picks, and concert venues. Last.fm and
ListenBrainz usernames are demo labels, not authenticated connections to those services.

The demo clock is fixed at October 29, 2026, with listening history across 2025 and 2026 so the
yearly discoveries, busiest day, and quietest listening day have data. Desktop images use a
1360 × 900 viewport; the phone image uses 390 × 844.

## Refresh

Use Node 22.22 or later with the project's installed dependencies:

```sh
npm ci
npx playwright install chromium
npm run screenshots
```

On Linux, Playwright may also need system libraries: `npx playwright install --with-deps chromium`.

[The capture script](../../scripts/screenshots.mjs) builds the app, starts a local server on an
available port, seeds a fresh database in the OS temporary directory, and replaces the PNGs here.
It clears inherited music-service credentials, blocks outbound requests in the demo server and
browser, and removes the temporary server and database when finished. Existing app data is not used.

The script checks page headings and the unchanged app title, genre lists, yearly highlights,
image loading, chart sizing, desktop horizontal overflow, and browser errors before reporting success.
The dashboard currently has horizontal overflow on narrow phone screens. The phone image preserves
the current layout, and the script reports that overflow without changing or hiding page content.
