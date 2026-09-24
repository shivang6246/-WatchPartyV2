"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError, api, clearGuestToken, getAccessToken, readGuestToken, writeGuestToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { RoomConnection } from "@/lib/connection";
import type { PlayerHandle } from "@/lib/player";
import { SyncEngine, type SyncDiagnostics } from "@/lib/sync";
import type {
  CatalogItem,
  ChatMessageView,
  MemberView,
  PlaybackMessage,
  RoomPreview,
  RoomView,
} from "@/lib/types";

export type RoomStatus = "loading" | "need-name" | "joining" | "ready" | "error";

/** One floating emoji over the player. */
export interface LiveReaction {
  id: string;
  emoji: string;
  displayName: string;
  /** Horizontal position as a percentage, so a burst spreads out. */
  x: number;
}

/** Someone started or stopped watching, for the chat's timeline. Local only. */
export interface PresenceEvent {
  id: string;
  kind: "joined" | "left";
  name: string;
  /** Epoch millis, on this client's clock. */
  at: number;
}

/** A leave followed by a join within this long is a reload, not news. */
const REJOIN_WINDOW_MS = 15_000;
/** Timeline lines kept; older ones scroll away with the chat anyway. */
const MAX_PRESENCE_EVENTS = 60;

export interface RoomSession {
  status: RoomStatus;
  room: RoomView | null;
  preview: RoomPreview | null;
  members: MemberView[];
  messages: ChatMessageView[];
  /** Joins and departures seen since this client arrived, oldest first. */
  presence: PresenceEvent[];
  behindMembers: Set<string>;
  diagnostics: SyncDiagnostics | null;
  connection: "connecting" | "connected" | "disconnected";
  error: string | null;
  notice: string | null;
  isHost: boolean;
  canControl: boolean;
  /** The host muted this member: chat, reactions and typing are off. */
  selfMuted: boolean;
  reactions: LiveReaction[];
  /** Display names of the other members typing right now. */
  typing: string[];
  joinAsGuest: (displayName: string) => Promise<void>;
  attachPlayer: (handle: PlayerHandle | null) => void;
  setBuffering: (buffering: boolean) => void;
  /** The player is stalled, so the stage can say so instead of looking frozen. */
  buffering: boolean;
  /** The attached player, for the per-viewer controls: volume, quality, fullscreen. */
  player: () => PlayerHandle | null;
  play: () => void;
  pause: () => void;
  seek: (positionMs: number) => void;
  /** Jumps forwards or back from where the room is now, e.g. ±10 s. */
  skipBy: (deltaMs: number) => void;
  /** Starts a player the browser refused to autoplay; call from a click. */
  resume: () => void;
  sendChat: (body: string) => void;
  react: (emoji: string) => void;
  setTyping: (typing: boolean) => void;
  patchRoom: (body: Record<string, unknown>) => Promise<void>;
  closeRoom: () => Promise<void>;
  leave: () => Promise<void>;
  enqueue: (item: CatalogItem) => Promise<void>;
  dequeue: (itemId: string) => Promise<void>;
  moveQueueItem: (itemId: string, delta: -1 | 1) => Promise<void>;
  skip: () => Promise<void>;
  /** Called by a player when the video reaches its end. */
  reportEnded: () => void;
  projectedPositionMs: () => number;
  durationMs: number | null;
  playing: boolean;
}

/** Re-send "typing" no more often than this while the member keeps typing. */
const TYPING_REFRESH_MS = 3000;
/** Stop saying "typing" after this long without a keystroke. */
const TYPING_IDLE_MS = 4000;
/** Drop someone else's indicator if no refresh arrives in this long. */
const TYPING_EXPIRY_MS = 6000;
const REACTION_LIFETIME_MS = 2800;

/**
 * Everything a room page needs: joining, the socket, the sync engine, chat and
 * the roster. The ten-second promise lives here — a guest who opens a link
 * gets one preview call, one guest pass and one join before playback starts.
 */
