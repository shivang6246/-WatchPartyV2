"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChatPanel from "@/components/ChatPanel";
import InviteButton from "@/components/InviteBar";
import JoinGate from "@/components/JoinGate";
import MembersPanel, { WatchingSummary } from "@/components/MembersPanel";
import PlayerSurface from "@/components/PlayerSurface";
import QueuePanel from "@/components/QueuePanel";
import ReactionBar from "@/components/ReactionBar";
import { Accent, Avatar, Banner, Button, Eyebrow, IconButton, Logo, Spinner } from "@/components/ui";
import { useRoom, type RoomSession } from "@/hooks/useRoom";
import { useAuth } from "@/lib/auth-context";

// The picker is only for the host, and only once they tap "+": fetched then.
const AddContentFlow = dynamic(() => import("@/components/AddContentFlow"));

/** Counts down a disconnected host's grace period, so nobody wonders why the room froze. */
function HostAwayBanner({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <Banner>
      The host lost their connection.{" "}
      {seconds > 0 ? (
        <>
          If they are not back in <span className="font-mono text-cobalt-soft">{seconds}s</span>, someone here with an
          account takes over.
        </>
      ) : (
        "Handing the room to someone else…"
      )}
    </Banner>
  );
}

/** The host's room controls, tucked behind one button. */
function HostMenu({ session }: { session: RoomSession }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const item = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/[0.05]";

  return (
    <div className="relative" ref={ref}>
      <IconButton
        aria-label="Room settings"
        aria-expanded={open}
        active={open}
        onClick={() => setOpen(!open)}
        className="border-transparent bg-transparent"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </IconButton>
      {open ? (
        <div className="sheet-in absolute right-0 top-12 z-40 w-[min(16rem,calc(100vw-1.5rem))] rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)]">
          <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-faint">Host controls</p>
          <p className="px-3 pb-2 text-[11px] text-muted">Only you can play, pause and seek.</p>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              void session.patchRoom({ rotateInviteToken: true });
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-cobalt" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="flex-1">
              New invite link
              <span className="block text-[11px] text-faint">Old links stop working</span>
            </span>
          </button>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            className={`${item} text-ember hover:bg-ember/10`}
            onClick={() => {
              setOpen(false);
              void session.closeRoom();
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
            Close the room
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Tab = "chat" | "queue" | "people";

/** How long a new-message card stays over the stage. */
const TOAST_MS = 6000;
const NOTIFY_KEY = "wp.notify";

function Room() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const { user } = useAuth();

  const code = (params.code ?? "").toUpperCase();
  const invite = search.get("invite");
  const session = useRoom(code, invite);

  const [changing, setChanging] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  // Messages read while the chat tab was open; the rest count as unread.
  const [seen, setSeen] = useState(0);
  // The newest message from someone else, while the chat is not in view.
  const [toast, setToast] = useState<{ id: string; name: string; body: string } | null>(null);
  const [notifyOn, setNotifyOn] = useState(false);
  const announced = useRef<string | null>(null);
  // Only the fullscreen element is drawn in fullscreen, so the card has to live
  // inside it then, or a viewer watching fullscreen would never see it.
  const [fullscreenHost, setFullscreenHost] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setFullscreenHost(document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const messageCount = session.messages.length;
  useEffect(() => {
    if (tab === "chat" && !document.hidden && !fullscreenHost) setSeen(messageCount);
  }, [tab, messageCount, fullscreenHost]);

  useEffect(() => {
    setNotifyOn(
      typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        localStorage.getItem(NOTIFY_KEY) === "on",
    );
  }, []);

  // Catch up on anything that arrived while the tab was in the background.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && !document.fullscreenElement && tab === "chat") setSeen(session.messages.length);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tab, session.messages.length]);

  // A message from someone else, when the viewer is not looking at the chat:
  // a card over the stage, a count in the tab, and the title when the tab is
  // in the background. A desktop notification only if they asked for one.
  const latest = session.messages[session.messages.length - 1];
  const selfMemberId = session.room?.selfMemberId ?? null;
  const roomTitle = session.room?.videoTitle ?? session.room?.title ?? "WatchParty";
  useEffect(() => {
    if (!latest || latest.memberId === selfMemberId) return;
    if (announced.current === latest.id) return;
    announced.current = latest.id;
    // Fullscreen hides the chat, so an open Chat tab is not "in view" there.
    if (tab === "chat" && !document.hidden && !document.fullscreenElement) return;

    setToast({ id: latest.id, name: latest.displayName, body: latest.body });
    if (document.hidden && notifyOn && typeof Notification !== "undefined") {
      try {
        // One tag, so a burst of messages replaces rather than stacks.
        new Notification(`${latest.displayName} · ${roomTitle}`, { body: latest.body, tag: "watchparty-chat" });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }, [latest, selfMemberId, tab, notifyOn, roomTitle]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Your own messages are never unread, even though they arrive back over the
  // socket like everyone else's.
  const unreadCount = session.messages.slice(seen).filter((message) => message.memberId !== selfMemberId).length;
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${roomTitle} · WatchParty` : `${roomTitle} · WatchParty`;
    return () => {
      document.title = "WatchParty";
    };
  }, [unreadCount, roomTitle]);

  async function toggleNotifications() {
    if (typeof Notification === "undefined") return;
    if (notifyOn) {
      localStorage.setItem(NOTIFY_KEY, "off");
      setNotifyOn(false);
      return;
    }
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return;
    localStorage.setItem(NOTIFY_KEY, "on");
    setNotifyOn(true);
  }

  if (session.status === "loading" || session.status === "joining") {
    return (
      <main className="spotlight grid min-h-dvh place-items-center px-4">
        <div className="flex flex-col items-center gap-6 text-sm text-muted">
          <div className="relative grid aspect-square w-28 place-items-center">
            <div className="halo inset-0" aria-hidden />
            <Logo compact />
          </div>
          <span className="flex items-center gap-2.5">
            <Spinner className="h-4 w-4 text-cobalt-soft" />
            Joining the room…
          </span>
        </div>
      </main>
    );
  }

  if (session.status === "need-name") {
    return <JoinGate preview={session.preview} onJoin={session.joinAsGuest} />;
  }

  if (session.status === "error" || !session.room) {
    return (
      <main className="spotlight flex min-h-dvh flex-col px-4">
        <header className="flex h-16 items-center">
          <Link href="/" aria-label="WatchParty home">
            <Logo />
          </Link>
        </header>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center pb-16">
          <Eyebrow>Room {code}</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">
            This screen is <Accent>dark.</Accent>
          </h1>
          <div className="mt-6">
            <Banner tone="error">{session.error ?? "That room could not be opened."}</Banner>
          </div>
          <Link href="/" className="mt-6">
            <Button variant="secondary" className="w-full sm:w-auto">
              Back to the lobby
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  const room = session.room;
  const unread = unreadCount;
  const presentCount = session.members.filter((member) => member.present).length;
  const behindCount = session.behindMembers.size;
  const connectionDot =
    session.connection === "connected" ? "bg-sage" : session.connection === "connecting" ? "bg-cobalt" : "bg-ember";
  const tabs: { id: Tab; label: string; count?: number; badge?: boolean }[] = [
    { id: "chat", label: "Chat", count: unread || undefined, badge: unread > 0 },
    { id: "queue", label: "Up next", count: room.queue?.length || undefined },
    { id: "people", label: "People", count: presentCount || undefined },
  ];

  const guestNote = !user ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel-2 px-4 py-3">
      <p className="text-sm text-muted">
        <span className="text-cream">Watching as a guest.</span> Make an account to keep this seat and host your own
        rooms.
      </p>
      <Link href={`/register?room=${room.code}`}>
        <Button size="sm" variant="secondary">
          Create account
        </Button>
      </Link>
    </div>
  ) : null;

  return (
    /*
     * A phone gets an app: one screen tall, the video pinned at the top and the
     * panel filling what is left, with the message box at the bottom. A phone
     * on its side puts them side by side. A wide screen scrolls as a page.
     */
    <main className="mx-auto flex h-dvh w-full max-w-[1440px] flex-col overflow-hidden lg:h-auto lg:min-h-dvh lg:overflow-visible lg:px-6 lg:pb-8">
      <header className="flex h-14 shrink-0 items-center gap-1 px-1.5 sm:gap-2 sm:px-3 lg:h-auto lg:gap-3 lg:px-0 lg:py-5">
        <Link
          href="/"
          aria-label="Leave the room"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-cream transition hover:bg-white/[0.06] active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight sm:text-base lg:text-lg">
            {room.videoTitle ?? room.title}
          </h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectionDot}`} aria-hidden />
            <span className="truncate">
              {presentCount} watching
              {behindCount > 0 ? <span className="text-cobalt-soft"> · {behindCount} catching up</span> : null}
              <span className="sm:hidden"> · {room.code}</span>
              {session.isHost ? (
                " · you're the host"
              ) : room.videoAuthor ? (
                <span className="hidden sm:inline"> · {room.videoAuthor}</span>
              ) : null}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
          <InviteButton room={room} />
          {session.isHost ? (
            <>
              <IconButton
                aria-label="Change what is playing"
                onClick={() => setChanging(true)}
                className="border-transparent bg-transparent sm:border-line sm:bg-panel/80"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </IconButton>
              <HostMenu session={session} />
            </>
          ) : null}
        </div>
      </header>

      {session.notice || (room.hostAwayUntil && !session.isHost) ? (
        <div className="shrink-0 space-y-2 px-3 pb-2 lg:px-0 lg:pb-4">
          {session.notice ? <Banner>{session.notice}</Banner> : null}
          {room.hostAwayUntil && !session.isHost ? <HostAwayBanner until={room.hostAwayUntil} /> : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col land:flex-row lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="shrink-0 land:min-w-0 land:flex-1 land:overflow-y-auto lg:space-y-4">
          <PlayerSurface session={session} />

          <div className="hidden flex-wrap items-center justify-between gap-3 lg:flex">
            <ReactionBar onReact={session.react} disabled={session.selfMuted || session.connection !== "connected"} />
            <WatchingSummary members={session.members} behindCount={behindCount} />
          </div>

          {guestNote ? <div className="hidden lg:block">{guestNote}</div> : null}
        </div>

        {/* One panel, three tabs: the conversation, what plays next, the audience. */}
        <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-panel land:w-[min(340px,42vw)] land:flex-none land:border-l land:border-t-0 lg:sticky lg:top-4 lg:h-[calc(100dvh-7.5rem)] lg:min-h-[480px] lg:flex-none lg:overflow-hidden lg:rounded-2xl lg:border">
          <div className="flex shrink-0 items-stretch border-b border-line" role="tablist" aria-label="Room panels">
            {tabs.map((entry) => {
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(entry.id)}
                  className={`relative flex h-12 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium transition ${
                    active ? "text-cream" : "text-muted hover:text-cream"
                  }`}
                >
                  {entry.label}
                  {entry.count ? (
                    <span
                      className={`min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[10px] ${
                        entry.badge ? "bg-cobalt text-white" : "bg-white/[0.07] text-muted"
                      }`}
                    >
                      {entry.count > 99 ? "99+" : entry.count}
                    </span>
                  ) : null}
                  <span
                    className={`absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-cobalt transition-opacity ${
                      active ? "opacity-100" : "opacity-0"
                    }`}
                    aria-hidden
                  />
                </button>
              );
            })}
            {/* Desktop notifications only fire from a hidden desktop tab; a phone has no use for the bell. */}
            {typeof Notification !== "undefined" ? (
              <button
                type="button"
                onClick={() => void toggleNotifications()}
                aria-label={notifyOn ? "Turn off desktop notifications" : "Notify me about new messages"}
                title={notifyOn ? "Notifications on" : "Notify me about new messages"}
                className={`hidden w-12 shrink-0 place-items-center transition lg:grid ${
                  notifyOn ? "text-cobalt-soft" : "text-faint hover:text-cream"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                  <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" strokeLinejoin="round" />
                  <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
                  {!notifyOn ? <path d="m4 4 16 16" strokeLinecap="round" /> : null}
                </svg>
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            {tab === "chat" ? (
              <ChatPanel
                messages={session.messages}
                presence={session.presence}
                selfMemberId={room.selfMemberId}
                onSend={session.sendChat}
                onTyping={session.setTyping}
                typing={session.typing}
                muted={session.selfMuted}
                onReact={session.react}
                reactDisabled={session.selfMuted || session.connection !== "connected"}
              />
            ) : tab === "queue" ? (
              <QueuePanel
                queue={room.queue ?? []}
                isHost={session.isHost}
                onAdd={() => setQueueing(true)}
                onRemove={session.dequeue}
                onMove={session.moveQueueItem}
                onSkip={session.skip}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                {guestNote ? <div className="shrink-0 p-3 pb-0 lg:hidden">{guestNote}</div> : null}
                <div className="min-h-0 flex-1">
                  <MembersPanel
                    members={session.members}
                    behindMembers={session.behindMembers}
                    selfMemberId={room.selfMemberId}
                    isHost={session.isHost}
                    onPatch={session.patchRoom}
                  />
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {toast
        ? createPortal(
            <button
              type="button"
              onClick={() => {
                // The chat is not on screen in fullscreen; step out to it.
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                setTab("chat");
                setToast(null);
              }}
              className={`sheet-in fixed z-40 flex items-start gap-3 rounded-2xl border border-line-strong bg-panel px-4 py-3 text-left shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)] ${
                fullscreenHost
                  ? "right-5 top-5 max-w-[22rem]"
                  : "inset-x-3 top-3 sm:inset-x-auto sm:bottom-5 sm:left-5 sm:top-auto sm:max-w-[22rem]"
              }`}
            >
              <Avatar name={toast.name} size={32} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{toast.name}</span>
                <span className="line-clamp-2 text-sm text-muted">{toast.body}</span>
              </span>
            </button>,
            fullscreenHost ?? document.body,
          )
        : null}

      {changing ? (
        <AddContentFlow
          open
          onClose={() => setChanging(false)}
          title="Change what's playing"
          onPick={async (item) => {
            await session.patchRoom({
              platform: item.platform,
              videoUrl: item.url,
              videoTitle: item.title,
              videoThumbnail: item.thumbnail,
              videoAuthor: item.author,
              durationMs: item.durationMs,
            });
            setChanging(false);
          }}
        />
      ) : null}

      {queueing ? (
        <AddContentFlow
          open
          onClose={() => setQueueing(false)}
          title="Add to the queue"
          onPick={async (item) => {
            await session.enqueue(item);
            setQueueing(false);
          }}
        />
      ) : null}
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <Room />
    </Suspense>
  );
}
