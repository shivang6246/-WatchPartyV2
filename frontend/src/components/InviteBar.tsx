"use client";

import { useState } from "react";
import type { RoomView } from "@/lib/types";

/**
 * The header's invite control. The room code alone lets anyone in, so every
 * member can share it; the host's link also carries the invite token.
 */
export default function InviteButton({ room }: { room: RoomView }) {
  const [copied, setCopied] = useState(false);

  function link() {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/room/${room.code}`;
    return room.inviteToken ? `${base}?invite=${encodeURIComponent(room.inviteToken)}` : base;
  }

  async function share() {
    const url = link();
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: room.title, text: `Join me in room ${room.code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      className="group grid h-10 w-10 shrink-0 place-items-center rounded-full text-cream transition hover:bg-white/[0.06] active:scale-95 sm:flex sm:w-auto sm:items-center sm:gap-2 sm:border sm:border-dashed sm:border-cobalt/45 sm:bg-cobalt/[0.06] sm:pl-3 sm:pr-1 sm:hover:border-cobalt/80 sm:hover:bg-cobalt/[0.1]"
      aria-label={`Invite friends to room ${room.code}`}
      title="Invite friends"
    >
      {/* A phone gets the share icon; the code is in the header line below the title. */}
      <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        {copied ? (
          <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" strokeLinecap="round" />
          </>
        )}
      </svg>
      <span className="hidden font-mono text-[12px] tracking-[0.2em] text-cobalt-soft sm:inline">{room.code}</span>
      <span className="hidden h-8 items-center gap-1.5 rounded-full bg-cobalt px-3 text-xs font-semibold text-white sm:flex">
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
              <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Copied
          </>
        ) : (
          "Invite"
        )}
      </span>
    </button>
  );
}
