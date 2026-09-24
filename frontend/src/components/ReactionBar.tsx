"use client";

import { REACTIONS } from "@/lib/types";

interface Props {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

/** One tap sends a reaction that floats over everyone's video. */
export default function ReactionBar({ onReact, disabled = false }: Props) {
  return (
    <div className="panel no-scrollbar flex items-center gap-0.5 overflow-x-auto rounded-full p-1">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onReact(emoji)}
          aria-label={`React with ${emoji}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[22px] transition duration-150 hover:-translate-y-0.5 hover:scale-110 hover:bg-white/[0.06] active:scale-90 disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:scale-100"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
