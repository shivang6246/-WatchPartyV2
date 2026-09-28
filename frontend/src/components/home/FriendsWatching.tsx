"use client";

import Link from "next/link";
import Poster from "@/components/Poster";
import SourceIcon from "@/components/SourceIcon";
import { Avatar, LiveDot } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useFriendActivity } from "@/lib/friends";

/**
 * "Maya is watching Werwulf": friends in a room right now, one tap from
 * joining them. Live: the activity poll brings people in and out within
 * seconds. Someone with no friends yet gets the way to add some instead;
 * someone whose friends are all elsewhere gets nothing, to keep home quiet.
 */
export default function FriendsWatching() {
  const { user } = useAuth();
  const activity = useFriendActivity();
  if (!user || !activity) return null;

  if (activity.friendCount === 0) {
    // One row, and the whole card is the way in: on a phone a stacked button
    // under the words made this the tallest thing on the screen.
    return (
      <Link
        href="/friends"
        className="animate-rise flex items-center gap-3.5 rounded-[18px] border border-line bg-panel p-3.5 pr-3 transition active:scale-[0.99] sm:gap-4 sm:rounded-[20px] sm:p-6"
      >
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          <span className="h-8 w-8 rounded-full border-2 border-panel bg-panel-3 sm:h-10 sm:w-10" />
          <span className="h-8 w-8 rounded-full border-2 border-panel bg-[#3b3632] sm:h-10 sm:w-10" />
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-panel bg-panel-2 text-gold sm:h-10 sm:w-10">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[17px] leading-tight sm:text-xl">Watch with friends</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted sm:text-sm">
            See when they are watching, and join them in one tap.
          </span>
        </span>
        <span className="hidden h-11 shrink-0 items-center justify-center rounded-full bg-cream px-5 text-sm font-semibold text-ink transition hover:bg-white sm:inline-flex">
          Find friends
        </span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-faint sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    );
  }

  if (activity.watching.length === 0) return null;

  return (
    <section className="animate-rise" aria-labelledby="friends-watching">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="friends-watching" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] lg:text-lg">
          <LiveDot />
          Friends watching now
        </h2>
        <Link href="/friends" className="-my-3 py-3 text-[12.5px] font-medium text-muted transition hover:text-cream">
          All friends
        </Link>
      </div>

      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {activity.watching.map((friend) => {
          const room = friend.watching;
          if (!room) return null;
          const others = room.watching - 1;
          return (
            <Link
              key={friend.userId}
              href={`/room/${room.code}`}
              aria-label={`Join ${friend.displayName}, watching ${room.videoTitle ?? room.title}`}
              className="group relative block aspect-[16/9.4] w-[80%] max-w-[20rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-panel-2 transition active:scale-[0.99] sm:w-auto sm:max-w-none sm:rounded-[18px]"
            >
              {room.videoThumbnail ? (
                <div className="absolute inset-0 transition duration-700 group-hover:scale-[1.03]">
                  <Poster src={room.videoThumbnail} />
                </div>
              ) : (
                <span className="absolute inset-0 grid place-items-center text-faint">
                  <SourceIcon platform={room.platform} className="h-9 w-9" />
                </span>
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-ink/10 via-ink/35 to-ink/95" aria-hidden />

              <span className="absolute left-3.5 top-3.5 flex h-8 items-center gap-2 rounded-full bg-ink/75 py-1 pl-1 pr-3 text-[12px] font-medium">
                <Avatar name={friend.displayName} src={friend.avatarUrl} size={24} />
                <span className="max-w-[10rem] truncate">{friend.displayName}</span>
              </span>

              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold">Watching</p>
                  <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">
                    {room.videoTitle ?? room.title}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {others > 0 ? `with ${others} ${others === 1 ? "other" : "others"}` : "on their own"}
                  </p>
                </div>
                <span className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-cream pl-3 pr-4 text-[13px] font-semibold text-ink transition group-hover:bg-white">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
                    <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
                  </svg>
                  Join
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
