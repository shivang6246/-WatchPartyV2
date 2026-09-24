"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Poster from "@/components/Poster";
import { Banner, Button, Input, Spinner, formatTime } from "@/components/ui";
import { HttpError, api } from "@/lib/api";
import type { CatalogItem } from "@/lib/types";

interface Props {
  onPick: (item: CatalogItem) => void;
  busyRef?: string | null;
}

/**
 * YouTube, inside the app.
 *
 * <p>youtube.com refuses to be framed, so this is not an iframe of the site:
 * results are fetched through our own backend (which holds the API key) and
 * rendered here, and only the player itself is embedded once a video is
 * chosen. Without an API key the same screen still works by pasting a link.
 */
export default function YouTubeBrowser({ onPick, busyRef }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchDisabled, setSearchDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const requestId = useRef(0);

  // One box does both: a link is used as it is, anything else is a search.
  const pastedLink = /^(https?:\/\/|www\.|youtu\.be\/|(m\.)?youtube\.com\/)/i.test(query.trim()) ? query.trim() : null;

  // The keyboard only opens by itself where there is a real one; on a phone it
  // would cover the results the viewer came to browse.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  const load = useCallback(async (term: string, pageToken?: string | null) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = term.trim()
        ? await api.youtubeSearch(term.trim(), pageToken)
        : await api.youtubeTrending();
      if (id !== requestId.current) return;
      setSearchDisabled(page.notice === "search_unavailable");
      setItems((current) => (pageToken ? [...current, ...page.items] : page.items));
      setNextPageToken(page.nextPageToken ?? null);
    } catch (ex) {
      if (id !== requestId.current) return;
      setError(ex instanceof HttpError ? ex.message : "Could not reach YouTube.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Debounced, because every keystroke would otherwise cost API quota.
  useEffect(() => {
    if (searchDisabled || pastedLink) return;
    const timer = setTimeout(() => void load(query), 400);
    return () => clearTimeout(timer);
  }, [query, load, searchDisabled, pastedLink]);

  async function usePastedLink() {
    if (!pastedLink) return;
    setResolving(true);
    setError(null);
    try {
      const item = await api.resolveLink(pastedLink, "youtube");
      onPick(item);
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That link could not be read.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 space-y-3 border-b border-line bg-panel px-4 py-3 sm:px-6 sm:py-4 land:py-2">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            if (pastedLink) void usePastedLink();
            else inputRef.current?.blur();
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" strokeLinecap="round" />
          </svg>
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchDisabled ? "Paste a YouTube link" : "Search or paste a YouTube link"}
            aria-label={searchDisabled ? "YouTube link" : "Search YouTube or paste a link"}
            type="search"
            enterKeyHint={pastedLink ? "go" : "search"}
            className="pl-11"
          />
        </form>

        {pastedLink ? (
          <Button onClick={() => void usePastedLink()} disabled={resolving} className="w-full">
            {resolving ? <Spinner /> : "Use this link"}
          </Button>
        ) : null}

        {searchDisabled ? (
          <Banner>Search needs a YouTube Data API key on the server. Pasting a link works without one.</Banner>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex animate-pulse gap-3 sm:block land:flex">
                <div className="aspect-video w-[42%] max-w-44 shrink-0 rounded-xl bg-panel-2 sm:w-full sm:max-w-none sm:rounded-2xl land:w-[42%] land:max-w-44 land:rounded-xl" />
                <div className="flex-1 space-y-2 py-1 sm:mt-2.5 land:mt-0">
                  <div className="h-3 w-3/4 rounded bg-panel-2" />
                  <div className="h-3 w-1/3 rounded bg-panel-2" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            {searchDisabled || pastedLink ? "Paste a link above to start." : "Nothing found. Try another search."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {items.map((item) => (
              <button
                key={item.ref}
                type="button"
                onClick={() => onPick(item)}
                disabled={busyRef === item.ref}
                className="group flex gap-3 text-left transition active:scale-[0.99] disabled:opacity-60 sm:block land:flex"
              >
                <div className="relative aspect-video w-[42%] max-w-44 shrink-0 overflow-hidden rounded-xl border border-line bg-panel-2 transition group-hover:border-cobalt/40 sm:w-full sm:max-w-none sm:rounded-2xl land:w-[42%] land:max-w-44 land:rounded-xl">
                  {item.thumbnail ? (
                    <div className="h-full w-full transition duration-500 group-hover:scale-[1.05]">
                      <Poster src={item.thumbnail} />
                    </div>
                  ) : null}
                  {item.live || item.durationMs ? (
                    <span
                      className={`absolute bottom-2 right-2 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] ${
                        item.live ? "bg-ember text-ink" : "bg-ink/85 text-cream"
                      }`}
                    >
                      {item.live ? "LIVE" : formatTime(item.durationMs ?? 0)}
                    </span>
                  ) : null}
                  {busyRef === item.ref ? (
                    <span className="absolute inset-0 grid place-items-center bg-ink/70 text-cobalt">
                      <Spinner />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 py-0.5 sm:mt-2.5 sm:py-0 land:mt-0 land:py-0.5">
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-cream transition group-hover:text-cobalt-soft">
                    {item.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">{item.author}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {nextPageToken && !searchDisabled && !pastedLink ? (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => void load(query, nextPageToken)} disabled={loading}>
              {loading ? <Spinner /> : "Show more"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
