"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Poster from "@/components/Poster";
import SourceIcon from "@/components/SourceIcon";
import { LiveDot } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { RoomCard } from "@/lib/types";

const REFRESH_MS = 5000;

/** Nothing a card shows has changed, so the list need not re-render. */
function sameRooms(a: RoomCard[], b: RoomCard[]) {
  return (
    a.length === b.length &&
    a.every(
      (room, i) =>
        room.id === b[i].id &&
        room.memberCount === b[i].memberCount &&
        room.videoTitle === b[i].videoTitle &&
        room.videoThumbnail === b[i].videoThumbnail &&
        room.host === b[i].host,
    )
  );
}

/**
 * The signed-in visitor's open rooms. On the home screen ("row") it is a
 * swipeable row on a phone and a grid on a wide screen, capped, with a link to
 * the rest; on the Rooms page ("page") it is the whole list. Renders nothing
 * for a guest, and nothing on the home screen for someone with no rooms.
 */
export default function MyRooms({ variant = "row" }: { variant?: "row" | "page" }) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<RoomCard[] | null>(null);

  // The counts are live presence, so the list keeps itself current: every few
  // seconds while the page is on screen, and at once when it comes back.
  useEffect(() => {
    if (!user) {
      setRooms(null);
      return;
    }
    let inFlight = false;
    const load = () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      api
        .myRooms()
        .then((fresh) => setRooms((current) => (current && sameRooms(current, fresh) ? current : fresh)))
        .catch(() => setRooms((current) => current ?? []))
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("focus", load);
    };
  }, [user]);

  if (!user) return null;
  if (rooms === null) {
    return variant === "page" ? <RoomSkeleton /> : null;
  }
  if (rooms.length === 0) {
    return variant === "page" ? (
      <div className="rounded-[20px] border border-line bg-panel px-6 py-12 text-center">
        <p className="font-serif text-2xl italic text-cream/85">No rooms open.</p>
        <p className="mt-1 text-sm text-faint">Start a party and it stays here while it is open.</p>
      </div>
    ) : null;
  }

  const row = variant === "row";
  const shown = row ? rooms.slice(0, 6) : rooms;

  return (
    <section className="animate-rise" aria-labelledby={row ? "my-rooms" : undefined}>
      {row ? (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id="my-rooms" className="text-[15px] font-semibold tracking-[-0.01em] lg:text-lg">
            Live in your rooms
          </h2>
          <Link href="/rooms" className="-my-3 py-3 text-[12.5px] font-medium text-muted transition hover:text-cream">
            See all
          </Link>
        </div>
      ) : null}

      <div
        className={
          row
            ? "no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3"
            : "grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
        }
      >
        {shown.map((room) => (
          <Link
            key={room.id}
            href={`/room/${room.code}`}
            className={`group relative block aspect-[16/9.4] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-panel-2 transition active:scale-[0.99] sm:rounded-[18px] ${
              row ? "w-[80%] max-w-[20rem] sm:w-auto sm:max-w-none" : ""
            }`}
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
            <div className="absolute inset-0 bg-gradient-to-b from-ink/10 via-ink/30 to-ink/95" aria-hidden />

            <span className="absolute left-3 top-3 flex h-6 items-center gap-1.5 rounded-full bg-ink/75 px-2.5 text-[11px] font-medium sm:left-3.5 sm:top-3.5 sm:h-[26px] sm:text-[11.5px]">
              {room.memberCount > 0 ? <LiveDot /> : null}
              {room.memberCount > 0 ? `Live · ${room.memberCount} watching` : "Nobody inside"}
            </span>
            <span className="absolute right-3 top-3 flex h-6 items-center rounded-[7px] bg-ink/75 px-2 font-mono text-[11px] tracking-[0.12em] sm:right-3.5 sm:top-3.5 sm:h-[26px] sm:text-[11.5px]">
              {room.code}
            </span>

            <div className="absolute inset-x-3.5 bottom-3.5 flex items-end justify-between gap-3 sm:inset-x-4 sm:bottom-4">
              <div className="min-w-0">
                <p className="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.01em] sm:text-[15px]">
                  {room.videoTitle ?? room.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted sm:mt-1 sm:text-xs">{room.host ? "You're hosting" : "You joined this room"}</p>
              </div>
              {/* Decoration: the whole card is the link. */}
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream text-ink transition group-hover:bg-white sm:h-11 sm:w-11" aria-hidden>
                <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5 fill-current sm:h-4 sm:w-4">
                  <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
                </svg>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RoomSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="aspect-[16/9.4] animate-pulse rounded-[18px] bg-panel-2" />
      ))}
    </div>
  );
}
