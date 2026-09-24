# WatchParty

Synced watch parties that run in any browser, phones included, for YouTube and
self-hosted video. One Spring Boot backend serves both this web client and the
existing Chrome extension, which keeps its single job: DRM platforms on desktop.

```
Next.js 16 (web client)  --+
                           +--> Spring Boot 3.5 --+--> Supabase (Postgres)  durable: accounts, rooms, membership, chat
Chrome extension (DRM)   --+     REST + STOMP/WS  +--> Redis 7              hot: playback state, presence, fan-out, limits
```

## Running it

```bash
cp .env.example .env
```

Fill in three things:

1. **`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`** — your Supabase
   project's **Session pooler** connection (Connect → Session pooler, port 5432),
   rewritten as JDBC: `jdbc:postgresql://aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require`,
   user `postgres.PROJECT_REF`. The schema is created on first start.
2. **`REDIS_PASSWORD`** and **`JWT_SECRET`** — `openssl rand -base64 48` each.
3. **`YOUTUBE_API_KEY`** (optional) — a YouTube Data API v3 key. It turns on
   in-app search; without it the picker still works by pasting a link.

```bash
docker compose up -d --build
```

No Supabase project yet? Run the bundled Postgres instead — set
`DATABASE_URL=jdbc:postgresql://postgres:5432/watchparty`, `DATABASE_USER=watchparty`
and `DATABASE_PASSWORD` equal to `POSTGRES_PASSWORD`, then start with
`docker compose --profile local-db up -d --build`. Nothing else changes: Supabase
is plain Postgres to the application.

To run the backend outside Docker (an IDE, `mvn spring-boot:run`), copy
`backend/.env.local.example` to `backend/.env.local`; it is gitignored and read
on startup.

- Web client: http://localhost:3000
- API and OpenAPI: http://localhost:8080/swagger-ui.html
- Behind TLS instead: `SITE_ADDRESS=your.domain docker compose --profile proxy up -d`

Postgres and Redis publish no ports at all; the backend and web ports are bound to
loopback for development and should be dropped once the proxy fronts them.

## Watching it in production

```bash
docker compose --profile observability up -d
```

Grafana on http://localhost:3001 (admin / `GRAFANA_PASSWORD`) opens on a
provisioned "WatchParty overview" dashboard. Prometheus scrapes
`/actuator/prometheus` over the compose network; neither it nor the actuator is
reachable from outside. The panel to watch is drift corrections by tier:
clients reaching the seek or resync tier often means the clock sync or the
network assumptions are wrong. Each resync is also logged as a sync defect.

## Verifying it actually syncs

```bash
cd frontend && npm run smoke
```

Drives two real STOMP sessions against a running stack and checks the paths that
matter: the picker and link resolution, room creation, ticket handshake, clock
probes, fan-out, sequence assignment, seek clamping, locked-room rejection,
mid-room video changes, chat and presence, reactions and typing, the queue,
host hand-off, mute, removal (including the server closing the socket) and
the metrics endpoint.

To prove a room works across app instances -- the thing an in-JVM broker gets
silently wrong -- run a second backend and split the clients across them:

```bash
docker compose run -d --name wp-backend-2 -p 127.0.0.1:8081:8080 backend
cd frontend && WP_API_A=http://localhost:8080 WP_API_B=http://localhost:8081 npm run smoke
docker rm -f wp-backend-2
```

## The "+" flow

Everything starts from one button. Tapping it opens a sheet of sources; tapping
YouTube opens YouTube *inside the app*; tapping a result creates the room and
drops you straight into it with a link to share.

The thing worth knowing: **a page cannot iframe youtube.com.** It sends
`X-Frame-Options`, so there is no way to render the real site in a panel. So
"YouTube in the app" is built the way Rave builds it — the backend queries the
Data API and the app renders the results itself, and only the *player* is
embedded, which the IFrame API does permit.

That has three consequences the code reflects:

- **The API key lives on the server.** `/api/v1/catalog/youtube/search` proxies
  it, so the key never reaches a browser and cannot be lifted from the bundle.
- **Results are cached in Redis for ten minutes.** One search costs 100 quota
  units against a default 10,000 per day, so an uncached search box would burn a
  project's daily allowance in about a hundred keystrokes.
- **No key is not an error.** `/catalog/sources` reports `browsable: false`, the
  search box is replaced by a paste field, and link resolution runs through
  oEmbed, which needs no key at all. The whole product still works.

The same sheet is the host's "change the video" control inside a room. Picking a
new video resets the anchor — everyone lands at zero, paused — and every member
gets both the new source and a fresh playback event, so nobody is left watching
the old one.

## How the sync engine works

Broadcasting "play at 00:14:32" does not work, because every client has a
different clock, round trip and buffer state. The server instead holds a
projection that clients evaluate against their own corrected clock.

