"use client";

import { useState } from "react";
import { Avatar, LiveDot } from "@/components/ui";
import type { MemberView } from "@/lib/types";

interface Props {
  members: MemberView[];
  behindMembers: Set<string>;
  selfMemberId: string | null;
  isHost: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}

/** Who is in the room. The host gets quiet per-row controls. */
export default function MembersPanel({ members, behindMembers, selfMemberId, isHost, onPatch }: Props) {
  // On a phone the host's actions for one person open under their row.
  const [openId, setOpenId] = useState<string | null>(null);

  // Host first, then whoever is watching, then whoever stepped away.
  const ordered = [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "host" ? -1 : 1;
    if (a.present !== b.present) return a.present ? -1 : 1;
    return 0;
  });

  return (
    <ul className="thin-scrollbar h-full space-y-0.5 overflow-y-auto overscroll-contain p-2 sm:p-3">
      {ordered.map((member) => {
        const self = member.id === selfMemberId;
        const behind = behindMembers.has(member.id);
        const canManage = isHost && !self;
        const actions = canManage ? (
          <>
            <RowAction onClick={() => void onPatch({ muteMemberId: member.id, muted: !member.muted })}>
              {member.muted ? "Unmute" : "Mute"}
            </RowAction>
            {!member.guest ? (
              <RowAction onClick={() => void onPatch({ transferHostToMemberId: member.id })}>Make host</RowAction>
            ) : null}
            <RowAction danger onClick={() => void onPatch({ removeMemberId: member.id })}>
              Remove
            </RowAction>
          </>
        ) : null;
        return (
          <li key={member.id} className="group rounded-2xl px-2 py-2 transition hover:bg-white/[0.03] sm:px-3">
            <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative">
                <Avatar name={member.displayName} src={member.avatarUrl} size={36} ring={member.role === "host"} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${
                    member.present ? "bg-sage" : "bg-panel-3"
                  }`}
                  aria-hidden
                />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{member.displayName}</span>
                  {self ? <span className="text-xs font-normal text-faint">you</span> : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  {member.role === "host" ? (
                    <span className="font-mono uppercase tracking-wider text-cobalt">host</span>
                  ) : null}
                  <span className={member.present ? "text-muted" : "text-faint"}>
                    {member.present ? "watching" : "away"}
                  </span>
                  {member.guest ? <span className="text-faint">guest</span> : null}
                  {member.muted ? <span className="text-ember">muted</span> : null}
                  {behind ? <span className="text-cobalt-soft">catching up</span> : null}
                </p>
              </div>
            </div>

            {canManage ? (
              <>
                {/* Wide screens: the actions appear on hover, beside the name. */}
                <div className="hidden shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
                  {actions}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === member.id ? null : member.id)}
                  aria-label={`Manage ${member.displayName}`}
                  aria-expanded={openId === member.id}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition active:bg-white/[0.06] sm:hidden"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </>
            ) : null}
            </div>
            {canManage && openId === member.id ? (
              <div className="fade-in mt-2 flex flex-wrap gap-2 pl-12 sm:hidden">{actions}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RowAction({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-full border px-3.5 text-xs font-medium transition sm:h-auto sm:px-2.5 sm:py-1 sm:text-[11px] ${
        danger
          ? "border-ember/25 text-ember hover:bg-ember/10"
          : "border-line text-muted hover:border-line-strong hover:text-cream"
      }`}
    >
      {children}
    </button>
  );
}

/** A compact "who's here" line for under the player. */
export function WatchingSummary({ members, behindCount }: { members: MemberView[]; behindCount: number }) {
  const present = members.filter((member) => member.present);
  const shown = (present.length > 0 ? present : members).slice(0, 4);
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-1">
        {shown.map((member) => (
          <Avatar key={member.id} name={member.displayName} src={member.avatarUrl} size={30} className="ring-2 ring-ink" />
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <LiveDot />
        <span>
          <span className="font-semibold text-cream">{present.length}</span> watching
          {behindCount > 0 ? <span className="text-cobalt-soft"> · {behindCount} catching up</span> : null}
        </span>
      </p>
    </div>
  );
}
