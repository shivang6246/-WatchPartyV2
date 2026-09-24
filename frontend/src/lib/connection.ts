import { Client, type IMessage } from "@stomp/stompjs";
import { HttpError, api } from "./api";
import { ServerClock } from "./clock";
import type { ActivityEvent, ChatMessageView, MemberEvent, PlaybackMessage, RealtimeError } from "./types";

/** The server closes a removed member's socket with this code; never reconnect after it. */
const CLOSE_REMOVED = 4001;

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080")
    .replace(/^http/, "ws")
    .replace(/\/$/, "") + "/ws";

const PROBE_COUNT = 5;
const PROBE_SPACING_MS = 120;
const RESYNC_CLOCK_EVERY_MS = 30_000;
const HEARTBEAT_EVERY_MS = 5_000;

export interface ConnectionHandlers {
  onPlayback(message: PlaybackMessage): void;
  onChat(message: ChatMessageView): void;
  onMembers(event: MemberEvent): void;
  onActivity(event: ActivityEvent): void;
  onError(error: RealtimeError): void;
  onStatus(status: "connecting" | "connected" | "disconnected"): void;
  /** The server closed this session because the member was removed. */
  onRemoved(): void;
  /**
   * The ticket was refused: the credential expired or was revoked. Retrying
   * with the same one cannot work, so the session has to re-enter the room.
   */
  onAuthFailed(error: HttpError): void;
  /**
   * Asked for on every heartbeat: this client's real position, plus how often
   * each drift-correction tier fired since the last one, for server metrics.
   */
  sampleLocal(): {
    positionMs: number;
    playing: boolean;
    buffering: boolean;
    rateCorrections?: number;
    seekCorrections?: number;
    resyncs?: number;
  };
}

/**
 * One room's realtime session.
 *
 * <p>Every connection starts by exchanging a single-use ticket for a session,
 * so no credential ever appears in the WebSocket URL, and a reconnect simply
 * takes a fresh ticket — which is also the path a phone follows coming back
 * from a locked screen.
 */
export class RoomConnection {
  readonly clock = new ServerClock();

  private client: Client | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private pendingProbes = new Map<number, number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly roomId: string,
    private readonly getToken: () => string | null,
    private readonly handlers: ConnectionHandlers,
  ) {}

  connect() {
    if (this.client) return;

    const client = new Client({
      brokerURL: WS_URL,
      reconnectDelay: 2000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      beforeConnect: async () => {
        // A ticket is valid for 30 seconds and one connection, so it has to be
        // taken immediately before each attempt, including reconnects.
        this.handlers.onStatus("connecting");
        try {
          const ticket = await api.wsTicket(this.roomId, this.getToken());
          client.connectHeaders = { ticket: ticket.ticket };
        } catch (ex) {
          // Never let this throw: stompjs would surface it as an unhandled
          // error and stop. Marking the client inactive here makes it skip
          // this attempt instead.
          await client.deactivate();
          this.client = null;
          if (ex instanceof HttpError && (ex.status === 401 || ex.status === 403)) {
            this.handlers.onStatus("disconnected");
            this.handlers.onAuthFailed(ex);
          } else {
            // The API is unreachable for a moment: try again shortly.
            this.handlers.onStatus("disconnected");
            this.retryTimer = setTimeout(() => this.connect(), 3000);
          }
        }
      },
      onConnect: () => {
        this.subscribe(client);
        this.handlers.onStatus("connected");
        this.runClockRound();
        this.startTimers();
      },
      onWebSocketClose: (event: CloseEvent) => {
        this.stopTimers();
        if (event?.code === CLOSE_REMOVED) {
          // Reconnecting would only be refused again.
          this.disconnect();
          this.handlers.onRemoved();
          return;
        }
        this.handlers.onStatus("disconnected");
      },
      onStompError: (frame) => {
        this.handlers.onError({
          code: "stomp_error",
          message: frame.headers["message"] ?? "The connection was rejected.",
        });
      },
    });

    this.client = client;
    client.activate();
  }

  private subscribe(client: Client) {
    client.subscribe(`/topic/room/${this.roomId}/playback`, (frame: IMessage) => {
      this.handlers.onPlayback(JSON.parse(frame.body) as PlaybackMessage);
    });
    client.subscribe(`/topic/room/${this.roomId}/chat`, (frame: IMessage) => {
      this.handlers.onChat(JSON.parse(frame.body) as ChatMessageView);
    });
    client.subscribe(`/topic/room/${this.roomId}/members`, (frame: IMessage) => {
      this.handlers.onMembers(JSON.parse(frame.body) as MemberEvent);
    });
    client.subscribe(`/topic/room/${this.roomId}/activity`, (frame: IMessage) => {
      this.handlers.onActivity(JSON.parse(frame.body) as ActivityEvent);
    });
    client.subscribe("/user/queue/errors", (frame: IMessage) => {
      const payload = JSON.parse(frame.body) as RealtimeError;
      // Member notices go to every session the account holds, including tabs
      // in other rooms; only this room's concern this connection.
      if (payload.roomId && payload.roomId !== this.roomId) return;
      // A rejection arrives as the authoritative state with a sequence we have
      // not seen, so the ordinary correction path handles it.
      if (payload.state) {
        this.handlers.onPlayback(payload.state);
      }
      this.handlers.onError(payload);
    });
    client.subscribe("/user/queue/time", (frame: IMessage) => {
      const probe = JSON.parse(frame.body) as { t0: number; t1: number };
      const sentAt = this.pendingProbes.get(probe.t0);
      if (sentAt === undefined) return;
      this.pendingProbes.delete(probe.t0);
      this.clock.addSample(probe.t0, probe.t1, Date.now());
    });
  }

  private startTimers() {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      const sample = this.handlers.sampleLocal();
      this.publish(`/app/room/${this.roomId}/heartbeat`, sample);
    }, HEARTBEAT_EVERY_MS);

    this.clockTimer = setInterval(() => this.runClockRound(), RESYNC_CLOCK_EVERY_MS);
  }

  private stopTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.heartbeatTimer = null;
    this.clockTimer = null;
  }

  private runClockRound() {
    this.clock.beginRound();
    for (let i = 0; i < PROBE_COUNT; i += 1) {
      setTimeout(() => {
        const t0 = Date.now();
        this.pendingProbes.set(t0, t0);
        this.publish("/app/session/time", { t0 });
      }, i * PROBE_SPACING_MS);
    }
  }

  sendPlayback(message: PlaybackMessage) {
    this.publish(`/app/room/${this.roomId}/playback`, message);
  }

  sendChat(body: string) {
    this.publish(`/app/room/${this.roomId}/chat`, { body });
  }

  sendReaction(emoji: string) {
    this.publish(`/app/room/${this.roomId}/reaction`, { emoji });
  }

  sendTyping(typing: boolean) {
    this.publish(`/app/room/${this.roomId}/typing`, { typing });
  }

  requestResync() {
    this.publish(`/app/room/${this.roomId}/resync`, {});
  }

  private publish(destination: string, body: unknown) {
    if (!this.client?.connected) return;
    this.client.publish({ destination, body: JSON.stringify(body) });
  }

  disconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopTimers();
    this.client?.deactivate();
    this.client = null;
  }
}
