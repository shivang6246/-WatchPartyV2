"use client";

import { REACTIONS } from "@/lib/types";

interface Props {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

/** One tap sends a reaction that floats over everyone's video. */
export default function ReactionBar({ onReact, disabled = false }: Props) {
  return (
    <div role="group" aria-label="Reactions" className="panel no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl p-1">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onReact(emoji)}
          aria-label={`React with ${emoji}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[19px] transition duration-150 hover:bg-white/[0.05] active:scale-90 disabled:opacity-35"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
