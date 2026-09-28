"use client";

import { useState } from "react";
import { JoinCodeForm, StartPartyButton } from "@/components/home/HeroActions";

type Tab = "start" | "join";

const TABS: { id: Tab; label: string }[] = [
  { id: "start", label: "Start a party" },
  { id: "join", label: "Join a room" },
];

/**
 * A phone's two ways in, as one floating card over the bottom edge of the
 * trailer: a tab each for starting a party and joining one with its code.
 * Both panels are one height, so switching tabs moves nothing below.
 * From md the page shows the two full cards instead.
 */
export default function QuickActions() {
  const [tab, setTab] = useState<Tab>("start");

  return (
    <section
      aria-label="Start or join a watch party"
      className="glass rounded-[22px] p-1.5"
    >
      <div role="tablist" aria-label="Start or join" className="grid grid-cols-2 gap-1 p-1">
        {TABS.map(({ id, label }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`quick-${id}`}
              aria-selected={selected}
              aria-controls={`quick-${id}-panel`}
              onClick={() => setTab(id)}
              className={`h-10 rounded-xl text-[12px] font-semibold transition ${
                selected ? "glass-raised text-cream" : "text-muted hover:text-cream"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`quick-${tab}-panel`}
        aria-labelledby={`quick-${tab}`}
        className="flex min-h-[4.25rem] flex-col justify-center px-2.5 py-2"
      >
        {tab === "start" ? (
          <div className="flex flex-wrap items-center gap-x-3">
            <div className="over-picture min-w-0 flex-1">
              <p className="font-serif text-[16px] leading-tight">
                Start a <span className="italic">watch party</span>
              </p>
              <p className="mt-0.5 truncate text-[11px] text-cream/70">Pick a video, share the code.</p>
            </div>
            <StartPartyButton className="shrink-0" />
          </div>
        ) : (
          <JoinCodeForm glass />
        )}
      </div>
    </section>
  );
}
