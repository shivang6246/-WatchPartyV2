"use client";

import { useState } from "react";
import Poster from "@/components/Poster";
import { Button, formatTime } from "@/components/ui";
import type { QueueItem } from "@/lib/types";

interface Props {
  queue: QueueItem[];
  isHost: boolean;
  onAdd: () => void;
  onRemove: (itemId: string) => Promise<void>;
  onMove: (itemId: string, delta: -1 | 1) => Promise<void>;
  onSkip: () => Promise<void>;
}

/**
 * What plays next. The current video is not in this list: it is the room's
 * player, and the head of this list replaces it when it ends or the host skips.
 */
export default function QueuePanel({ queue, isHost, onAdd, onRemove, onMove, onSkip }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isHost ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
          <Button size="sm" onClick={onAdd}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Add a video
          </Button>
          {queue.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("skip", onSkip)}>
              Play next now
            </Button>
          ) : null}
        </div>
      ) : null}

      {queue.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-12 text-center">
          <div>
            <p className="font-serif text-2xl italic text-cream/80">Nothing on the bill yet.</p>
            <p className="mt-1 text-sm text-faint">
              {isHost ? "Queue videos and they play one after another." : "The host can line up what plays next."}
            </p>
          </div>
        </div>
      ) : (
        <ol className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 sm:p-3">
          {queue.map((item, index) => (
            <li key={item.id} className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/[0.03]">
              <span className="w-4 shrink-0 text-center font-mono text-xs text-faint">{index + 1}</span>
              <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-panel-2">
                {item.thumbnail ? <Poster src={item.thumbnail} /> : null}
                {item.durationMs ? (
                  <span className="absolute bottom-1 right-1 rounded bg-ink/85 px-1 font-mono text-[9px]">
                    {formatTime(item.durationMs)}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug">{item.title ?? item.videoUrl}</p>
                <p className="mt-0.5 truncate text-[11px] text-faint">
                  {[item.author, item.addedByName ? `added by ${item.addedByName}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {isHost ? (
                <div className="flex shrink-0 flex-col items-center gap-0.5 text-muted transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                  <div className="flex">
                    <QueueAction
                      label="Move up"
                      disabled={index === 0 || busy !== null}
                      onClick={() => void run(item.id, () => onMove(item.id, -1))}
                    >
                      <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </QueueAction>
                    <QueueAction
                      label="Move down"
                      disabled={index === queue.length - 1 || busy !== null}
                      onClick={() => void run(item.id, () => onMove(item.id, 1))}
                    >
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </QueueAction>
                  </div>
                  <QueueAction
                    label="Remove from queue"
                    danger
                    disabled={busy !== null}
                    onClick={() => void run(item.id, () => onRemove(item.id))}
                  >
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </QueueAction>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueAction({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-full transition disabled:opacity-25 lg:h-7 lg:w-7 ${
        danger ? "text-ember hover:bg-ember/10" : "hover:bg-white/[0.07] hover:text-cream"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
