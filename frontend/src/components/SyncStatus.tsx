"use client";

import { Avatar } from "@/components/ui";
import type { RoomSession } from "@/hooks/useRoom";

/** Past this much drift the ring reads empty; the ladder has long been seeking by then. */
const RING_SCALE_MS = 2000;
const RING_RADIUS = 19.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Where the room stands, under the player: a ring for how closely this screen
 * follows the room (its own measured drift), who is watching right now and
 * how many of them are catching up, and who holds the remote. Everything here
 * is live: presence and health arrive over the socket, drift every sync tick.
 */
export default function SyncStatus({ session, avatars = false }: { session: RoomSession; avatars?: boolean }) {
  const { room, members, behindMembers, diagnostics, connection, isHost, canControl } = session;
  if (!room) return null;

  const present = members.filter((member) => member.present);
  const behind = present.filter((member) => behindMembers.has(member.id)).length;
  const host = members.find((member) => member.role === "host");
  const drift = diagnostics ? Math.abs(diagnostics.driftMs) : null;
  const fill = drift === null ? 0 : Math.max(0.06, 1 - drift / RING_SCALE_MS);

  const title =
    connection === "connecting"
      ? "Connecting…"
      : connection === "disconnected"
        ? "Reconnecting…"
        : present.length <= 1
          ? "Just you, for now"
          : behind > 0
            ? `${present.length - behind} of ${present.length} in sync`
            : `All ${present.length} in sync`;

  const onVideo = room.platform === "youtube";
  const detail = isHost
    ? onVideo
      ? "Play, pause and seek on the video. Everyone follows you."
      : "Everyone follows your play, pause and seek."
    : canControl
      ? "Playback is open to everyone right now."
      : host
        ? `${host.displayName} controls playback.`
        : "The host controls playback.";

  const shown = present.slice(0, 4);
  const more = present.length - shown.length;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <svg
        viewBox="0 0 46 46"
        className="h-11 w-11 shrink-0"
        role="img"
        aria-label={drift === null ? "Measuring sync" : `This screen is ${drift} milliseconds from the room`}
      >
        <circle cx="23" cy="23" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-white/10" />
        <circle
          cx="23"
          cy="23"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(fill * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}`}
          transform="rotate(-90 23 23)"
          className="stroke-gold transition-[stroke-dasharray] duration-500"
        />
        <text x="23" y="25.5" textAnchor="middle" fontSize="12" fontWeight="500" className="fill-cream font-mono">
          {drift === null ? "–" : drift > 999 ? `${(drift / 1000).toFixed(1)}s` : drift}
        </text>
        {drift !== null && drift <= 999 ? (
          <text x="23" y="33" textAnchor="middle" fontSize="6" fontWeight="600" letterSpacing="0.6" className="fill-muted">
            MS
          </text>
        ) : null}
      </svg>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{detail}</p>
      </div>

      {avatars && shown.length > 0 ? (
        <div className="flex shrink-0 -space-x-2">
          {shown.map((member) => (
            <Avatar key={member.id} name={member.displayName} src={member.avatarUrl} size={32} className="ring-2 ring-ink" />
          ))}
          {more > 0 ? (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-panel-3 text-[11px] font-semibold text-cream ring-2 ring-ink">
              +{more}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
