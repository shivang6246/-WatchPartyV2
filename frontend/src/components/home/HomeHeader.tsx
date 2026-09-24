"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Logo } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

/** The landing page's top bar: the mark, and the account on the right. */
export default function HomeHeader() {
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

  return (
    <header className="flex h-16 items-center justify-between gap-3">
      <Link href="/" aria-label="WatchParty home">
        <Logo />
      </Link>

      {loading ? (
        <span className="h-9 w-9 animate-pulse rounded-full bg-panel-2" aria-hidden />
      ) : user ? (
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Account"
            className="flex items-center gap-2 rounded-full border border-line bg-panel py-1 pl-1 pr-1 transition hover:border-line-strong sm:pr-3"
          >
            <Avatar name={user.displayName} src={user.avatarUrl} size={32} />
            <span className="hidden max-w-32 truncate text-sm sm:block">{user.displayName}</span>
          </button>
          {open ? (
            <div className="sheet-in absolute right-0 top-12 z-40 w-60 rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.85)]">
              <div className="px-3 pb-2 pt-2">
                <p className="truncate text-sm font-medium">{user.displayName}</p>
                <p className="truncate text-xs text-faint">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-line" />
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
      ) : (
        <div className="flex items-center gap-1">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="max-sm:px-3">
              Sign in
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="secondary" size="sm" className="max-sm:px-3">
              Sign up
            </Button>
          </Link>
        </div>
      )}
    </header>
  );
}
