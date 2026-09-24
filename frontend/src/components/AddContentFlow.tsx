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

const FALLBACK_SOURCES: SourceStatus[] = [
  { id: "youtube", label: "YouTube", browsable: false, playableOnWeb: true },
  { id: "hosted", label: "Video link", browsable: false, playableOnWeb: true },
  { id: "vimeo", label: "Vimeo", browsable: false, playableOnWeb: true },
];

/**
 * The "+" flow: pick a source, then pick something to watch.
 *
 * <p>Sources come from the backend rather than being hard-coded, so a
 * deployment without a YouTube key shows the paste path instead of a search
 * box that cannot work.
 */
export default function AddContentFlow({ open, onClose, onPick, title = "Start a watch party" }: Props) {
  const [sources, setSources] = useState<SourceStatus[]>(FALLBACK_SOURCES);
  const [chosen, setChosen] = useState<Platform | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.sources().then(setSources).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setChosen(null);
      setLink("");
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

  async function useLink(platform: Platform) {
    if (!link.trim()) return;
    setResolving(true);
    setError(null);
    try {
      const item = await api.resolveLink(link.trim(), platform);
      await pick(item);
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That link could not be read.");
    } finally {
      setResolving(false);
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
        <div className="space-y-2 p-4 sm:p-6">
          <p className="mb-3 text-sm text-muted">Pick where the video comes from.</p>
          {sources.map((source) => {
            const disabled = !source.playableOnWeb;
            return (
              <button
                key={source.id}
                type="button"
                disabled={disabled}
                onClick={() => setChosen(source.id)}
                className={`group flex w-full items-center gap-4 rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5 text-left transition ${
                  disabled ? "opacity-50" : "hover:border-cobalt/35 hover:bg-panel-2 active:scale-[0.99]"
                }`}
              >
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                    source.id === "youtube"
                      ? "bg-ember/15 text-ember"
                      : source.id === "vimeo"
                        ? "bg-[#7cc4e8]/15 text-[#9ed4ef]"
                        : source.id === "hosted"
                          ? "bg-sage/15 text-sage"
                          : "bg-white/[0.06] text-muted"
                  }`}
                >
                  <SourceIcon platform={source.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-cream">{source.label}</span>
                  {source.note ? (
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{source.note}</span>
                  ) : null}
                </span>
                {!disabled ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-cobalt" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-faint">
                    Extension
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : chosen === "youtube" ? (
        <YouTubeBrowser onPick={(item) => void pick(item)} busyRef={busyRef} />
      ) : (
        <div className="space-y-4 p-4 sm:p-6">
          <Input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={chosen === "vimeo" ? "https://vimeo.com/..." : "https://example.com/video.mp4"}
            type="url"
            inputMode="url"
            enterKeyHint="go"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") void useLink(chosen);
            }}
          />
          <p className="text-xs leading-relaxed text-muted">
            {chosen === "vimeo"
              ? "Any public Vimeo video."
              : "A direct link to an MP4, WebM or HLS (.m3u8) file, not a page that contains one."}
          </p>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button onClick={() => void useLink(chosen)} disabled={!link.trim() || resolving} className="w-full">
            {resolving || busyRef ? <Spinner /> : "Start watching"}
          </Button>
        </div>
      )}

      {chosen === "youtube" && error ? (
        <div className="px-4 pb-4 sm:px-6">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
