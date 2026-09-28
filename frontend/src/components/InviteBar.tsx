"use client";

import { useState } from "react";
import type { RoomView } from "@/lib/types";

function inviteLink(room: RoomView) {
  if (typeof window === "undefined") return "";
  const base = `${window.location.origin}/room/${room.code}`;
  return room.inviteToken ? `${base}?invite=${encodeURIComponent(room.inviteToken)}` : base;
}

/** Shares on a phone (the system sheet), copies everywhere else. */
function useShare(room: RoomView) {
  const [copied, setCopied] = useState(false);
  async function share(text: string, prefer: "share" | "copy") {
    try {
      if (prefer === "share" && navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: room.title, text: `Join me in room ${room.code}`, url: text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return { copied, share };
}

/**
 * The header's invite control. The room code alone lets anyone in, so every
 * member can share it; the host's link also carries the invite token.
 */
export default function InviteButton({ room }: { room: RoomView }) {
  const { copied, share } = useShare(room);
  return (
    <button
      type="button"
      onClick={() => void share(inviteLink(room), "share")}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-cream pl-3 pr-4 text-[13px] font-semibold text-ink transition hover:bg-white active:scale-95 lg:h-11 lg:pl-3.5 lg:pr-5 lg:text-sm"
      aria-label={`Invite friends to room ${room.code}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        {copied ? (
          <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <path d="M12 15V4M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" strokeLinecap="round" />
          </>
        )}
      </svg>
      {copied ? "Copied" : "Invite"}
    </button>
  );
}

/** The code itself, with a copy button. Wide screens only; a phone shows it under the title. */
export function RoomCodeChip({ room }: { room: RoomView }) {
  const { copied, share } = useShare(room);
  return (
    <div className="hidden h-11 shrink-0 items-center gap-2.5 rounded-full border border-line-strong bg-panel pl-4 pr-1 lg:flex">
      <span className="text-[11.5px] font-medium text-muted">Room code</span>
      <span className="font-mono text-[14.5px] tracking-[0.16em] text-cream">{room.code}</span>
      <button
        type="button"
        onClick={() => void share(room.code, "copy")}
        aria-label={copied ? "Room code copied" : "Copy room code"}
        title="Copy room code"
        className="grid h-9 w-9 place-items-center rounded-full bg-panel-2 text-cream transition hover:bg-panel-3"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          {copied ? (
            <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="8" y="8" width="12" height="12" rx="3" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
