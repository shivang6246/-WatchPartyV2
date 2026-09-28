"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import type { PresenceEvent } from "@/hooks/useRoom";
import { REACTIONS, type ChatMessageView } from "@/lib/types";

interface Props {
  messages: ChatMessageView[];
  /** Joins and departures, shown between the messages as they happen. */
  presence?: PresenceEvent[];
  selfMemberId: string | null;
  onSend: (body: string) => void;
  /** Called on every keystroke; the session throttles what it sends. */
  onTyping?: (typing: boolean) => void;
  /** Names of the other members typing right now. */
  typing?: string[];
  muted?: boolean;
  /**
   * Reactions from the message bar. A wide screen has its own row of them
   * under the player, so this button only shows below the desktop layout.
   */
  onReact?: (emoji: string) => void;
  reactDisabled?: boolean;
}

function typingLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

/** Messages from one person within this window read as a single turn. */
const GROUP_WINDOW_MS = 3 * 60 * 1000;
/** Within this many pixels of the bottom counts as "reading the latest". */
const STICK_PX = 96;

// One formatter for every timestamp. toLocaleTimeString builds a new one per
// call, which across a long chat is enough main-thread work to stall the
// player on a phone, where the YouTube iframe often shares the page's thread.
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * The conversation itself. Memoised so a keystroke in the message box, a sync
 * tick or a roster change re-renders nothing here; only a new message does.
 */
type TimelineItem =
  | { kind: "message"; at: number; message: ChatMessageView }
  | { kind: "presence"; at: number; event: PresenceEvent };

/** Messages and presence lines in time order. A tie keeps the message first. */
function timeline(messages: ChatMessageView[], presence: PresenceEvent[]): TimelineItem[] {
  const items: TimelineItem[] = messages.map((message) => ({
    kind: "message",
    at: new Date(message.createdAt).getTime(),
    message,
  }));
  if (presence.length === 0) return items;
  for (const event of presence) items.push({ kind: "presence", at: event.at, event });
  return items.sort((a, b) => a.at - b.at || (a.kind === "message" ? -1 : 1));
}

const MessageList = memo(function MessageList({
  messages,
  presence,
  selfMemberId,
}: {
  messages: ChatMessageView[];
  presence: PresenceEvent[];
  selfMemberId: string | null;
}) {
  const items = timeline(messages, presence);
  return (
    <ol className="space-y-1">
      {items.map((item, index) => {
        if (item.kind === "presence") {
          const { event } = item;
          return (
            <li key={event.id} className="flex justify-center py-2">
              <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
                <span className="font-medium text-muted">{event.name}</span>
                {event.kind === "joined" ? "joined" : "left"}
                <span className="font-mono text-[10px]">· {TIME.format(item.at)}</span>
              </span>
            </li>
          );
        }
        const { message } = item;
        const mine = message.memberId === selfMemberId;
        const previousItem = items[index - 1];
        const previous = previousItem?.kind === "message" ? previousItem.message : null;
        const at = new Date(item.at);
        const continues =
          previous?.memberId === message.memberId && item.at - (previousItem?.at ?? 0) < GROUP_WINDOW_MS;
        return (
          <li key={message.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""} ${continues ? "" : "pt-3"}`}>
            {!mine ? (
              <span className="w-7 shrink-0">{!continues ? <Avatar name={message.displayName} size={28} /> : null}</span>
            ) : null}
            <div className={`flex min-w-0 max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
              {!continues ? (
                <div className={`mb-1 flex items-baseline gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  <span className="text-xs font-medium text-muted">{mine ? "You" : message.displayName}</span>
                  <span className="font-mono text-[10px] text-faint">{TIME.format(at)}</span>
                </div>
              ) : null}
              {/* Rendered as text, never as markup. */}
              <p
                className={`whitespace-pre-wrap break-words px-3.5 py-2 text-[14.5px] leading-snug sm:text-sm ${
                  mine
                    ? "rounded-2xl rounded-tr-md border border-gold/20 bg-own text-cream"
                    : "rounded-2xl rounded-tl-md bg-panel-2 text-cream/95"
                }`}
              >
                {message.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
});

const NO_PRESENCE: PresenceEvent[] = [];

export default function ChatPanel({
  messages,
  presence = NO_PRESENCE,
  selfMemberId,
  onSend,
  onTyping,
  typing = [],
  muted = false,
  onReact,
  reactDisabled = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [reacting, setReacting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewer was at the bottom before the new message arrived. Read
  // before layout, so a message never yanks someone who scrolled up to read.
  const stick = useRef(true);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = messages[messages.length - 1];
    if (stick.current || last?.memberId === selfMemberId) {
      // The list scrolls itself, not the page: scrollIntoView would also move
      // the window, which jumps a phone's layout around the keyboard.
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, presence, selfMemberId]);

  // Opening the tab lands on the newest message.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
    onTyping?.(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_PX;
        }}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
      >
        {messages.length === 0 && presence.length === 0 ? (
          <div className="grid h-full place-items-center py-8 text-center">
            <div>
              <p className="font-serif text-2xl italic text-cream/85">The lights are down.</p>
              <p className="mt-1 text-sm text-faint">Say hello before the opening scene.</p>
            </div>
          </div>
        ) : (
          <MessageList messages={messages} presence={presence} selfMemberId={selfMemberId} />
        )}
      </div>

      <p className="flex h-6 shrink-0 items-center gap-2 px-4 text-[11px] text-muted" aria-live="polite">
        {typing.length > 0 ? (
          <>
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted" />
            </span>
            {typingLine(typing)}
          </>
        ) : null}
      </p>

      {onReact && reacting ? (
        <div className="fade-in flex shrink-0 justify-between gap-1 px-2 pb-1 lg:hidden">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={reactDisabled}
              onClick={() => onReact(emoji)}
              aria-label={`React with ${emoji}`}
              className="grid h-11 flex-1 place-items-center rounded-xl text-[22px] transition active:scale-90 active:bg-white/[0.06] disabled:opacity-35"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="mx-2.5 mb-2.5 flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-panel p-1 transition focus-within:border-gold/40 sm:mx-3 sm:mb-3"
        onSubmit={submit}
      >
        {onReact ? (
          <button
            type="button"
            onClick={() => setReacting(!reacting)}
            aria-label={reacting ? "Hide reactions" : "Show reactions"}
            aria-expanded={reacting}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 lg:hidden ${
              reacting ? "bg-gold/10 text-gold" : "text-muted hover:text-cream"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M8.5 14a4 4 0 0 0 7 0" strokeLinecap="round" />
              <circle cx="9.2" cy="10" r="1" fill="currentColor" stroke="none" />
              <circle cx="14.8" cy="10" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
        ) : null}
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onTyping?.(event.target.value.trim().length > 0);
          }}
          onBlur={() => onTyping?.(false)}
          disabled={muted}
          placeholder={muted ? "The host muted you" : "Send a message"}
          maxLength={500}
          aria-label="Message"
          enterKeyHint="send"
          // 16px on a phone, or iOS zooms the page when the box is tapped.
          className={`h-11 min-w-0 flex-1 bg-transparent text-base text-cream placeholder:text-faint focus:outline-none disabled:opacity-50 sm:text-sm ${
            onReact ? "pl-1 lg:pl-4" : "pl-4"
          }`}
        />
        <button
          type="submit"
          disabled={muted || !draft.trim()}
          aria-label="Send"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream text-ink transition hover:bg-white active:scale-95 disabled:bg-panel-3 disabled:text-faint"
        >
          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
