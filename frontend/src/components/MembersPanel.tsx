"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, LiveDot } from "@/components/ui";
import { api } from "@/lib/api";
import { refreshFriendActivity } from "@/lib/friends";
import type { FriendRelation, MemberView } from "@/lib/types";

interface Props {
  members: MemberView[];
  behindMembers: Set<string>;
  selfMemberId: string | null;
  isHost: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  roomId: string;
  /** Signed in with an account: friends are for accounts only. */
  canBefriend: boolean;
}

/**
 * Who is in the room right now. Live: the roster arrives over the socket on
 * every arrival and departure, so this list only ever shows people who are
 * connected, never everyone who once joined. The host gets quiet per-row
 * controls.
 */
export default function MembersPanel({ members, behindMembers, selfMemberId, isHost, onPatch, roomId, canBefriend }: Props) {
  // On a phone the host's actions for one person open under their row.
  const [openId, setOpenId] = useState<string | null>(null);
  const [relations, setRelations] = useState<Record<string, FriendRelation>>({});
  const [adding, setAdding] = useState<string | null>(null);

  // Which of these people are friends already, or have a request either way.
  // Asked again as people arrive, since a newcomer might be one.
  const presentKey = members.filter((m) => m.present && !m.guest).map((m) => m.id).join(",");
  const loadRelations = useCallback(async () => {
    if (!canBefriend) return;
    try {
      setRelations((await api.friendsInRoom(roomId)).members);
    } catch {
      // Without it the buttons simply offer "Add friend"; the server sorts out repeats.
    }
  }, [canBefriend, roomId]);
  useEffect(() => {
    void loadRelations();
  }, [loadRelations, presentKey]);

  async function befriend(member: MemberView) {
    setAdding(member.id);
    try {
      await api.addFriend({ roomId, memberId: member.id });
      await loadRelations();
      refreshFriendActivity();
    } catch {
      // Leave the button as it was; tapping again retries.
    } finally {
      setAdding(null);
    }
  }

  // Host first, then you, then everyone else in the order they arrived.
  const present = members
    .filter((member) => member.present)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "host" ? -1 : 1;
      if ((a.id === selfMemberId) !== (b.id === selfMemberId)) return a.id === selfMemberId ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted sm:px-5">
        <LiveDot />
        In the room now
        <span className="font-mono text-[11px] tracking-normal text-cream">{present.length}</span>
      </p>

      {present.length <= 1 ? (
        <p className="px-4 pb-1 pt-2 text-sm text-faint sm:px-5">Nobody else is here yet. Share the code and they appear here the moment they join.</p>
      ) : null}

      <ul className="thin-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2 sm:p-3">
        {present.map((member) => {
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
            <li key={member.id} className="fade-in group rounded-2xl px-2 py-2 transition hover:bg-white/[0.03] sm:px-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.displayName} src={member.avatarUrl} size={36} ring={member.role === "host"} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      <span className="truncate">{member.displayName}</span>
                      {self ? <span className="text-xs font-normal text-faint">you</span> : null}
                      {relations[member.id] === "friend" ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">Friend</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      {member.role === "host" ? (
                        <span className="font-semibold uppercase tracking-[0.14em] text-gold">Host</span>
                      ) : null}
                      {behind ? (
                        <span className="text-gold-soft">catching up</span>
                      ) : (
                        <span className="text-muted">watching</span>
                      )}
                      {member.guest ? <span className="text-faint">guest</span> : null}
                      {member.muted ? <span className="text-ember">muted</span> : null}
                    </p>
                  </div>
                </div>

                {canBefriend && !self && !member.guest && relations[member.id] !== "friend" ? (
                  <FriendButton
                    relation={relations[member.id]}
                    busy={adding === member.id}
                    onAdd={() => void befriend(member)}
                    name={member.displayName}
                  />
                ) : null}

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
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition active:bg-white/[0.05] sm:hidden"
                    >
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                        <circle cx="5" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="19" cy="12" r="1.7" />
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
    </div>
  );
}

/** Add, accept (they asked you: adding back is a yes) or a quiet "Requested". */
function FriendButton({
  relation,
  busy,
  onAdd,
  name,
}: {
  relation: FriendRelation | undefined;
  busy: boolean;
  onAdd: () => void;
  name: string;
}) {
  if (relation === "outgoing") {
    return <span className="shrink-0 px-2 text-[11px] font-medium text-faint">Requested</span>;
  }
  const accept = relation === "incoming";
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={busy}
      aria-label={accept ? `Accept ${name}'s friend request` : `Add ${name} as a friend`}
      className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[11.5px] font-semibold transition disabled:opacity-50 ${
        accept ? "bg-cream text-ink hover:bg-white" : "border border-line-strong text-cream hover:bg-white/[0.05]"
      }`}
    >
      {accept ? null : (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      )}
      {accept ? "Accept" : "Friend"}
    </button>
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