**Clock.** On connect and every 30s after, the client runs five probes of the
three-timestamp exchange -- it sends t0, the server stamps t1, the client notes
t2 -- and keeps `offset = t1 - (t0 + t2) / 2` from the probe with the *lowest*
round trip. One congested probe ruins an average; the fastest probe is the one
least distorted by queueing.

**Projection.** Room state is a position anchored to a server timestamp, never a
live counter, so any client computes `position + (now - anchor) * speed` for
itself. A joiner needs one read and no replay of history.

**Ladder.** Every second a client compares where it is against the projection.
The correction stays gentler than the error until it cannot be:

| Drift | Correction |
| --- | --- |
| under 250 ms | none -- a correction is more noticeable than the error |
| 250 ms to 2 s | playback rate to 0.97 or 1.03 until caught up, then restore |
| over 2 s | hard seek to the projection |
| over 30 s | full resync, logged as a defect |

YouTube is the exception that table hides: its player snaps any rate outside its
own published list, so `PlayerHandle.fineRateSupported` is false there and a
coarser ladder applies (0.75/1.25, seeking from 1 s). A video element the page
owns takes the fine ladder as written. See `frontend/src/lib/player.ts`.

**Ordering.** The server assigns a monotonic per-room sequence at the moment it
accepts an event, inside the same Redis script that writes the new state.
Clients discard anything not greater than the last sequence they applied. That
one rule absorbs out-of-order delivery, duplicates from a reconnect, and two
members seeking at the same instant -- the server serializes them, the later
sequence wins, and everyone converges with no negotiation round.

A client's reported position is never authority. A seek carries what the member
is *asking for*; the server validates it against the media duration, re-stamps
it with its own clock and only then writes state. Position reports on the
heartbeat are telemetry, and drive the host's "N members behind" indicator.

## Data model on Supabase (Postgres)

Six tables: `app_user`, `refresh_token`, `room`, `room_member`,
`chat_message`, `playback_event`. The schema is versioned SQL in
`backend/src/main/resources/db/migration`, applied by Flyway on startup, and
Hibernate checks the entities against it (`ddl-auto=validate`).

**Its own schema, with row level security on.** Supabase publishes the
`public` schema through an auto-generated REST API reachable with the
project's anon key. The tables live in a `watchparty` schema instead, and every
table has RLS enabled with no policies, so that API could read nothing even if
the schema were exposed. The backend connects as the owner and is unaffected.

**Constraints worth knowing:**

- `room.room_code` unique **only where `active`** (a partial index), so closing
  a room hands its code back for reuse
- `room.invite_token` unique
- `room_member` unique on `(room_id, user_id)` and `(room_id, guest_id)`; a
  check constraint enforces exactly one of the two
- foreign keys with `on delete cascade` from members, chat and playback events
  to their room
- `chat_message (room_id, created_at desc)` matching how chat pages backwards

**Every write to a room row takes the row lock** (`SELECT ... FOR UPDATE` in a
short transaction). Host edits, queue advances reported by any member and the
30-second snapshot all touch that row, and taking turns on the lock is what
stops one from undoing another. Host transfer changes both member rows and the
room in one transaction. The queue is a `jsonb` column on the room.

**The author's name lives on the message**, as the video's title and thumbnail
live on the room: a sent message keeps the name it was sent under, and a room
tile renders without re-resolving the link.

Expired refresh tokens are deleted by the nightly retention job (Postgres has
no TTL index). On Supabase's free plan a project pauses after a week without
traffic; it resumes from the dashboard.

## Email verification

A new account gets one email carrying **both** a six-digit code and a link, and
signing up lands on the code screen. Two routes exist because they fail in
different places: a link opened on a phone often lands in a browser that is not
signed in, and a code typed on a laptop beats switching apps.

Using either is what unlocks **hosting** — and only hosting. Joining as a guest
needs no account at all, so an invited friend is never asked to check their
inbox, and an unverified account can still watch, chat and react in someone
else's room. Google accounts arrive verified, because Google has already proven
the address.

Both point at one row, so spending either retires the other, and asking for a
new email retires both. The link is 256 random bits and the code is six digits,
each stored only as a SHA-256 hash. Six digits is a small space, so the row
also counts wrong tries and dies after six of them — a fresh code has to be
asked for. The link needs no session; the code is redeemed by the account that
asked for it. Everything expires in `VERIFICATION_TTL` (24h), and the nightly
retention job clears spent rows.

**With no `SMTP_HOST` set, nothing is held back.** The mail is written to the
backend log instead, so a development machine needs no mail account and no one
is locked out of their own laptop. `VERIFICATION_REQUIRED` overrides that in
either direction.

## Authorization model

A valid token says who the caller is. It never says what they may do in a room:
every room operation resolves a `room_member` row and checks its role. Four
credentials, each with one job:

