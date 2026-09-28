"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, Button } from "@/components/ui";
import { useStartParty } from "@/components/home/useStartParty";

// The picker (sources, YouTube search) is only needed once someone taps
// "Start a party", so it is fetched then, not with the page.
const AddContentFlow = dynamic(() => import("@/components/AddContentFlow"));
const warmPicker = () => void import("@/components/AddContentFlow");

/** The home card's one action: open the picker, and turn the pick into a room. */
export function StartPartyButton({ className = "" }: { className?: string }) {
  const { start, error, requireAccount } = useStartParty();
  const [picking, setPicking] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          if (requireAccount()) setPicking(true);
        }}
        onPointerEnter={warmPicker}
        onTouchStart={warmPicker}
        className={className}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        {/* The phone's card is one row: the short label leaves the title its line. */}
        <span className="md:hidden">Start</span>
        <span className="hidden md:inline">Start a party</span>
      </Button>

      {error ? (
        // Its own line wherever the button sits: col-span-full in the start
        // card's grid row, basis-full in the phone's floating card.
        <div className="relative col-span-full mt-3 max-w-md basis-full md:mt-4">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      {picking ? <AddContentFlow open onClose={() => setPicking(false)} onPick={start} /> : null}
    </>
  );
}

/**
 * A friend's code, straight into their room. Joining needs no account.
 * `glass`: set into a glass card (the phone's floating one) instead of the page.
 */
export function JoinCodeForm({ className = "", glass = false }: { className?: string; glass?: boolean }) {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const codeReady = joinCode.trim().length >= 4;

  return (
    <form
      className={`flex h-[52px] min-w-0 items-center gap-2.5 rounded-full p-1 pl-4 transition focus-within:border-gold/45 sm:h-14 sm:p-1.5 sm:pl-5 ${
        // Borderless on glass; the transparent border is there for focus.
        glass ? "glass-inset border border-transparent" : "border border-line-strong bg-panel"
      } ${className}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (codeReady) router.push(`/room/${joinCode.trim().toUpperCase()}`);
      }}
    >
      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-muted sm:h-[18px] sm:w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" strokeLinejoin="round" />
        <path d="M14 5v2M14 11v2M14 17v2" strokeLinecap="round" />
      </svg>
      <label htmlFor="join-code" className="sr-only">
        Room code
      </label>
      <input
        id="join-code"
        value={joinCode}
        onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        placeholder="Enter a room code"
        maxLength={6}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="go"
        // w-0: an input is 20 characters wide by default, which alone made
        // the form wider than a 320px phone. flex-1 gives it the room back.
        // The text stays 16px (smaller and iOS zooms in on focus); only the
        // placeholder is drawn smaller on a phone.
        className="w-0 min-w-0 flex-1 bg-transparent font-mono text-base uppercase tracking-[0.16em] text-cream placeholder:font-sans placeholder:text-[13px] placeholder:normal-case placeholder:tracking-normal placeholder:text-faint focus:outline-none sm:placeholder:text-base"
      />
      <Button
        type="submit"
        size="md"
        variant={codeReady ? "primary" : glass ? "ghost" : "secondary"}
        disabled={!codeReady}
        className={`px-5 lg:px-6 ${glass && !codeReady ? "glass-raised" : ""}`}
      >
        Join
      </Button>
    </form>
  );
}
