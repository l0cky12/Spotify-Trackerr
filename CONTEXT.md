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