| Token | Lifetime | Stored in |
| --- | --- | --- |
| Access JWT | 15 min | memory only |
| Refresh token | 30 days, rotating, reuse-detected | HttpOnly Secure cookie, hashed at rest |
| Guest token | room lifetime, 24 h max | local storage, scoped to one room |
| WebSocket ticket | 30 s, single use | memory only |

The ticket exists because a browser cannot set headers on a WebSocket
handshake, and the usual workaround puts the JWT in the query string -- where it
lands in load balancer logs, proxy logs and browser history.

**The room code alone is enough to join.** Type it on the home screen, give a
name, and you are in: no invite link needed. Invite links (a 128-bit token)
still work and are what the host's share button hands out. Codes are short and
typed by hand, so they can be guessed; what keeps that slow is a per-IP limit
on looking a code up (20 a minute) and on guest passes (10 a minute). Removal
is the backstop for someone who guesses their way in.

## What is in place

- A "+" that opens a source sheet, an in-app YouTube browser, and one tap from
  a search result to a running room
- Guest join with no account and no install: name, one tap, watching
- YouTube (IFrame API), direct MP4/WebM/HLS, Vimeo; DRM rooms join for chat only
- Synced play, pause, seek and rate with the drift ladder above
- Text chat with history paging, 500-character cap, host mute
- Emoji reactions that float over everyone's video, and typing indicators
- A queue: the host adds, reorders and removes videos; when one ends the next
  plays for everyone, or the host skips ahead
- Host controls: change what is playing from the same picker, lock playback,
  transfer host, remove or mute a member, rotate the invite, close the room
- Host failover: a host who drops keeps the room for a grace period, then it
  passes to the longest-standing registered member still watching
- Removing a member closes their sockets server-side, on whichever instance
  holds them; a muted member cannot chat, react or show as typing
- Email/password and Google sign-in; a guest who registers mid-room keeps their
  seat, because the member row is rebound rather than duplicated
- Email verification by six-digit code or link, and hosting waits for it
- Redis-backed rate limits, shared across instances, keyed per surface
- Redis fan-out, so two members on different app instances see each other
- 30-second state snapshots to Postgres, rooms that close ten minutes after
  everyone leaves, 24h expiry, 30-day chat retention job
- Prometheus metrics and a Grafana dashboard, including how often clients hit
  each tier of the drift ladder; JSON logs in Docker

## Deliberately not in v1

Netflix, Prime Video and Disney+ playback (no embed API, Widevine DRM -- the
extension's job), video upload and transcoding, voice or video chat, native
mobile apps.

## Decisions taken on the PRD's open questions

Each of the six took its proposed default, all configurable:

| Question | Taken | Where |
| --- | --- | --- |
| Max room size | 25, capped server-side | `ROOM_MAX_MEMBERS` |
| Host video files? | No: browse or paste, never upload | `VideoSource` |
| Phone joins a Netflix room? | Yes: chat and roster, with a clear message about playback | `PlayerSurface` |
| Chat retention | 30 days after close | `ROOM_RETENTION_DAYS` |
| Domain and TLS | Caddy profile, ready for a real domain | `ops/Caddyfile` |
| Platform | Docker Compose, portable to EC2 or a managed host | `docker-compose.yml` |
| Database | Supabase (Postgres), with a local Postgres for development | `DATABASE_URL` |

Two further calls the PRD did not settle:

- **A host must be a registered account.** `room.host_user_id` is a foreign key,
  so host transfer targets a member who has one. It is also what lets a host
  reclaim a room after clearing their browser.
- **Host disconnect transfers after a grace period** (`ROOM_HOST_GRACE`, 45s).
  A phone switching networks looks exactly like leaving, so nothing happens
  at once: members see a countdown, and a host who is back in time keeps the
  room. After that the longest-standing registered member who is watching
  becomes host. If only guests are left nobody can host, so the room is
  unlocked instead of leaving everyone stuck.
- **An empty room closes on purpose** (`ROOM_EMPTY_GRACE`, 10m), rather than
  lingering until the 24h expiry, so its code goes back into circulation.

## Layout

```
backend/src/main/java/com/watchparty/
  catalog/    source list, the YouTube search proxy, keyless link resolution
  security/   tokens, the JWT filter, the STOMP handshake interceptor
  room/       entities, authorization, the room REST surface
  sync/       Redis state, the sync engine, fan-out, snapshot and retention jobs
  ratelimit/  shared Redis counters and the per-surface policies
  auth/       registration, login, refresh rotation, Google, guest passes
frontend/src/
  lib/        API client, clock, sync engine, player contract, STOMP session
  components/ the "+" flow and in-app YouTube browser, players, chat, roster
  app/        home, auth pages, /room/[code]
```
