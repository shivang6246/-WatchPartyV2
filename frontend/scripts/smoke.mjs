import { Client } from "@stomp/stompjs";

// Point these at two different app instances to prove that room events cross
// instances, which is the thing a simple in-JVM broker silently gets wrong:
//   WP_API_A=http://localhost:8080 WP_API_B=http://localhost:8081 npm run smoke
const API_A = process.env.WP_API_A ?? "http://localhost:8080";
const API_B = process.env.WP_API_B ?? API_A;
const wsOf = (api) => api.replace(/^http/, "ws") + "/ws";
const API = API_A;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`,
  );
};

async function get(path, token, api = API_A) {
  const res = await fetch(api + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function post(path, body, token, api = API_A) {
  const res = await fetch(api + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function connect(roomId, token, label, api = API_A) {
  return new Promise((resolve, reject) => {
    const inbox = {
      playback: [],
      chat: [],
      members: [],
      errors: [],
      time: [],
      activity: [],
      closes: [],
    };
    const client = new Client({
      brokerURL: wsOf(api),
      reconnectDelay: 0,
      onWebSocketClose: (event) => inbox.closes.push(event?.code),
      beforeConnect: async () => {
        const ticket = await post("/api/v1/ws-ticket", { roomId }, token, api);
        if (ticket.status !== 200)
          reject(new Error(`${label} ticket failed: ${ticket.status}`));
        client.connectHeaders = { ticket: ticket.body.ticket };
      },
      onConnect: () => {
        client.subscribe(`/topic/room/${roomId}/playback`, (m) =>
          inbox.playback.push(JSON.parse(m.body)),
        );
        client.subscribe(`/topic/room/${roomId}/chat`, (m) =>
          inbox.chat.push(JSON.parse(m.body)),
        );
        client.subscribe(`/topic/room/${roomId}/members`, (m) =>
          inbox.members.push(JSON.parse(m.body)),
        );
        client.subscribe(`/topic/room/${roomId}/activity`, (m) =>
          inbox.activity.push(JSON.parse(m.body)),
        );
        client.subscribe("/user/queue/errors", (m) =>
          inbox.errors.push(JSON.parse(m.body)),
        );
        client.subscribe("/user/queue/time", (m) =>
          inbox.time.push(JSON.parse(m.body)),
        );
        setTimeout(() => resolve({ client, inbox }), 150);
      },
      onStompError: (f) =>
        reject(new Error(`${label} stomp error: ${f.headers.message}`)),
    });
    client.activate();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.random().toString(36).slice(2, 8);

async function main() {
  const email = `host-${stamp()}@example.com`;
  const reg = await post("/api/v1/auth/register", {
    email,
    password: "supersecret1",
    displayName: "Host",
  });
  const hostToken = reg.body.accessToken;

  // --- email verification ---------------------------------------------------
  check(
    "a new account starts unverified",
    reg.body.user?.emailVerified === false,
  );
  // The rest of this run hosts rooms, which a stack that enforces verification
  // would refuse. Start it with VERIFICATION_REQUIRED=false if SMTP is set up.
  check(
    "hosting is not held back on this stack",
    reg.body.user?.verificationRequired === false,
    reg.body.user?.verificationRequired
      ? "set VERIFICATION_REQUIRED=false to run the smoke test"
      : "",
  );
  const badLink = await post("/api/v1/auth/verify", {
    token: "not-a-real-token",
  });
  check(
    "an unknown verification link is refused",
    badLink.status === 400 && badLink.body?.code === "verification_invalid",
  );
  check(
    "asking for a new link needs a session",
    (await post("/api/v1/auth/verify/resend", {})).status === 401,
  );

  // --- the "+" picker path -------------------------------------------------
  const sources = await get("/api/v1/catalog/sources", hostToken);
  const ids = (sources.body ?? []).map((s) => s.id);
  check(
    "picker lists its sources",
    ids.includes("youtube") && ids.includes("hosted"),
    ids.join(", "),
  );
  check(
    "DRM services are listed but marked unplayable on the web",
    (sources.body ?? []).some(
      (s) => s.id === "drm_extension" && s.playableOnWeb === false,
    ),
  );
  check(
    "the catalogue refuses anonymous callers",
    (await get("/api/v1/catalog/sources")).status === 401,
  );

  const resolved = await get(
    "/api/v1/catalog/resolve?url=" +
      encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    hostToken,
  );
  check(
    "a pasted link resolves to a title and thumbnail without an API key",
    resolved.status === 200 &&
      resolved.body.ref === "dQw4w9WgXcQ" &&
      Boolean(resolved.body.thumbnail),
    resolved.body?.title,
  );

  const room = await post(
    "/api/v1/rooms",
    {
      platform: resolved.body.platform,
      videoUrl: resolved.body.url,
      videoTitle: resolved.body.title,
      videoThumbnail: resolved.body.thumbnail,
      videoAuthor: resolved.body.author,
    },
    hostToken,
  );
  const { id: roomId, code, inviteToken } = room.body;
  check("picking a video creates the room", room.status === 200, code);
  check(
    "the room carries the video's title and artwork",
    Boolean(room.body.videoTitle) && Boolean(room.body.videoThumbnail),
    room.body.videoTitle,
  );

  const mine = await get("/api/v1/rooms", hostToken);
  check(
    "the room shows on the home screen",
    (mine.body ?? []).some((r) => r.code === code),
  );

  // The room code alone is enough: no invite link.
  const preview = await get(`/api/v1/rooms/${code}/preview`);
  check(
    "anyone with the code sees the room before holding a token",
    preview.status === 200 && preview.body.code === code,
  );
  const guest = await post("/api/v1/auth/guest", {
    roomCode: code.toLowerCase(),
    displayName: "Alex",
  });
  const guestToken = guest.body.guestToken;
  check(
    "a guest pass is issued for the room code alone",
    guest.status === 200 && guest.body.roomId === roomId,
  );
  const join = await post(`/api/v1/rooms/${code}/join`, {}, guestToken);
  check(
    "guest joins with a pass alone",
    join.status === 200 && join.body.members.length === 2,
  );
  const viaInvite = await post("/api/v1/auth/guest", {
    inviteToken,
    displayName: "Link",
  });
  check(
    "an invite link still works",
    viaInvite.status === 200 && viaInvite.body.roomId === roomId,
  );
  const noRoom = await post("/api/v1/auth/guest", {
    roomCode: "ZZZZZZ",
    displayName: "Nobody",
  });
  check("a code for no open room is refused", noRoom.status === 404);

  const hostConn = await connect(roomId, hostToken, "host", API_A);
  let guestConn = await connect(roomId, guestToken, "guest", API_B);
  check(
    "both sockets authenticate with a single-use ticket",
    true,
    API_A === API_B ? "one instance" : `host on ${API_A}, guest on ${API_B}`,
  );

  // Clock probe
  const t0 = Date.now();
  hostConn.client.publish({
    destination: "/app/session/time",
    body: JSON.stringify({ t0 }),
  });
  await wait(300);
  const probe = hostConn.inbox.time[0];
  check(
    "clock probe returns the server stamp",
    Boolean(probe && probe.t1 > 0),
    probe ? `offset ${Math.round(probe.t1 - (t0 + Date.now()) / 2)}ms` : "",
  );

  // Play fans out to the other member
  hostConn.client.publish({
    destination: `/app/room/${roomId}/playback`,
    body: JSON.stringify({
      action: "play",
      positionMs: 0,
      playing: true,
      durationMs: 212000,
    }),
  });
  await wait(400);
  const played = guestConn.inbox.playback.at(-1);
  check(
    "play reaches the other member",
    played?.playing === true && played?.action === "play",
    `seq ${played?.sequence}`,
  );
  check(
    "server stamps its own sequence and clock",
    played?.sequence === 1 && played.serverTs > 0,
  );

  // Playback is host-only: a guest is refused, and the host cannot open it up
  guestConn.inbox.errors.length = 0;
  guestConn.client.publish({
    destination: `/app/room/${roomId}/playback`,
    body: JSON.stringify({ action: "pause", positionMs: 1000, playing: false }),
  });
  await wait(400);
  check(
    "a new room gives playback to the host only",
    guestConn.inbox.errors.at(-1)?.code === "room_locked",
  );

  const unlocked = await fetch(`${API}/api/v1/rooms/${code}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ locked: false }),
  });
  check(
    "playback cannot be unlocked: it stays with the host",
    unlocked.status === 403 && (await unlocked.json())?.code === "host_only_playback",
  );
  await wait(200);

  // The host seeks; sequence must advance
  hostConn.client.publish({
    destination: `/app/room/${roomId}/playback`,
    body: JSON.stringify({ action: "seek", positionMs: 60000, playing: true }),
  });
  await wait(400);
  const seeked = hostConn.inbox.playback.at(-1);
  check(
    "the host's seek is applied and sequenced",
    seeked?.positionMs === 60000 && seeked.sequence === 2,
  );

  // Out-of-range seek is clamped against the reported duration
  hostConn.client.publish({
    destination: `/app/room/${roomId}/playback`,
    body: JSON.stringify({
      action: "seek",
      positionMs: 999_999_999,
      playing: true,
    }),
  });
  await wait(400);
  const clamped = hostConn.inbox.playback.at(-1);
  check(
    "a seek past the end is clamped to the duration",
    clamped?.positionMs === 212000,
    `${clamped?.positionMs}ms`,
  );

  // Lock the room, then have the guest try to control it
  const locked = await fetch(`${API}/api/v1/rooms/${code}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ locked: true }),
  });
  check("host locks the room", locked.status === 200);
  await wait(200);
  guestConn.inbox.errors.length = 0;
  guestConn.client.publish({
    destination: `/app/room/${roomId}/playback`,
    body: JSON.stringify({ action: "pause", positionMs: 1000, playing: false }),
  });
  await wait(400);
  const rejection = guestConn.inbox.errors.at(-1);
  check("a locked room rejects a member", rejection?.code === "room_locked");
  check(
    "the rejection carries the authoritative state back",
    Boolean(rejection?.state?.sequence),
  );

  // The host swaps what is playing; everyone else must follow
  guestConn.inbox.members.length = 0;
  const changed = await fetch(`${API_A}/api/v1/rooms/${code}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({
      platform: "youtube",
      videoUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      videoTitle: "Something else",
    }),
  });
  await wait(500);
  const roomEvent = guestConn.inbox.members.find((m) => m.type === "room");
  check(
    "changing the video reaches the other members",
    changed.status === 200 && Boolean(roomEvent),
    roomEvent?.room?.videoRef,
  );
  check(
    "a new video resets playback to the start, paused",
    guestConn.inbox.playback.at(-1)?.positionMs === 0 &&
      guestConn.inbox.playback.at(-1)?.playing === false,
  );

  // Chat both ways
  guestConn.client.publish({
    destination: `/app/room/${roomId}/chat`,
    body: JSON.stringify({ body: "hello room" }),
  });
  await wait(400);
  const chat = hostConn.inbox.chat.at(-1);
  check(
    "chat fans out with its author",
    chat?.body === "hello room" && chat.displayName === "Alex",
  );

  // Heartbeat drives presence
  guestConn.client.publish({
    destination: `/app/room/${roomId}/heartbeat`,
    body: JSON.stringify({
      positionMs: 60000,
      playing: true,
      buffering: false,
    }),
  });
  await wait(400);
  const view = await fetch(`${API}/api/v1/rooms/${code}`, {
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  const viewBody = await view.json();
  check(
    "heartbeats mark a member present",
    viewBody.members.some((m) => m.present),
    JSON.stringify(viewBody.members.map((m) => [m.displayName, m.present])),
  );

  // A session may not reach into another room
  const other = await post(
    "/api/v1/rooms",
    {
      title: "Other",
      platform: "youtube",
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    },
    hostToken,
  );
  let crossRoomBlocked = false;
  try {
    guestConn.client.publish({
      destination: `/topic/room/${other.body.id}/playback`,
      body: JSON.stringify({}),
    });
  } catch {
    crossRoomBlocked = true;
  }
  await wait(200);
  check(
    "a ticket is scoped to its own room",
    crossRoomBlocked || guestConn.inbox.playback.every((p) => p.sequence <= 4),
  );

  // The video change above must have produced a sequence clients accept
  const loads = guestConn.inbox.playback.filter((p) => p.action === "load");
  const beforeLoad = guestConn.inbox.playback
    .filter((p) => p.action !== "load")
    .map((p) => p.sequence);
  check(
    "a new video's reset carries a sequence newer than anything already applied",
    loads.length > 0 && loads.at(-1).sequence > Math.max(0, ...beforeLoad),
    `load seq ${loads.at(-1)?.sequence}`,
  );

  // The cross-room attempt above is fatal to that session by design, so the
  // guest comes back on a fresh ticket, as a real client would.
  guestConn.client.deactivate();
  guestConn = await connect(roomId, guestToken, "guest", API_B);

  // --- reactions and typing ------------------------------------------------
  guestConn.client.publish({
    destination: `/app/room/${roomId}/reaction`,
    body: JSON.stringify({ emoji: "🔥" }),
  });
  guestConn.client.publish({
    destination: `/app/room/${roomId}/typing`,
    body: JSON.stringify({ typing: true }),
  });
  await wait(400);
  const reaction = hostConn.inbox.activity.find((a) => a.type === "reaction");
  check(
    "a reaction reaches the other member",
    reaction?.emoji === "🔥" && reaction.displayName === "Alex",
  );
  const typing = hostConn.inbox.activity.find(
    (a) => a.type === "typing" && a.typing,
  );
  check(
    "a typing indicator reaches the other member",
    typing?.typing === true && typing.displayName === "Alex",
  );

  guestConn.inbox.errors.length = 0;
  guestConn.client.publish({
    destination: `/app/room/${roomId}/reaction`,
    body: JSON.stringify({ emoji: "<b>x</b>" }),
  });
  await wait(300);
  check(
    "a reaction outside the allowlist is refused",
    guestConn.inbox.errors.at(-1)?.code === "bad_reaction",
  );

  // --- queue -----------------------------------------------------------------
  const hostJson = (method, path, body) =>
    fetch(`${API_A}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({
      status: r.status,
      body: await r.json().catch(() => null),
    }));

  guestConn.inbox.members.length = 0;
  const queued = await hostJson("POST", `/api/v1/rooms/${code}/queue`, {
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoTitle: "Queued one",
  });
  await hostJson("POST", `/api/v1/rooms/${code}/queue`, {
    platform: "youtube",
    videoUrl: "https://youtu.be/9bZkp7q19f0",
    videoTitle: "Queued two",
  });
  await wait(400);
  check(
    "the host queues videos",
    queued.status === 200 && queued.body.length === 1,
  );
  const queueEvent = guestConn.inbox.members
    .filter((m) => m.type === "queue")
    .at(-1);
  check(
    "the queue reaches the other members",
    queueEvent?.queue?.length === 2,
    queueEvent?.queue?.map((q) => q.title).join(", "),
  );

  const guestQueue = await post(
    `/api/v1/rooms/${code}/queue`,
    { platform: "youtube", videoUrl: "https://youtu.be/dQw4w9WgXcQ" },
    guestToken,
    API_B,
  );
  check("a member cannot edit the queue", guestQueue.status === 403);

  const queuedIds = queueEvent.queue.map((q) => q.id);
  const reordered = await hostJson("PUT", `/api/v1/rooms/${code}/queue/order`, {
    itemIds: [queuedIds[1], queuedIds[0]],
  });
  check(
    "the host reorders the queue",
    reordered.status === 200 && reordered.body[0].title === "Queued two",
  );
  const stale = await hostJson("PUT", `/api/v1/rooms/${code}/queue/order`, {
    itemIds: [queuedIds[0]],
  });
  check("a reorder from a stale queue is refused", stale.status === 409);

  const early = await post(
    `/api/v1/rooms/${code}/queue/advance`,
    { reason: "ended" },
    guestToken,
    API_B,
  );
  check(
    "an 'ended' report mid-video does not advance the queue",
    early.status === 409 && early.body?.code === "not_ended",
  );

  guestConn.inbox.members.length = 0;
  const skipped = await hostJson(
    "POST",
    `/api/v1/rooms/${code}/queue/advance`,
    { reason: "skip" },
  );
  await wait(500);
  const advancedTo = guestConn.inbox.members.find(
    (m) => m.type === "room",
  )?.room;
  check(
    "skipping plays the head of the queue for everyone",
    skipped.body?.advanced === true && advancedTo?.videoTitle === "Queued two",
    advancedTo?.videoRef,
  );
  const afterSkip = guestConn.inbox.members
    .filter((m) => m.type === "queue")
    .at(-1);
  check(
    "the played video leaves the queue",
    afterSkip?.queue?.length === 1 && afterSkip.currentItemId === queuedIds[1],
  );
  const again = await hostJson("POST", `/api/v1/rooms/${code}/queue/advance`, {
    reason: "skip",
    ifCurrent: queuedIds[0],
  });
  check(
    "an advance naming a video that is no longer current is a no-op",
    again.body?.advanced === false,
  );

  // --- host hand-off ---------------------------------------------------------
  const second = await post("/api/v1/auth/register", {
    email: `member-${stamp()}@example.com`,
    password: "supersecret1",
    displayName: "Sam",
  });
  const secondToken = second.body.accessToken;
  // A registered user joins with the code too.
  const secondJoin = await post(`/api/v1/rooms/${code}/join`, {}, secondToken);
  const secondConn = await connect(roomId, secondToken, "second", API_B);
  const secondMemberId = secondJoin.body.selfMemberId;

  hostConn.inbox.members.length = 0;
  secondConn.client.publish({
    destination: `/app/room/${roomId}/heartbeat`,
    body: JSON.stringify({ positionMs: 0, playing: false }),
  });
  const handed = await hostJson("PATCH", `/api/v1/rooms/${code}`, {
    transferHostToMemberId: secondMemberId,
  });
  await wait(500);
  const hostEvent = secondConn.inbox.members.find((m) => m.type === "host");
  check(
    "a host hand-off is announced to the room",
    handed.status === 200 &&
      hostEvent?.hostMemberId === secondMemberId &&
      hostEvent.reason === "transfer",
  );
  const secondView = await get(`/api/v1/rooms/${code}`, secondToken);
  check(
    "the new host gets the invite link",
    secondView.body?.selfRole === "host" &&
      Boolean(secondView.body?.inviteToken),
  );

  // --- moderation ------------------------------------------------------------
  const guestMemberId = join.body.selfMemberId;
  const asSecond = (body) =>
    fetch(`${API_A}/api/v1/rooms/${code}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secondToken}`,
      },
      body: JSON.stringify(body),
    });
  guestConn.inbox.errors.length = 0;
  await asSecond({ muteMemberId: guestMemberId, muted: true });
  await wait(400);
  check(
    "a muted member is told so",
    guestConn.inbox.errors.some((e) => e.code === "muted"),
  );
  guestConn.inbox.errors.length = 0;
  hostConn.inbox.chat.length = 0;
  guestConn.client.publish({
    destination: `/app/room/${roomId}/chat`,
    body: JSON.stringify({ body: "can you hear me" }),
  });
  await wait(400);
  check(
    "a muted member's chat is refused",
    guestConn.inbox.errors.at(-1)?.code === "muted" &&
      hostConn.inbox.chat.length === 0,
  );

  await asSecond({ removeMemberId: guestMemberId });
  await wait(1200);
  check(
    "a removed member is told why",
    guestConn.inbox.errors.some((e) => e.code === "removed"),
  );
  check(
    "a removed member's socket is closed by the server",
    guestConn.inbox.closes.includes(4001),
    `close codes ${guestConn.inbox.closes.join(",")}`,
  );
  const ticketAfterKick = await post(
    "/api/v1/ws-ticket",
    { roomId },
    guestToken,
    API_B,
  );
  check(
    "a removed member cannot open a new socket",
    ticketAfterKick.status === 403,
  );

  // --- metrics ---------------------------------------------------------------
  const scrape = await fetch(`${API_A}/actuator/prometheus`)
    .then((r) => r.text())
    .catch(() => "");
  const meters = [
    "watchparty_ws_sessions",
    "watchparty_redis_apply_seconds",
    "watchparty_playback_events_total",
    "watchparty_reactions_total",
    "watchparty_members_kicked_total",
  ];
  const missing = meters.filter((m) => !scrape.includes(m));
  check(
    "the metrics endpoint exposes the sync meters",
    missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : "",
  );

  hostConn.client.deactivate();
  guestConn.client.deactivate();
  secondConn.client.deactivate();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((ex) => {
  console.error("smoke run failed:", ex);
  process.exit(1);
});
