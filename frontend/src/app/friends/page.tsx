"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, AppNav } from "@/components/AppNav";
import { Avatar, Banner, Button, Input, LiveDot, Spinner } from "@/components/ui";
import { HttpError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { refreshFriendActivity } from "@/lib/friends";
import type { FriendRequestView, FriendView, FriendsOverview } from "@/lib/types";

/** The list keeps "watching" current while it is on screen. */
const REFRESH_MS = 10_000;

function Friends() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState<FriendsOverview | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const addCode = params.get("add");

  const reload = useCallback(async () => {
    try {
      setOverview(await api.friends());
    } catch {
      // Keep what is on screen; the next refresh tries again.
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void reload();
    const refresh = () => {
      if (!document.hidden) void reload();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, reload]);

  /** Every change answers with the new overview; the tab bar's badge follows. */
  const act = useCallback(async (key: string, action: () => Promise<FriendsOverview>, done?: string) => {
    setBusy(key);
    setNotice(null);
    try {
      setOverview(await action());
      if (done) setNotice({ tone: "success", text: done });
      refreshFriendActivity();
      return true;
    } catch (ex) {
      setNotice({ tone: "error", text: ex instanceof HttpError ? ex.message : "That did not work. Try again." });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  // Opened from someone's friend link: add them once, then tidy the address.
  const usedCode = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !addCode || usedCode.current === addCode) return;
    usedCode.current = addCode;
    void act("link", () => api.addFriend({ code: addCode }), "You are friends now. You will see when they are watching.").then(() =>
      router.replace("/friends"),
    );
  }, [user, addCode, act, router]);

  return (
    <main className="spotlight mx-auto w-full max-w-6xl px-5 pb-32 sm:px-6 lg:px-8 lg:pb-16">
      <AppHeader />

      <header className="pt-5 lg:pt-8">
        <h1 className="font-serif text-[28px] font-normal leading-tight sm:text-[31px] tracking-[-0.01em] lg:text-5xl">Friends</h1>
        <p className="mt-1 text-[13px] text-muted lg:text-sm">See what your friends are watching, and join them in one tap.</p>
      </header>

      {notice ? (
        <div className="mt-5 max-w-xl">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-8 h-40 max-w-xl animate-pulse rounded-[20px] bg-panel" aria-hidden />
      ) : !user ? (
        <SignedOut next={addCode ? `/friends?add=${encodeURIComponent(addCode)}` : "/friends"} />
      ) : !overview ? (
        <div className="mt-10 flex items-center gap-2.5 text-sm text-muted">
          <Spinner className="h-4 w-4 text-gold" /> Loading your friends…
        </div>
      ) : (
        <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="space-y-6">
            {overview.incoming.length > 0 ? (
              <section aria-labelledby="incoming">
                <SectionTitle id="incoming" count={overview.incoming.length}>
                  Waiting on you
                </SectionTitle>
                <ul className="space-y-2">
                  {overview.incoming.map((request) => (
                    <RequestRow key={request.id} request={request} label="wants to be friends">
                      <Button size="sm" disabled={busy !== null} onClick={() => void act(request.id, () => api.acceptFriend(request.id))}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void act(request.id, () => api.dismissFriendRequest(request.id))}
                      >
                        Decline
                      </Button>
                    </RequestRow>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="friends-list">
              <SectionTitle id="friends-list" count={overview.friends.length}>
                Your friends
              </SectionTitle>
              {overview.friends.length === 0 ? (
                <div className="rounded-[20px] border border-line bg-panel px-6 py-10 text-center">
                  <p className="font-serif text-2xl italic text-cream/85">No friends yet.</p>
                  <p className="mt-1 text-sm text-faint">Add someone by email, share your link, or tap &ldquo;Add friend&rdquo; in a room&apos;s People tab.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {overview.friends.map((friend) => (
                    <FriendRow
                      key={friend.userId}
                      friend={friend}
                      busy={busy === friend.userId}
                      onRemove={() => void act(friend.userId, () => api.unfriend(friend.userId))}
                    />
                  ))}
                </ul>
              )}
            </section>

            {overview.outgoing.length > 0 ? (
              <section aria-labelledby="outgoing">
                <SectionTitle id="outgoing" count={overview.outgoing.length}>
                  Requests you sent
                </SectionTitle>
                <ul className="space-y-2">
                  {overview.outgoing.map((request) => (
                    <RequestRow key={request.id} request={request} label="hasn't answered yet">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void act(request.id, () => api.dismissFriendRequest(request.id))}
                      >
                        Cancel
                      </Button>
                    </RequestRow>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="space-y-4 lg:sticky lg:top-6">
            <AddFriend busy={busy === "add"} onAdd={(email) => act("add", () => api.addFriend({ email }), `Request sent to ${email}.`)} />
            <FriendLink />
            <Privacy
              share={overview.shareActivity}
              busy={busy === "share"}
              onChange={(share) => void act("share", () => api.setShareActivity(share))}
            />
          </div>
        </div>
      )}

      <AppNav />
    </main>
  );
}

function SectionTitle({ id, count, children }: { id: string; count: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em] lg:text-lg">
      {children}
      {count > 0 ? <span className="text-xs font-medium text-faint">{count}</span> : null}
    </h2>
  );
}

function FriendRow({ friend, busy, onRemove }: { friend: FriendView; busy: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const room = friend.watching;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-3 pr-2.5">
      <Avatar name={friend.displayName} src={friend.avatarUrl} size={44} ring={Boolean(room)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{friend.displayName}</p>
        {room ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gold-soft">
            <LiveDot className="shrink-0" />
            <span className="truncate">Watching {room.videoTitle ?? room.title}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-faint">Not watching right now</p>
        )}
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="danger" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <>
          {room ? (
            <Link
              href={`/room/${room.code}`}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-cream pl-3 pr-4 text-[13px] font-semibold text-ink transition hover:bg-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
                <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
              </svg>
              Join
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${friend.displayName} from friends`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-faint transition hover:bg-white/[0.05] hover:text-cream"
          >
            <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
        </>
      )}
    </li>
  );
}

function RequestRow({ request, label, children }: { request: FriendRequestView; label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3">
      <Avatar name={request.displayName} src={request.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{request.displayName}</p>
        <p className="mt-0.5 text-xs text-muted">{label}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  );
}

function AddFriend({ busy, onAdd }: { busy: boolean; onAdd: (email: string) => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  return (
    <section aria-labelledby="add-friend" className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <h2 id="add-friend" className="font-serif text-2xl font-normal">
        Add a friend
      </h2>
      <p className="mt-1 text-sm text-muted">By the email they signed up with.</p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!email.trim()) return;
          if (await onAdd(email.trim())) setEmail("");
        }}
      >
        <label htmlFor="friend-email" className="sr-only">
          Their email
        </label>
        <Input
          id="friend-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="friend@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy || !email.trim()} className="h-12 shrink-0">
          {busy ? <Spinner className="h-4 w-4" /> : "Send"}
        </Button>
      </form>
    </section>
  );
}

/** Your "add me" link: whoever opens it while signed in becomes your friend. */
function FriendLink() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    api
      .friendLink()
      .then((link) => setCode(link.code))
      .catch(() => undefined);
  }, []);

  const url = code && typeof window !== "undefined" ? `${window.location.origin}/friends?add=${code}` : null;

  async function share() {
    if (!url) return;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Be my friend on WatchParty", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="friend-link" className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <h2 id="friend-link" className="font-serif text-2xl font-normal">
        Your friend link
      </h2>
      <p className="mt-1 text-sm text-muted">Anyone who opens it while signed in becomes your friend straight away.</p>
      <div className="mt-4 flex items-center gap-2 rounded-full border border-line-strong bg-ink p-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] tracking-[0.04em] text-cream/90">
          {url ? url.replace(/^https?:\/\//, "") : "…"}
        </span>
        <Button size="sm" onClick={() => void share()} disabled={!url} className="shrink-0">
          {copied ? "Copied" : "Share"}
        </Button>
      </div>
      <button
        type="button"
        disabled={rotating}
        onClick={async () => {
          setRotating(true);
          try {
            setCode((await api.rotateFriendLink()).code);
          } finally {
            setRotating(false);
          }
        }}
        className="mt-3 text-xs font-medium text-muted underline-offset-4 transition hover:text-cream hover:underline disabled:opacity-50"
      >
        Make a new link (old ones stop working)
      </button>
    </section>
  );
}

function Privacy({ share, busy, onChange }: { share: boolean; busy: boolean; onChange: (share: boolean) => void }) {
  return (
    <section className="flex items-start justify-between gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <div>
        <p id="share-label" className="text-[15px] font-semibold">
          Show friends what I&apos;m watching
        </p>
        <p className="mt-1 text-sm text-muted">
          {share
            ? "Friends see the room you are in and can join it."
            : "Friends see you on their list, but not where you are."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={share}
        aria-labelledby="share-label"
        disabled={busy}
        onClick={() => onChange(!share)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-60 ${
          share ? "border-gold/60 bg-gold/80" : "border-line-strong bg-panel-3"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${share ? "left-[1.4rem] bg-ink" : "left-0.5 bg-cream/80"}`}
          aria-hidden
        />
      </button>
    </section>
  );
}

function SignedOut({ next }: { next: string }) {
  return (
    <div className="mt-8 max-w-xl rounded-[20px] border border-line bg-panel px-6 py-10 text-center">
      <p className="font-serif text-2xl italic text-cream/85">Friends need an account.</p>
      <p className="mt-1 text-sm text-faint">Sign in to add friends and see when they are watching.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href={`/login?next=${encodeURIComponent(next)}`}>
          <Button>Sign in</Button>
        </Link>
        <Link href={`/register?next=${encodeURIComponent(next)}`}>
          <Button variant="secondary">Create account</Button>
        </Link>
      </div>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={null}>
      <Friends />
    </Suspense>
  );
}
