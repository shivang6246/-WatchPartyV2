"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
 *
 * <p>It is portalled to the body: a transformed ancestor (an entrance
 * animation, say) becomes the containing block of anything fixed inside it,
 * and the sheet would be pinned to that box instead of the screen.
 */
export default function Sheet({ open, onClose, title, onBack, full = false, children }: Props) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Callers pass a fresh arrow each render; the effect below must not rerun for it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling under the sheet. Hiding a desktop
    // scrollbar widens the page, so its width is padded back in, or everything
    // behind the scrim would jump sideways.
    const body = document.body;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, [open]);

  // The on-screen keyboard covers the bottom of the page without resizing it
  // (see the viewport in layout.tsx), and the bottom is where a sheet sits. So
  // the sheet lays itself out in the visual viewport, the part left showing.
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const overlay = overlayRef.current;
    if (!open || !viewport || !overlay) return;
    const fit = () => {
      overlay.style.top = `${viewport.offsetTop}px`;
      overlay.style.height = `${viewport.height}px`;
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // A phone on its side has no height to spare for a margin around the sheet.
    <div ref={overlayRef} className="fixed inset-x-0 top-0 z-50 flex h-dvh items-end justify-center sm:items-center sm:p-6 land:p-2">
      {/* A plain scrim: a full-screen blur is the slowest thing a phone can paint. */}
      <button type="button" aria-label="Close" onClick={onClose} className="fade-in absolute inset-0 bg-ink/80" />
      <div
        // A step that changes the sheet's size rises in again at the new size,
        // rather than the sheet jumping to it.
        key={full ? "full" : "fit"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet-in relative flex w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-line-strong bg-panel shadow-[0_-20px_80px_-20px_rgb(0_0_0/0.8)] sm:rounded-3xl sm:border-b ${
          full ? "h-[92%] sm:h-[90%] sm:max-w-3xl land:h-full" : "max-h-[90%] sm:max-h-full sm:max-w-lg"
        }`}
      >
        <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2 sm:px-5 sm:pt-4 land:py-1.5">
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
    </div>,
    document.body,
  );
}
