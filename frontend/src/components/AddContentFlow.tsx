"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/Sheet";
import SourceIcon from "@/components/SourceIcon";
import YouTubeBrowser from "@/components/YouTubeBrowser";
import { Banner, Button, Input, Spinner } from "@/components/ui";
import { HttpError, api } from "@/lib/api";
import type { CatalogItem, Platform, SourceStatus } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen video; the caller decides whether that starts a
   *  new party or changes the video in an existing room. */
  onPick: (item: CatalogItem) => Promise<void> | void;
  title?: string;
}

// The same tiles the server sends (CatalogController.sources), so the list
// keeps its size when the real answer lands just after the sheet has opened.
export const FALLBACK_SOURCES: SourceStatus[] = [
  { id: "youtube", label: "YouTube", browsable: false, playableOnWeb: true },
  { id: "hosted", label: "Video link", browsable: false, playableOnWeb: true, note: "A direct MP4, WebM or HLS URL." },
  { id: "vimeo", label: "Vimeo", browsable: false, playableOnWeb: true, note: "Paste a Vimeo link." },
  {
    id: "drm_extension",
    label: "Netflix, Prime Video, Disney+",
    browsable: false,
    playableOnWeb: false,
    note: "DRM playback needs the desktop Chrome extension. The room still works for chat.",
  },
];

/** The last answer, so opening the picker again shows it straight away. */
let knownSources: SourceStatus[] | null = null;

/** The sources the server offers, starting from the last known answer. */
export function useSources(enabled = true) {
  const [sources, setSources] = useState<SourceStatus[]>(knownSources ?? FALLBACK_SOURCES);
  useEffect(() => {
    if (!enabled) return;
    api
      .sources()
      .then((fresh) => {
        knownSources = fresh;
        setSources(fresh);
      })
      .catch(() => undefined);
  }, [enabled]);
  return sources;
}

/** A pasted Vimeo or direct video link, read by the server and handed on. */
export function LinkForm({
  platform,
  onPick,
  autoFocus = true,
}: {
  platform: Extract<Platform, "hosted" | "vimeo">;
  onPick: (item: CatalogItem) => Promise<void> | void;
  autoFocus?: boolean;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!link.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api.resolveLink(link.trim(), platform);
      await onPick(item);
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That link could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        value={link}
        onChange={(event) => setLink(event.target.value)}
        placeholder={platform === "vimeo" ? "https://vimeo.com/..." : "https://example.com/video.mp4"}
        aria-label={platform === "vimeo" ? "Vimeo link" : "Video link"}
        type="url"
        inputMode="url"
        enterKeyHint="go"
        autoFocus={autoFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
      <p className="text-xs leading-relaxed text-muted">
        {platform === "vimeo"
          ? "Any public Vimeo video."
          : "A direct link to an MP4, WebM or HLS (.m3u8) file, not a page that contains one."}
      </p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button onClick={() => void submit()} disabled={!link.trim() || busy} className="w-full">
        {busy ? <Spinner /> : "Start watching"}
      </Button>
    </div>
  );
}

/**
 * The "+" flow: pick a source, then pick something to watch.
 *
 * <p>Sources come from the backend rather than being hard-coded, so a
 * deployment without a YouTube key shows the paste path instead of a search
 * box that cannot work.
 */
export default function AddContentFlow({ open, onClose, onPick, title = "Start a watch party" }: Props) {
  const sources = useSources(open);
  const [chosen, setChosen] = useState<Platform | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setChosen(null);
      setError(null);
      setBusyRef(null);
    }
  }, [open]);

  async function pick(item: CatalogItem) {
    setBusyRef(item.ref ?? item.url);
    setError(null);
    try {
      await onPick(item);
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That did not work. Try again.");
    } finally {
      setBusyRef(null);
    }
  }

  const heading = chosen === "youtube" ? "YouTube" : chosen === "vimeo" ? "Vimeo" : chosen === "hosted" ? "Video link" : title;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={heading}
      full={chosen === "youtube"}
      onBack={chosen !== null ? () => setChosen(null) : undefined}
    >
      {chosen === null ? (
        <div key="sources" className="fade-in space-y-2 p-4 sm:p-6">
          <p className="mb-3 text-sm text-muted">Pick where the video comes from.</p>
          {sources.map((source) => {
            const disabled = !source.playableOnWeb;
            return (
              <button
                key={source.id}
                type="button"
                disabled={disabled}
                onClick={() => setChosen(source.id)}
                className={`group flex w-full items-center gap-4 rounded-2xl border border-line bg-panel-2/50 px-4 py-3.5 text-left transition ${
                  disabled ? "opacity-50" : "hover:border-line-strong hover:bg-panel-2 active:scale-[0.99]"
                }`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-panel-3 text-gold">
                  <SourceIcon platform={source.id} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-cream">{source.label}</span>
                  {source.note ? (
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{source.note}</span>
                  ) : null}
                </span>
                {!disabled ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-cream" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  // The note already says so; on a phone the badge would only
                  // squeeze the label onto two lines.
                  <span className="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-faint sm:block">
                    Desktop
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : chosen === "youtube" ? (
        <YouTubeBrowser onPick={(item) => void pick(item)} busyRef={busyRef} />
      ) : chosen === "hosted" || chosen === "vimeo" ? (
        <div key={chosen} className="fade-in p-4 sm:p-6">
          <LinkForm platform={chosen} onPick={onPick} />
        </div>
      ) : null}

      {chosen === "youtube" && error ? (
        <div className="px-4 pb-4 sm:px-6">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
