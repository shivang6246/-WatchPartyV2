"use client";

import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Shows a back arrow before the title, for a step inside the sheet. */
  onBack?: () => void;
  /** Full height on a phone, used by the in-app browsers. */
  full?: boolean;
  children: ReactNode;
}

/**
 * A sheet that rises from the bottom on a phone and centres on a wide screen.
 * Everything the "+" opens lives in one of these.
 */
export default function Sheet({ open, onClose, title, onBack, full = false, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling under the sheet.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      {/* A plain scrim: a full-screen blur is the slowest thing a phone can paint. */}
      <button type="button" aria-label="Close" onClick={onClose} className="fade-in absolute inset-0 bg-ink/80" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet-in relative flex w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-line-strong bg-panel shadow-[0_-20px_80px_-20px_rgb(0_0_0/0.8)] sm:rounded-3xl sm:border-b ${
          full ? "h-[92dvh] sm:h-[86dvh] sm:max-w-3xl" : "max-h-[90dvh] sm:max-w-lg"
        }`}
      >
        <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2 sm:px-5 sm:pt-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-cream"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
          {title ? (
            <h2 className={`min-w-0 flex-1 truncate text-lg font-semibold tracking-tight ${onBack ? "" : "pl-2 sm:pl-1"}`}>{title}</h2>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-cream"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">{children}</div>
      </div>
    </div>
  );
}
