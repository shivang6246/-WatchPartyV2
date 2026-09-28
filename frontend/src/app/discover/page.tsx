"use client";

import Link from "next/link";
import { useState } from "react";
import { LinkForm, useSources } from "@/components/AddContentFlow";
import { AppHeader, AppNav } from "@/components/AppNav";
import SourceIcon from "@/components/SourceIcon";
import YouTubeBrowser from "@/components/YouTubeBrowser";
import { Banner, Button, Spinner } from "@/components/ui";
import { useStartParty } from "@/components/home/useStartParty";
import { useAuth } from "@/lib/auth-context";
import type { Platform } from "@/lib/types";

const SHORT_LABELS: Partial<Record<Platform, string>> = {
  hosted: "Video link",
  drm_extension: "Netflix & more",
};

/**
 * The picker as a page: choose a source, find something, and it becomes a
 * party. The same pieces as the "+" sheet (sources from the server, the
 * YouTube browser, the link form), laid out for browsing.
 */
export default function DiscoverPage() {
  const { user, loading: authLoading } = useAuth();
  const sources = useSources();
  const { start, error, busyRef } = useStartParty();
  const [chosen, setChosen] = useState<Platform>("youtube");
  const current = sources.find((source) => source.id === chosen);

  return (
    <main className="spotlight mx-auto w-full max-w-6xl px-5 pb-32 sm:px-6 lg:px-8 lg:pb-16">
      <AppHeader />

      <header className="flex items-end justify-between gap-4 pt-5 lg:pt-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal leading-tight sm:text-[31px] tracking-[-0.01em] lg:text-5xl">Discover</h1>
          <p className="mt-1 text-[13px] text-muted lg:text-sm">Pick something to watch together.</p>
        </div>
      </header>

      <p className="mt-6 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted">Sources</p>
      <div className="mt-3 grid grid-cols-4 gap-2.5 sm:flex sm:gap-3" role="radiogroup" aria-label="Where the video comes from">
        {sources.map((source) => {
          const active = source.id === chosen;
          return (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setChosen(source.id)}
              className={`flex flex-col items-center gap-2 text-center transition active:scale-95 sm:w-24 ${
                active ? "text-cream" : "text-muted hover:text-cream"
              }`}
            >
              <span
                className={`relative grid h-[66px] w-[66px] place-items-center rounded-[18px] border transition ${
                  active ? "border-gold/70 bg-panel-2 text-cream" : "border-line bg-panel text-[#c9c6bf]"
                }`}
              >
                <SourceIcon platform={source.id} className="h-6 w-6" />
                {!source.playableOnWeb ? (
                  <span className="absolute -right-3 -top-2 rounded-full border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Desktop
                  </span>
                ) : null}
              </span>
              <span className={`text-xs leading-tight ${active ? "font-semibold" : "font-medium"}`}>
                {SHORT_LABELS[source.id] ?? source.label}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-5">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      <div className="mt-6">
        {chosen === "youtube" ? (
          // Browsing YouTube needs an account (trending takes a region and
          // search costs quota, so neither is public). Until the session is
          // known nothing is asked for, so a visitor never gets a refusal.
          authLoading ? (
            <div className="flex items-center gap-2.5 py-6 text-sm text-muted">
              <Spinner className="h-4 w-4 text-gold" /> Loading…
            </div>
          ) : user ? (
            <YouTubeBrowser page onPick={(item) => void start(item).catch(() => undefined)} busyRef={busyRef} />
          ) : (
            <div className="fade-in max-w-lg rounded-[20px] border border-line bg-panel p-5 sm:p-6">
              <h2 className="font-serif text-2xl font-normal">Browse YouTube</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Sign in to search YouTube and start a party. Joining a friend&apos;s room needs no account.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/login?next=/discover">
                  <Button>Sign in</Button>
                </Link>
                <Link href="/register">
                  <Button variant="secondary">Create account</Button>
                </Link>
              </div>
            </div>
          )
        ) : chosen === "hosted" || chosen === "vimeo" ? (
          <div key={chosen} className="fade-in max-w-lg rounded-[20px] border border-line bg-panel p-5 sm:p-6">
            <h2 className="font-serif text-2xl font-normal">{chosen === "vimeo" ? "Vimeo" : "Paste a video link"}</h2>
            <div className="mt-4">
              <LinkForm platform={chosen} onPick={(item) => start(item)} autoFocus={false} />
            </div>
          </div>
        ) : (
          <div className="fade-in max-w-lg rounded-[20px] border border-line bg-panel p-5 sm:p-6">
            <h2 className="font-serif text-2xl font-normal">{current?.label ?? "Netflix, Prime Video, Disney+"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {current?.note ?? "DRM playback needs the desktop Chrome extension. The room still works for chat."}
            </p>
          </div>
        )}
      </div>

      <AppNav />
    </main>
  );
}
