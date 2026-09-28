"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Button, Logo } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useFriendActivity } from "@/lib/friends";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" strokeLinejoin="round" />,
  },
  {
    href: "/discover",
    label: "Discover",
    icon: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/friends",
    label: "Friends",
    icon: (
      <>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3 19.5a6 6 0 0 1 12 0" strokeLinecap="round" />
        <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14a6 6 0 0 1 3.5 5.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/rooms",
    label: "Rooms",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="13" rx="3" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
        <path d="M8 21h8" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/account",
    label: "Account",
    icon: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
      </>
    ),
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Requests waiting on you, for the Friends tab's badge. */
function useRequestCount() {
  return useFriendActivity()?.incomingRequests ?? 0;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[9.5px] font-semibold leading-none text-ink">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * The tab bar below lg: Home, Discover, Friends, Rooms, Account. It floats over
 * the bottom of the page, so every page that shows it keeps its last row clear
 * with bottom padding (pb-32). Edge to edge on a phone; a centred pill on a
 * tablet, where five tabs spread across the whole width read as scattered.
 * Hidden from lg up, where AppHeader has the links.
 */
export function AppNav() {
  const pathname = usePathname() ?? "/";
  const requests = useRequestCount();
  return (
    <>
      {/* The page fades out under the bar rather than being cut by it. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-ink via-ink/80 to-transparent land:h-14 lg:hidden" aria-hidden />
      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto flex h-[60px] max-w-[26rem] items-center justify-between gap-0.5 rounded-[20px] border border-line bg-panel px-1.5 shadow-[0_18px_44px_-14px_rgb(0_0_0/0.9)] land:bottom-2 land:h-[52px] land:max-w-[22rem] lg:hidden"
      >
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.href === "/friends" && requests > 0 ? `Friends, ${requests} waiting` : undefined}
              className={`flex h-12 min-w-0 max-w-[76px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[14px] text-[10px] leading-none transition active:scale-95 land:h-11 ${
                active ? "bg-panel-3 font-semibold text-cream" : "font-medium text-[#8a877f] hover:text-cream"
              }`}
            >
              <span className="relative">
                <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  {item.icon}
                </svg>
                {item.href === "/friends" ? <Badge count={requests} /> : null}
              </span>
              {/* Sideways the screen is short: icons only, the name still read out. */}
              <span className="land:sr-only">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/**
 * The wide-screen top bar: the wordmark, the same destinations as the phone's
 * tab bar, and the account. Hidden below lg, where each page opens with its
 * own title and the tab bar does the navigating.
 */
export function AppHeader() {
  const pathname = usePathname() ?? "/";
  const requests = useRequestCount();
  return (
    <header className="hidden h-20 items-center justify-between gap-6 lg:flex">
      <div className="flex items-center gap-10">
        <Link href="/" aria-label="WatchParty home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {ITEMS.filter((item) => item.href !== "/account").map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-4 py-2 text-sm transition ${
                  active ? "bg-panel-2 font-medium text-cream" : "text-muted hover:text-cream"
                }`}
              >
                {item.label === "Rooms" ? "Your rooms" : item.label}
                {item.href === "/friends" && requests > 0 ? (
                  <span className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 align-[1px] text-[9.5px] font-semibold text-ink">
                    {requests > 9 ? "9+" : requests}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <AccountMenu />
    </header>
  );
}

/** The account on the right of the top bar: a menu when signed in, the two ways in when not. */
function AccountMenu() {
  const { user, loading, signOut } = useAuth();
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

  if (loading) return <span className="h-11 w-11 animate-pulse rounded-full bg-panel-2" aria-hidden />;

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
        <Link href="/register">
          <Button variant="secondary" size="sm">
            Sign up
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Account"
        className="flex items-center gap-2.5 rounded-full border border-line py-1 pl-1 pr-4 transition hover:border-line-strong"
      >
        <Avatar name={user.displayName} src={user.avatarUrl} size={34} ring />
        <span className="max-w-40 truncate text-sm">{user.displayName}</span>
      </button>
      {open ? (
        <div className="sheet-in absolute right-0 top-14 z-40 w-64 rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.85)]">
          <div className="px-3 pb-2 pt-2">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-faint">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex h-11 w-full items-center rounded-xl px-3 text-left text-sm text-muted transition hover:bg-white/[0.05] hover:text-cream"
          >
            Account
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex h-11 w-full items-center rounded-xl px-3 text-left text-sm text-muted transition hover:bg-white/[0.05] hover:text-cream"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
