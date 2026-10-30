# Spotify Trackerr

Self-hosted listening stats: each person's Spotify plays, synced and imported, shown as dashboards, history, and recommendations.

## Language

### Connections

**Connection**:
A person's link to an outside music account (their Spotify account, their Last.fm username), plus the credentials and status that come with it.
_Avoid_: integration, account (reserved for the person's login here), link (as a noun on its own)

**Own app**:
A Spotify developer app a person registers themselves and links through, instead of the server app.
_Avoid_: custom app, personal client

**Server app**:
The Spotify or Last.fm developer app the server admin configures for everyone.
_Avoid_: default app, shared client

**Needs reconnect**:
The state of a Spotify Connection whose saved credentials can no longer be used (Spotify revoked them, the own app was removed, or the server's key changed); the person must link again.
_Avoid_: reauth, expired, broken

### Plays and reports

**Play**:
One listen of a song by one person: which song, when it ended, how long it ran, and whether it came from an import or a sync. Every stat is counted from plays, so fixing a play (its song or its time) fixes every page.
_Avoid_: scrobble, listen (as a noun), stream

**Ban**:
A song, album or artist a person chose to hide. Their plays of it stay saved but are left out of every stat, list, chart, history page, search and recommendation until they unban it. A ban is the owner's: it hides their own plays from anyone looking, and someone else's plays of the same artist still count for that person.
_Avoid_: block, mute, hide (as the feature's name), blacklist

**Report**:
A person's listening for one calendar month or year, with the change from the period before.
_Avoid_: recap, summary, wrapped (that's the Year in review page)

**Template**:
A saved recipe for a Spotify playlist built from a person's own plays (top songs of a period, an artist as first heard, on this day across the years).
_Avoid_: preset, generator, smart playlist

### Shows

**Watched artist**:
An artist a person wants to hear about concerts for. Private to that person, and independent of whether they've played the artist here.
_Avoid_: favorite, followed (Spotify's own follow), monitored, tracked

**Show**:
One upcoming concert by a watched artist (date, venue, city) that the person's AI assistant found and saved. It's "new" until the person opens the Shows page. Same artist, date and city means the same show.
_Avoid_: event, gig, concert (as the feature's name), alert

**Access key**:
A secret a person makes in Settings so an AI assistant can use this server's MCP endpoint as them. Only its hash is stored, and it can be revoked.
_Avoid_: API token, PAT, password
