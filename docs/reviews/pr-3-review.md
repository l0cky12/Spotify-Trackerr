# PR #3 review

## Fixes applied after review

The historical findings below refer to `d5a86d7`. The follow-up fixes bind sign-in to the initiating Trackerr account, reject invalid identities and seed names, clear obsolete ListenBrainz tokens, check Last.fm lifetime play counts for candidate music, preserve local artwork, match and cache Deezer artwork, share provider pacing/backoff with background enrichment, and bound network requests to ten seconds. Linking/unlinking invalidates picks; source checks also prevent an in-flight refresh from restoring picks for the wrong connection. Failed refreshes preserve prior picks. Covers now track the failed source rather than suppressing every later image.

Validation of the fixes: **25 tests passed**, `npm run check` reported **0 errors and 0 warnings**, and `npm run build` passed. A headless Chromium check verified a failed cover followed by a valid source renders the valid image. The collaborative browser was explicitly unavailable, so the browser check used the already-installed Playwright outside the repository. No production dependency was added. A real Last.fm sign-in remains untested without real credentials.

The fixed regression suite is `src/lib/server/recs.review.test.ts`. The reproduction artifact below is retained as historical evidence and is intended to run against the original pinned head, not the fixed code.

## Original review

**Recommendation: request changes before merging.** The review found eight reproduced problems and one additional UI defect traced through the code. None of the reproduced cases demonstrates remote account takeover, arbitrary SQL execution, or stored script execution. The security findings concern account association and retention of obsolete credentials.

