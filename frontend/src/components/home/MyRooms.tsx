"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Poster from "@/components/Poster";
import SourceIcon from "@/components/SourceIcon";
import { LiveDot } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { RoomCard } from "@/lib/types";

/**
 * The signed-in visitor's open rooms. A swipeable row on a phone, a grid on a
 * wide screen. Renders nothing for a guest or someone with no rooms.
 */
export default function MyRooms() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<RoomCard[]>([]);

  useEffect(() => {
    if (!user) {
      setRooms([]);
      return;
    }
    api.myRooms().then(setRooms).catch(() => undefined);
  }, [user]);

  if (!user || rooms.length === 0) return null;

  return (
    <section className="animate-rise pb-14 sm:pb-20" aria-labelledby="my-rooms">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="my-rooms" className="text-xl font-semibold tracking-tight sm:text-2xl">
          Your rooms
        </h2>
        <span className="text-xs text-faint">{rooms.length} open</span>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {rooms.map((room) => (
          <Link
            key={room.id}
            href={`/room/${room.code}`}
            className="group w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-panel transition hover:border-cobalt/40 active:scale-[0.99] sm:w-auto"
          >
            <div className="relative aspect-video overflow-hidden bg-panel-2">
              {room.videoThumbnail ? (
                <div className="h-full w-full transition duration-500 group-hover:scale-[1.04]">
                  <Poster src={room.videoThumbnail} />
                </div>
              ) : (
                <span className="grid h-full w-full place-items-center text-faint">
                  <SourceIcon platform={room.platform} className="h-9 w-9" />
                </span>
              )}
              {room.host ? (
                <span className="absolute right-2.5 top-2.5 rounded-full bg-cobalt px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  Host
                </span>
              ) : null}
            </div>
            <div className="p-3.5">
              <p className="line-clamp-1 text-[15px] font-medium">{room.title}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  {room.memberCount > 0 ? <LiveDot /> : null}
                  {room.memberCount} {room.memberCount === 1 ? "person" : "people"} inside
                </span>
                <span className="ticket rounded px-1.5 py-px text-[10.5px]">{room.code}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