export function useRoom(code: string, invite: string | null): RoomSession {
  // The session is restored from the refresh cookie on load, so entering a
  // room has to wait for it — otherwise a host lands on the guest gate for
  // their own room.
  const { loading: authLoading } = useAuth();
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [behindMembers, setBehindMembers] = useState<Set<string>>(new Set());
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [buffering, setBufferingState] = useState(false);
  const [reactions, setReactions] = useState<LiveReaction[]>([]);
  const [typingMap, setTypingMap] = useState<Map<string, { name: string; until: number }>>(new Map());
  const [presence, setPresence] = useState<PresenceEvent[]>([]);
  // Who was watching at the last roster, to tell arrivals and departures apart.
  // Null until this client's own first roster, which announces nobody.
  const watchingRef = useRef<Map<string, string> | null>(null);

  // The room object is replaced whenever the host changes the video, so the
  // realtime effect keys on the room id alone: a new video must not tear down
  // and rebuild the socket.
  const roomId = room?.id ?? null;
  const roomRef = useRef<RoomView | null>(null);
  roomRef.current = room;

  const connectionRef = useRef<RoomConnection | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const bufferingRef = useRef(false);
  const playingRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const typingSentAtRef = useRef(0);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedForRef = useRef<string | null>(null);

  const token = useCallback(() => tokenRef.current, []);

  // ---- Joining ----------------------------------------------------------

  const enterRoom = useCallback(
    async (explicitToken?: string | null) => {
      // Only a guest pass is pinned here. A signed-in user's access token
      // expires every fifteen minutes and is refreshed behind the scenes, so
      // requests pass nothing and api.ts always sends the current one.
      const account = explicitToken ? null : getAccessToken();
      const guestPass = explicitToken ?? (account ? null : readGuestToken(code));
      const candidate = account ?? guestPass;
      tokenRef.current = guestPass;

      if (!candidate) {
        // No credential yet: show what we may of the room and ask for a name.
        try {
          setPreview(await api.preview(code));
          setStatus("need-name");
        } catch (ex) {
          setError(ex instanceof HttpError ? ex.message : "That room could not be opened.");
          setStatus("error");
        }
        return;
      }

      setStatus("joining");
      try {
        const joined = await api.joinRoom(code, { inviteToken: invite }, candidate);
        setRoom(joined);
        setMembers(joined.members);
        setPlaying(joined.playback.playing ?? false);
        playingRef.current = joined.playback.playing ?? false;
        setDurationMs(joined.playback.durationMs ?? null);
        setStatus("ready");
      } catch (ex) {
        // A pass that no longer works (expired, or signed by a server that
        // has since been reset: 401) or one for another room (403): fall
        // back to asking for a name, which issues a fresh pass for this room.
        if (ex instanceof HttpError && (ex.status === 401 || ex.status === 403) && ex.code !== "removed") {
          if (ex.status === 401 && guestPass) clearGuestToken(code);
          tokenRef.current = null;
          try {
            setPreview(await api.preview(code));
            setStatus("need-name");
            return;
          } catch {
            // fall through to the error below
          }
        }
        setError(ex instanceof HttpError ? ex.message : "That room could not be joined.");
        setStatus("error");
      }
    },
    [code, invite],
  );

  const joinAsGuest = useCallback(
    async (displayName: string) => {
      setStatus("joining");
      try {
        // The code in the URL is enough; an invite link still works too.
        const pass = await api.guestPass(invite ? { inviteToken: invite, displayName } : { roomCode: code, displayName });
        writeGuestToken(code, pass.guestToken);
        await enterRoom(pass.guestToken);
      } catch (ex) {
        setError(ex instanceof HttpError ? ex.message : "Could not join as a guest.");
        setStatus("error");
      }
    },
    [code, invite, enterRoom],
  );

  useEffect(() => {
    if (authLoading) return;
    void enterRoom();
  }, [authLoading, enterRoom]);

  /** Re-reads the room, e.g. after becoming host, which unlocks the invite token. */
  const refreshRoom = useCallback(async () => {
    try {
      const fresh = await api.getRoom(code, tokenRef.current);
      setRoom(fresh);
      setMembers(fresh.members);
    } catch {
      // The next roster or room event will bring the view up to date anyway.
    }
  }, [code]);

  // The realtime effect must not restart whenever enterRoom's identity does.
  const enterRoomRef = useRef(enterRoom);
  enterRoomRef.current = enterRoom;

  const removed = useCallback(() => {
    connectionRef.current?.disconnect();
    setError("The host removed you from this room.");
    setStatus("error");
  }, []);

  // ---- Realtime session -------------------------------------------------

  useEffect(() => {
    if (status !== "ready" || !roomId) return;

    const connection = new RoomConnection(roomId, token, {
      onPlayback: (message: PlaybackMessage) => {
        engineRef.current?.applyRemote(message);
        setPlaying(message.playing ?? false);
        playingRef.current = message.playing ?? false;
        if (message.action === "load") {
          // A new video: the old one's length must not linger on the bar.
          setDurationMs(message.durationMs ?? null);
        } else if (message.durationMs) {
          setDurationMs(message.durationMs);
        }
      },
      onChat: (message) => setMessages((current) => [...current, message]),
      onMembers: (event) => {
        if (event.type === "roster") {
          setMembers(event.members);
        } else if (event.type === "health") {
          setBehindMembers((current) => {
            const next = new Set(current);
            if (event.behind) next.add(event.memberId);
            else next.delete(event.memberId);
            return next;
          });
        } else if (event.type === "left") {
          setMembers((current) =>
            current.map((m) => (m.id === event.memberId ? { ...m, present: false } : m)),
          );
        } else if (event.type === "room") {
          // The host changed the video: merge it in so the player remounts on
          // the new source for everyone, not just the host.
          setRoom((current) => (current ? { ...current, ...event.room } : current));
        } else if (event.type === "closed") {
          setNotice(
            event.reason === "empty"
              ? "This room closed after everyone left."
              : event.reason === "expired"
                ? "This room has expired."
                : "The host closed this room.",
          );
        } else if (event.type === "host") {
          const self = roomRef.current?.selfMemberId;
          setRoom((current) =>
            current
              ? {
                  ...current,
                  hostMemberId: event.hostMemberId,
                  hostAwayUntil: null,
                  selfRole:
                    event.hostMemberId === self
                      ? "host"
                      : event.previousHostMemberId === self
                        ? "member"
                        : current.selfRole,
                  inviteToken: event.previousHostMemberId === self ? null : current.inviteToken,
                }
              : current,
          );
          if (event.hostMemberId === self) {
            setNotice(
              event.reason === "failover"
                ? "The host dropped out, so you are hosting now."
                : "You are the host now.",
            );
            // Only the host's view carries the invite link.
            void refreshRoom();
          } else {
            setNotice(`${event.hostName} is hosting now.`);
          }
        } else if (event.type === "host-away") {
          setRoom((current) => (current ? { ...current, hostAwayUntil: event.deadline } : current));
        } else if (event.type === "host-back") {
          setRoom((current) => (current ? { ...current, hostAwayUntil: null } : current));
        } else if (event.type === "host-lost") {
          setRoom((current) => (current ? { ...current, hostAwayUntil: null } : current));
          setNotice("The host left and nobody here has an account to take over. Playback is open to everyone.");
        } else if (event.type === "queue") {
          setRoom((current) =>
            current ? { ...current, queue: event.queue, currentItemId: event.currentItemId } : current,
          );
        }
      },
      onActivity: (event) => {
        const self = roomRef.current?.selfMemberId;
        if (event.type === "reaction") {
          const reaction: LiveReaction = {
            id: event.id,
            emoji: event.emoji,
            displayName: event.displayName,
            x: 10 + Math.random() * 80,
          };
          setReactions((current) => [...current.slice(-30), reaction]);
          setTimeout(
            () => setReactions((current) => current.filter((r) => r.id !== reaction.id)),
            REACTION_LIFETIME_MS,
          );
        } else if (event.type === "typing" && event.memberId !== self) {
          setTypingMap((current) => {
            const next = new Map(current);
            if (event.typing) next.set(event.memberId, { name: event.displayName, until: Date.now() + TYPING_EXPIRY_MS });
            else next.delete(event.memberId);
            return next;
          });
        }
      },
      onError: (realtimeError) => {
        if (realtimeError.code === "removed") {
          removed();
          return;
        }
        // A resync is the ordinary rejection path, not something to announce.
        if (realtimeError.code !== "resync") {
          setNotice(realtimeError.message);
        }
        if (realtimeError.code === "muted" || realtimeError.code === "unmuted") {
          const mutedNow = realtimeError.code === "muted";
          const self = roomRef.current?.selfMemberId;
          setMembers((current) => current.map((m) => (m.id === self ? { ...m, muted: mutedNow } : m)));
        }
      },
      onRemoved: removed,
      onAuthFailed: (failure) => {
        if (failure.code === "removed") {
          removed();
          return;
        }
        // The credential no longer works: a guest pass that expired or
        // belongs to a reset server, or an account whose refresh also failed.
        // Start over, which lands on the name screen if nothing valid is left.
        if (tokenRef.current) clearGuestToken(code);
        tokenRef.current = null;
        setStatus("loading");
        void enterRoomRef.current();
      },
      onStatus: setConnection,
      sampleLocal: () => ({
        positionMs: Math.round(playerRef.current?.getPositionMs() ?? 0),
        playing: playingRef.current,
        buffering: bufferingRef.current,
        ...(engineRef.current?.drainCorrections() ?? {}),
      }),
    });

    // The engine reads time through the connection's clock, which the probe
    // exchange keeps corrected.
    const engine = new SyncEngine(connection.clock, setDiagnostics, (drift) => {
      // Beyond the ladder this is a dropped event, not ordinary drift: ask the
      // server for the authoritative state rather than trusting our own.
      console.warn(`[watchparty] resync after ${Math.round(drift)}ms drift`);
      connection.requestResync();
    });

    engine.setBuffering(bufferingRef.current);
    engineRef.current = engine;
    connectionRef.current = connection;
    const initial = roomRef.current?.playback;
    if (initial) engine.applyRemote(initial);
    if (playerRef.current) engine.attach(playerRef.current);
    connection.connect();

    const ticker = setInterval(() => {
      engine.tick();
      // YouTube often reports no duration until the video has actually
      // loaded, well after the player is ready. Keep asking: without a
      // duration the seek bar stays disabled.
      const reported = playerRef.current?.getDurationMs();
      if (reported) setDurationMs((current) => (current === reported ? current : reported));
    }, 1000);
    // Someone's "typing" whose refresh never came is dropped here.
    const typingSweep = setInterval(() => {
      setTypingMap((current) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(current);
        for (const [id, entry] of next) {
          if (entry.until < now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1000);

    return () => {
      clearInterval(ticker);
      clearInterval(typingSweep);
      connection.disconnect();
      connectionRef.current = null;
      engineRef.current = null;
    };
  }, [status, roomId, token, refreshRoom, removed, code]);

  // Load the last page of chat once, so a joiner walks into a conversation.
  useEffect(() => {
    if (status !== "ready" || !roomId) return;
    let cancelled = false;
    api
      .messages(code, tokenRef.current)
      .then((page) => {
        if (!cancelled) setMessages(page.messages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, roomId, code]);

  // ---- Actions ----------------------------------------------------------

  const attachPlayer = useCallback((handle: PlayerHandle | null) => {
    playerRef.current = handle;
    engineRef.current?.attach(handle);
    if (handle) {
      const duration = handle.getDurationMs();
      if (duration) setDurationMs(duration);
    }
  }, []);

  const setBuffering = useCallback((next: boolean) => {
    // The ref feeds the heartbeat every few seconds; the state is only for
    // the spinner, so it is set from the same call rather than polled.
    bufferingRef.current = next;
    // The engine holds its corrections while the player refills its buffer.
    engineRef.current?.setBuffering(next);
    setBufferingState((current) => (current === next ? current : next));
  }, []);

  const sendIntent = useCallback((action: "play" | "pause" | "seek", positionMs?: number) => {
    const connection = connectionRef.current;
    if (!connection) return;
    connection.sendPlayback({
      action,
      positionMs: Math.round(positionMs ?? engineRef.current?.projectedPositionMs() ?? 0),
      // A seek keeps the room as it is: scrubbing a paused video must not
      // start it, and scrubbing a playing one must not stop it.
      playing: action === "seek" ? playingRef.current : action === "play",
      durationMs: playerRef.current?.getDurationMs() ?? undefined,
    });
  }, []);

  const setTyping = useCallback((typing: boolean) => {
    const connection = connectionRef.current;
    if (!connection) return;
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    if (!typing) {
      if (typingSentAtRef.current) connection.sendTyping(false);
      typingSentAtRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - typingSentAtRef.current > TYPING_REFRESH_MS) {
      connection.sendTyping(true);
      typingSentAtRef.current = now;
    }
    typingIdleRef.current = setTimeout(() => {
      connectionRef.current?.sendTyping(false);
      typingSentAtRef.current = 0;
    }, TYPING_IDLE_MS);
  }, []);

  const reportEnded = useCallback(() => {
    const current = roomRef.current;
    if (!current || current.queue.length === 0) return;
    // One report per item from this client; the server dedupes across members.
    if (endedForRef.current === current.currentItemId) return;
    endedForRef.current = current.currentItemId;
    api
      .advanceQueue(
        code,
        { reason: "ended", ifCurrent: current.currentItemId },
        tokenRef.current,
      )
      .catch(() => undefined);
  }, [code]);

  // ---- Presence feed ----------------------------------------------------

  // Every roster change (a socket connecting, a heartbeat after a gap, a
  // disconnect, someone timing out) arrives as members; the difference from
  // the last one is who joined and who left.
  const selfId = room?.selfMemberId ?? null;
  useEffect(() => {
    if (status !== "ready") {
      watchingRef.current = null;
      return;
    }
    const now = new Map(members.filter((m) => m.present).map((m) => [m.id, m.displayName]));
    const before = watchingRef.current;
    watchingRef.current = now;
    if (!before) return;

    const at = Date.now();
    const joined = [...now].filter(([id]) => !before.has(id) && id !== selfId);
    const left = [...before].filter(([id]) => !now.has(id) && id !== selfId);
    if (joined.length === 0 && left.length === 0) return;

    setPresence((current) => {
      let next = current;
      for (const [id, name] of joined) {
        // Back within seconds (a reload, a network blip): drop the "left"
        // line instead of adding a "joined" one.
        let recentLeave = -1;
        for (let index = next.length - 1; index >= 0; index--) {
          if (next[index].id.startsWith(`${id}:left:`) && at - next[index].at < REJOIN_WINDOW_MS) {
            recentLeave = index;
            break;
          }
        }
        if (recentLeave >= 0) {
          next = next.filter((_, index) => index !== recentLeave);
        } else {
          next = [...next, { id: `${id}:joined:${at}`, kind: "joined", name, at }];
        }
      }
      for (const [id, name] of left) {
        next = [...next, { id: `${id}:left:${at}`, kind: "left", name, at }];
      }
      return next.slice(-MAX_PRESENCE_EVENTS);
    });
  }, [members, status, selfId]);

  const isHost = room?.selfRole === "host";
  const canControl = Boolean(room && (!room.locked || isHost));
  const selfMuted = Boolean(room && members.find((m) => m.id === room.selfMemberId)?.muted);
  const typing = [...typingMap.values()].map((entry) => entry.name);

  const withQueueError = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (ex) {
      setNotice(ex instanceof HttpError ? ex.message : "The queue could not be updated.");
      if (ex instanceof HttpError && ex.code === "queue_changed") void refreshRoom();
    }
  };

  return {
    status,
    room,
    preview,
    members,
    messages,
    presence,
    behindMembers,
    diagnostics,
    connection,
    error,
    notice,
    isHost,
    canControl,
    selfMuted,
    reactions,
    typing,
    joinAsGuest,
    attachPlayer,
    setBuffering,
    buffering,
    player: () => playerRef.current,
    play: () => sendIntent("play"),
    pause: () => sendIntent("pause"),
    seek: (positionMs: number) => sendIntent("seek", Math.max(0, positionMs)),
    skipBy: (deltaMs: number) => {
      const from = engineRef.current?.projectedPositionMs() ?? 0;
      const target = Math.max(0, from + deltaMs);
      sendIntent("seek", durationMs ? Math.min(target, durationMs) : target);
    },
    resume: () => engineRef.current?.userStart(),
    sendChat: (body: string) => {
      connectionRef.current?.sendChat(body);
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      typingSentAtRef.current = 0;
    },
    react: (emoji: string) => connectionRef.current?.sendReaction(emoji),
    setTyping,
    patchRoom: async (body: Record<string, unknown>) => {
      const updated = await api.patchRoom(code, body, tokenRef.current);
      setRoom(updated);
      setMembers(updated.members);
    },
    closeRoom: async () => {
      await api.closeRoom(code, tokenRef.current);
      setNotice("Room closed.");
    },
    leave: async () => {
      await api.leaveRoom(code, tokenRef.current).catch(() => undefined);
      connectionRef.current?.disconnect();
    },
    enqueue: async (item: CatalogItem) => {
      // Errors propagate: the picker shows them in place.
      const queue = await api.enqueue(
        code,
        {
          platform: item.platform,
          videoUrl: item.url,
          videoTitle: item.title,
          videoThumbnail: item.thumbnail,
          videoAuthor: item.author,
          durationMs: item.durationMs,
        },
        tokenRef.current,
      );
      setRoom((current) => (current ? { ...current, queue } : current));
    },
    dequeue: (itemId: string) =>
      withQueueError(async () => {
        const queue = await api.dequeue(code, itemId, tokenRef.current);
        setRoom((current) => (current ? { ...current, queue } : current));
      }),
    moveQueueItem: (itemId: string, delta: -1 | 1) =>
      withQueueError(async () => {
        const ids = (roomRef.current?.queue ?? []).map((item) => item.id);
        const from = ids.indexOf(itemId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        const queue = await api.reorderQueue(code, ids, tokenRef.current);
        setRoom((current) => (current ? { ...current, queue } : current));
      }),
    skip: () =>
      withQueueError(() =>
        api.advanceQueue(code, { reason: "skip", ifCurrent: roomRef.current?.currentItemId }, tokenRef.current),
      ),
    reportEnded,
    projectedPositionMs: () => engineRef.current?.projectedPositionMs() ?? 0,
    durationMs,
    playing,
  };
}