Reviewed [PR #3](https://github.com/l0cky12/Spotify-Trackerr/pull/3) on 2026-10-02:

- Head: `d5a86d7116679f07a575cb60bc6b7436413838f7`.
- Base: `b547f6cae11e4676ad1473defd11daedd6867e67` — PR #2's head, rather than `main`.
- Comparison: `git diff b547f6cae11e4676ad1473defd11daedd6867e67...d5a86d7116679f07a575cb60bc6b7436413838f7`.
- Commit: `d5a86d7 Discover: artist, album and song shelves from Last.fm, with Last.fm sign-in`.
- Scope: all 13 changed files, 401 additions and 188 deletions, plus relevant callers and shared infrastructure.

The Standards and Spec reviews were conducted independently and remain separate below. Security and runtime findings have their own section. Repeated observations across sections refer to the same defects, not additional findings. P2 means a substantive defect to fix; P3 means a lower-impact defect or hardening gap.

## Security and runtime correctness

### R1 — P2: Last.fm linking is not bound to the initiating Trackerr account

**Location:** [auth start, line 11](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/auth/lastfm/+server.ts#L11), [callback, line 19](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/auth/lastfm/callback/+server.ts#L19).

The state cookie contains a random nonce but no initiating Trackerr user ID. The callback validates the nonce and then writes to whichever `locals.user.id` is currently signed in. Starting a link as Alice, switching the Trackerr session to Bob in another tab, and completing Alice's original Last.fm flow attaches Alice's Last.fm username to Bob.

**Evidence:** an executable check starts the real route with user 1 and invokes the real callback with user 2 and the original state. User 2 ends up with `alice-fm`.

**Impact:** unintended cross-account association on shared browsers or during account switching. This does not give access to Alice's Trackerr account or persist Last.fm session credentials; an attacker without the correct nonce was not shown to bypass state validation.

**Small fix:** store the initiating user ID alongside the nonce and reject completion if the current user differs. Keep the current expiry, one-use cookie handling, and state check.

### R2 — P2: Removing ListenBrainz leaves its plaintext credentials in upgraded databases

**Location:** [migration, lines 122–124](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/db.ts#L122), [replacement Settings action, line 89](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/settings/+page.server.ts#L89).

Changing the `CREATE TABLE` definition does not remove the old `listenbrainz_token` column. The only migration adds `lastfm_user`. An existing ListenBrainz token therefore remains in plaintext, while the Settings action and button for removing it disappear.

**Evidence:** start with a database containing `listenbrainz_token = 'obsolete-secret'`, import the real new database module, and read the migrated row. The old secret remains; `lastfm_user` has been added.

**Impact:** unused credentials remain exposed to anyone who later obtains a readable database or backup, and users lose the existing removal control. This finding does not imply the new HTTP routes expose the database.

**Small fix:** add a migration that clears legacy token values when that column exists. Removing the column can be a separate schema decision; the necessary change is to stop retaining obsolete secrets in the active database.

### R3 — P2: Deezer fallback accepts artwork from unrelated search results

**Location:** [recs.ts, lines 93–97](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/recs.ts#L93).

The new fallback searches free text with `limit: '1'` and accepts `data[0]` without comparing artist, track, or album names. A fuzzy match for a different artist or release supplies its artwork to the recommendation. The existing enrichment code already compares normalized artist/title/album keys before using results.

**Evidence:** provide `New Band / Fresh` as the Last.fm recommendation and return `Unrelated Artist / Wrong Song` as Deezer's first search result. Discover displays the unrelated artist photo and song cover.

**Small fix:** reuse the existing normalized-name matching approach. Examine enough candidates to find a real match; retain the placeholder when no match exists.

### R4 — P2: Serial artwork requests do not enforce the claimed Deezer quota

**Location:** [recs.ts, lines 173–174](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/recs.ts#L173), [background enrichment](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/jobs.ts#L33).

The comment says that processing searches one at a time stays below 50 requests per five seconds. A full refresh can make 12 artist + 12 album + 30 song searches. There is no elapsed-time throttle, coordination between simultaneous refreshes, or coordination with background enrichment. Serial requests can still exceed the claimed quota when responses are quick. Quota responses become missing images rather than triggering the existing enrichment backoff.

**Evidence:** the real builder made 54 mocked Deezer requests in 3 ms. The timing is synthetic: it proves the implementation has no rate enforcement, not that live Deezer responds that quickly. Multiple users and background jobs can increase the shared request rate further.

**Small fix:** coordinate requests against the same quota, handle quota responses with backoff, and avoid refetching unchanged artwork. These new fetches also lack an abort deadline; add a bounded request timeout so one stalled artwork response cannot hold a refresh indefinitely.

### R5 — P3: A malformed Last.fm identity is saved as a successful connection

**Location:** [recs.ts, line 22](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/recs.ts#L22), [callback update, line 19](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/auth/lastfm/callback/+server.ts#L19).

`String(r.session.name)` converts an absent name into the literal string `"undefined"`. A `{ session: {} }` response is accepted, persisted, and followed by the success redirect. The resulting account looks connected but uses an invalid username for later lookups. Empty or non-string names are similarly unchecked.

**Evidence:** the real callback, with a valid nonce and mocked `{ session: {} }` response, changes the user's stored Last.fm name to `"undefined"`.

**Small fix:** require a nonempty string name and reject malformed success responses before changing the database. This is a robustness and boundary-validation defect, not demonstrated login privilege escalation.

## Standards

Reviewed all 13 changed files and relevant callers. No repository `CODING_STANDARDS.md`, `CONTRIBUTING.md`, or tracked `AGENTS.md` was found. The supplied Context7 instructions exclude code review from mandatory documentation lookup. The session's [Ponytail skill](/home/liam/.codex/plugins/cache/ponytail/ponytail/4.10.0/skills/ponytail/SKILL.md) provides the validation and runnable-check rules; existing repository patterns override generic smell judgments.

**Documented-standard breaches / coverage gaps**

- `src/lib/server/recs.ts:22`: `return String(r.session.name)` skips identity validation at an external API boundary. A `{ session: {} }` response becomes the saved username `"undefined"`. Ponytail explicitly preserves input validation at trust boundaries. Validate a nonempty string before updating the account. Reproduced as R5.
- `src/lib/server/recs.ts:136–137`: `String(x.name)` similarly turns malformed Last.fm seed records into `"undefined"` rather than rejecting them. Validate artist/title fields before generating recommendations. This observation is code-traced; the reproduction suite does not test malformed seed records.
- The new authentication routes have no executable callback/state check in the PR's own tests. `recs.test.ts:15–17` tests signature calculation but not nonce rejection, account switching, cancellation, or database updates. The session requires a runnable check for nontrivial security logic. The review added external reproduction checks; these are not already part of PR #3.

**Code-quality judgments**

- `src/lib/server/recs.ts:93–97`: `data?.[0]` creates another Deezer search pipeline while omitting the canonical artist/song/album matching already present in `enrich.ts`. This is a possible **Duplicated Code** smell with a reproduced consequence: unrelated results supply wrong artwork. Reuse the matching approach without introducing a new abstraction.
- `src/lib/server/recs.ts:173–174`: the comment promises “one at a time to stay under Deezer's 50 per 5 s,” but sequential execution does not enforce a rate limit. A refresh can make 54 searches alongside background enrichment; existing quota handling is bypassed. Reproduced as R4.

No additional strong Fowler smells justify restructuring this small implementation. The loose `Row` type, compact helpers, native forms, and shared artwork component follow existing patterns.

## Spec

Requirements source: the PR description and its commit message. No originating issue or separate spec was identified. `docs/agents/issue-tracker.md` is absent; the code-review skill recommends `/setup-matt-pocock-skills` to configure that workflow. This review uses the available PR requirements without blocking on setup.

1. **S1 — P2: Last.fm listening history is excluded from “already played” filtering** — [recs.ts:150–156](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/recs.ts#L150). Requirement: “Anything the user has already played is left out.” `heardArtists` includes only five Last.fm seed artists plus local plays; `heardSongs` includes only local plays, omitting even Last.fm seed songs. A user without imported local history can receive already-scrobbled songs, including a top seed song returned by another seed's similar list. Previously heard Last.fm artists outside the five seeds, and their albums, also remain eligible. **Reproduced:** a returned recommendation named `Already Scrobbled`, also present in the mocked user's top tracks, remains in the song shelf. At minimum exclude seed songs; fulfilling the broader promise requires checking candidates against the connected user's listening history.

2. **S2 — P2: Last.fm album covers override library artwork** — [recs.ts:52](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/server/recs.ts#L52). Requirement: “Covers: taken from the library first, then Last.fm (albums), then Deezer.” `topAlbum()` supplies Last.fm artwork, then `localize()` evaluates `r.image ?? al?.image`, so Last.fm wins over the library. **Reproduced:** a shared-library album with `/img/custom.png` as its override links correctly to the local album but shows Last.fm artwork. Reverse the precedence.

3. **S3 — P2: Cached picks survive connecting, switching, or unlinking Last.fm** — [unlink action:89–92](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/settings/+page.server.ts#L89), [callback:19](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/auth/lastfm/callback/+server.ts#L19), [Discover load:8–12](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/discover/+page.server.ts#L8). Requirement: “If a user is signed in, Discover starts from their Last.fm top artists and songs … If not, it uses what they've played here.” Account changes update only `lastfm_user`; saved shelves remain cached indefinitely and are labeled using the current connection. **Reproduced:** unlink leaves `picks.fromLastfm === true` while the page's username is null; linking `bob-fm` leaves the prior account's picks. Invalidate Discover's cache when the connection changes.

The remaining described changes are present. The added test covers local play exclusion but misses Last.fm history, local cover precedence, and source changes.

## Additional UI finding

### U1 — P3: Refreshing recommendations can preserve a previous item's failed-cover state

**Location:** [index-keyed shelf, Discover:69](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/routes/discover/+page.svelte#L69), [shared Cover state:3–15](https://github.com/l0cky12/Spotify-Trackerr/blob/d5a86d7116679f07a575cb60bc6b7436413838f7/src/lib/components/Cover.svelte#L3).

The new shelf keys items by array index. `Cover` keeps a `failed` flag after an image error and never resets it when its `src` changes. If a failed image occupies slot 0, a later refresh can reuse that component for a different recommendation with a valid image; it continues rendering a placeholder. The PR introduces this interaction by putting the stateful component in an index-keyed shelf.

**Evidence level:** traced through both components, not browser-reproduced. The collaborative preview could not connect to the isolated test server (`net::ERR_CONNECTION_REFUSED`), so this is separate from the eight executable reproductions.

**Small fix:** key recommendations by stable artist/track/album identity, or reset the cover error state when its source changes. The source-reset approach also handles artwork changing for the same recommendation.

## Security controls checked

- Missing state, mismatched state, cancellation, and anonymous callbacks all redirected before any mocked Last.fm request or database update. Four executable checks passed.
- State uses 16 random bytes, an HttpOnly/SameSite=Lax cookie, a ten-minute expiry, HTTPS-dependent `secure`, and deletion before completion. The missing binding to the initiating user is R1.
- New account writes use parameterized SQL. New links either use fixed service origins with encoded values or numeric local database IDs. User-facing text is rendered through Svelte text interpolation; no new raw HTML rendering was introduced.
- The Last.fm shared secret remains in server code. The returned Last.fm session key is not persisted; the new account field stores only the username.
- Authentication hooks protect Discover and Settings. Both public Last.fm routes independently check for a signed-in Trackerr user.
- Removing playlist creation also removes its caller and requested Spotify scope. No remaining `savePlaylist`, `playlist-modify-private`, or ListenBrainz runtime references were found in the PR snapshot. Already-issued Spotify grants are not revoked by changing future requested scopes.

These checks support the specific conclusions above; they are not a guarantee that the application has no other security defects. Pre-existing weaknesses outside the PR were not relabeled as new findings.

## Validation and reproduction artifacts

Validation ran in an isolated archive of the pinned head under Node `v22.22.3`, using a private copy of the existing installed dependencies. No live user database, credentials, account links, or external playlists were modified.

| Check | Result |
|---|---|
| PR's original `npm test` | 2 test files, 5 tests passed |
| `npm run check` | 0 errors, 0 warnings |
| `npm run build` | Passed, including adapter-node output |
| Review reproduction suite | 8 observed defective behaviors reproduced; 4 negative callback-security checks passed |
| Live Last.fm approval/token exchange | Not tested; no real credentials used |
| Interactive browser check | Could not run: shared preview could not reach isolated server |

An initial type check with symlinked dependencies failed because generated type paths resolved against the other workspace. Copying dependencies into the isolated snapshot resolved that harness problem; the clean check above is the relevant result.

The review suite is saved beside this report as [pr-3-reproductions.ts](pr-3-reproductions.ts). Its eight reproduction tests **assert the observed bad behavior**, so a passing run confirms the findings; it does not mean the desired behavior works. After fixing the PR, turn those assertions into regression checks for the desired outcomes.

To run against the pinned code from a repository checkout containing these review artifacts:

```bash
repo_dir=$PWD
review_dir=$(mktemp -d /tmp/spotify-pr3-reproduce-XXXXXX)
git archive d5a86d7116679f07a575cb60bc6b7436413838f7 | tar -x -C "$review_dir"
cp "$repo_dir/docs/reviews/pr-3-reproductions.ts" "$review_dir/src/lib/server/pr3-review.test.ts"
cd "$review_dir"
npm ci
npm exec vitest run src/lib/server/pr3-review.test.ts -- --reporter=verbose
```

All network responses in that suite are mocked, and it creates its own temporary SQLite database. It never requires real Last.fm or Deezer credentials.

## Changed-file coverage

| Changed file | Review coverage |
|---|---|
| `.env.example` | Last.fm secret configuration and ListenBrainz removal |
| `README.md` | Setup instructions and feature claims |
| `src/lib/server/db.ts` | New and existing databases, legacy credential retention, schema constraints |
| `src/lib/server/enrich.ts` | Exported picture helper and existing matching/quota patterns |
| `src/lib/server/recs.test.ts` | Assertions, fixture scope, missing failure cases |
| `src/lib/server/recs.ts` | Every new helper, all branches of localization, seed selection, filtering, interleaving, covers, cache compatibility, and callers |
| `src/lib/server/spotify.ts` | Scope reduction and removed playlist function/callers |
| `src/routes/auth/lastfm/+server.ts` | Authentication guard, configuration guard, nonce, cookie, redirect construction |
| `src/routes/auth/lastfm/callback/+server.ts` | State, cancellation, anonymous access, token exchange, identity validation, account binding, writes |
| `src/routes/discover/+page.server.ts` | Authorization through hooks, serialized data, refresh failures, cache/source behavior |
| `src/routes/discover/+page.svelte` | Shelf rendering, links, image state, refresh state, grid/scroll styling |
| `src/routes/settings/+page.server.ts` | Last.fm data exposure, unlink action, removal of token controls |
| `src/routes/settings/+page.svelte` | Connected/unconfigured states, encoded profile links, unlink form, setup visibility |

Supporting reads included session authentication, hooks, SQL/cache helpers, ingestion keys, artwork overrides, background jobs, production host handling, shared Cover/RecList components, and artist/track recommendation callers. The head and base were rechecked at the end and had not changed. Only the report and reproduction artifact were added to the user's workspace; the PR implementation was not edited.

Standards: 3 boundary/coverage gaps and 2 code-quality judgments; strongest boundary issue is unchecked Last.fm identity. Spec: 3 requirement failures; largest functional failure is recommending already-scrobbled music. Security/runtime: 5 additional reproduced findings; account association and obsolete credential retention are the security concerns.
