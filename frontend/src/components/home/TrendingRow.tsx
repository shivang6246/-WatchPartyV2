"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Poster from "@/components/Poster";
import { Banner, Spinner, formatTime } from "@/components/ui";
import { useStartParty } from "@/components/home/useStartParty";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CatalogItem } from "@/lib/types";

/**
 * What is trending on YouTube, one tap from a party. Only where the server
 * can browse YouTube (it holds an API key); otherwise nothing renders, and
 * pasting a link in Discover still works.
 */
export default function TrendingRow() {
  const { user, loading } = useAuth();
  const { start, error, busyRef } = useStartParty();
  const [items, setItems] = useState<CatalogItem[]>([]);

  // Trending needs an account (it takes a region, so it is not public the
  // way the trailers are), and starting a party does too: a visitor who is
  // signed out gets no row rather than a refused request.
  const signedIn = !loading && user !== null;
  useEffect(() => {
    if (!signedIn) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api
      .sources()
      .then((sources) => {
        if (!sources.find((source) => source.id === "youtube")?.browsable) return null;
        return api.youtubeTrending();
      })
      .then((page) => {
        if (!cancelled && page) setItems(page.items.slice(0, 8));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (items.length === 0) return null;

  return (
    <section className="animate-rise" aria-labelledby="trending">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="trending" className="text-[15px] font-semibold tracking-[-0.01em] lg:text-lg">
          Trending on YouTube
        </h2>
        <Link href="/discover" className="-my-3 py-3 text-[12.5px] font-medium text-muted transition hover:text-cream">
          See all
        </Link>
      </div>
      {error ? (
        <div className="mb-3">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}
      <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.ref ?? item.url}
            type="button"
            onClick={() => void start(item).catch(() => undefined)}
            disabled={busyRef !== null}
            className="group w-[188px] shrink-0 text-left disabled:opacity-60 sm:w-auto"
          >
            <div className="relative aspect-video overflow-hidden rounded-xl border border-line bg-panel-2 sm:rounded-[14px]">
              {item.thumbnail ? (
                <div className="h-full w-full transition duration-700 group-hover:scale-[1.04]">
                  <Poster src={item.thumbnail} />
                </div>
              ) : null}
              {item.live || item.durationMs ? (
                <span className="absolute bottom-2 right-2 rounded-md bg-ink/85 px-1.5 py-0.5 font-mono text-[10.5px]">
                  {item.live ? "LIVE" : formatTime(item.durationMs ?? 0)}
                </span>
              ) : null}
              {busyRef === (item.ref ?? item.url) ? (
                <span className="absolute inset-0 grid place-items-center bg-ink/70 text-gold">
                  <Spinner />
                </span>
              ) : null}
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-snug sm:mt-2.5 sm:text-[13.5px]">{item.title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted sm:text-xs">{item.author}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
