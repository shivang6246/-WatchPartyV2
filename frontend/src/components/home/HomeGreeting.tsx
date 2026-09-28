"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

function partOfDay(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The top of the home screen. A signed-in visitor is greeted by name, with
 * search and their account to hand on a phone. Anyone else gets the pitch.
 *
 * <p>Until the session is known (a refresh round trip), both are drawn and the
 * first-paint hint on <html> (see layout.tsx) shows the one this visitor got
 * last time, name included. The real one then takes the same box, so nothing
 * below it moves: this block used to be the home screen's whole layout shift.
 */
export default function HomeGreeting() {
  const { user, loading } = useAuth();
  // The hour is the visitor's, so it is read after hydration, not on the server.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => setGreeting(partOfDay(new Date().getHours())), []);

  if (loading) {
    return (
      <>
        <div className="auth-in">
          <SignedIn greeting={greeting} name={null} avatarUrl={null} />
        </div>
        <div className="auth-out">
          <SignedOut />
        </div>
      </>
    );
  }
  return user ? <SignedIn greeting={greeting} name={user.displayName} avatarUrl={user.avatarUrl ?? null} /> : <SignedOut />;
}

/** name null: not known yet, so the hint's copy of it is shown (the .wp-name rule). */
function SignedIn({ greeting, name, avatarUrl }: { greeting: string; name: string | null; avatarUrl: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 pt-4 sm:pt-5 lg:pt-8">
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium text-muted sm:text-xs lg:text-sm">{greeting}</p>
        <h1 className="mt-0.5 truncate font-serif text-[22px] font-normal leading-tight tracking-[-0.01em] sm:text-[27px] lg:text-5xl">
          {name ?? <span className="wp-name" />}
        </h1>
      </div>
      {/* Drawn at 38px, tapped at 44: the targets stay full size. */}
      <div className="-mr-1 flex shrink-0 items-center lg:hidden">
        <Link href="/discover" aria-label="Search" className="grid h-11 w-11 place-items-center rounded-full transition active:scale-95">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-full border border-line text-cream">
            <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" strokeLinecap="round" />
            </svg>
          </span>
        </Link>
        <Link href="/account" aria-label="Account" className="grid h-11 w-11 place-items-center rounded-full transition active:scale-95">
          {name ? (
            <Avatar name={name} src={avatarUrl} size={34} ring />
          ) : (
            <span className="block h-[34px] w-[34px] rounded-full bg-panel-2 ring-1 ring-gold/70 ring-offset-2 ring-offset-ink" />
          )}
        </Link>
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="pt-4 sm:pt-6 lg:pt-12">
      <div className="flex items-center justify-between lg:hidden">
        <p className="font-serif text-[20px] leading-none">WatchParty</p>
        <Link href="/login" className="flex h-11 items-center rounded-full border border-line px-4 text-[13px] font-medium text-cream">
          Sign in
        </Link>
      </div>
      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold sm:mt-8 sm:text-[10.5px] lg:mt-0">
        YouTube, MP4, HLS and Vimeo
      </p>
      <h1 className="text-balance mt-2.5 max-w-3xl font-serif text-[2.15rem] font-normal leading-[1.04] tracking-[-0.015em] sm:mt-3 sm:text-5xl md:text-6xl lg:text-7xl">
        Watch together, <span className="italic">in perfect sync.</span>
      </h1>
      <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted sm:mt-4 sm:text-base md:text-lg">
        Start a room, share the code, and everyone presses play at the same moment. From any browser, on any screen.
      </p>
    </div>
  );
}
