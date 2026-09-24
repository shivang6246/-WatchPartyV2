"use client";

import type { Platform } from "@/lib/types";

/** Simple marks rather than brand logos: no trademark is being reproduced. */
export default function SourceIcon({ platform, className = "h-6 w-6" }: { platform: Platform; className?: string }) {
  switch (platform) {
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.2 5 12 5 12 5s-6.2 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.8 19 12 19 12 19s6.2 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z" />
        </svg>
      );
    case "hosted":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "vimeo":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M22 8.2c-.1 2.1-1.6 5-4.4 8.6-2.9 3.8-5.4 5.7-7.4 5.7-1.3 0-2.3-1.2-3.2-3.5L5.3 13c-.6-2.3-1.3-3.5-2-3.5-.2 0-.7.3-1.5.9L1 9.2c.9-.8 1.8-1.7 2.7-2.5 1.2-1.1 2.1-1.6 2.7-1.7 1.5-.2 2.4.9 2.7 3.1.4 2.5.7 4 .8 4.6.4 1.9.9 2.8 1.4 2.8.4 0 1-.6 1.8-1.9.8-1.3 1.2-2.2 1.3-2.9.1-1-.3-1.5-1.3-1.5-.4 0-.9.1-1.4.3C13 5.9 14.9 3.9 17.5 4c1.9.1 2.8 1.5 2.7 4.2z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="4" y="10" width="16" height="10" rx="2.5" />
          <path d="M8 10V7.5a4 4 0 1 1 8 0V10" strokeLinecap="round" />
        </svg>
      );
  }
}
