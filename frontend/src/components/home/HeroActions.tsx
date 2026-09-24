"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Banner, Button } from "@/components/ui";
import { HttpError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CatalogItem } from "@/lib/types";

// The picker (sources, YouTube search) is only needed once someone taps
// "Start a party", so it is fetched then, not with the page.
const AddContentFlow = dynamic(() => import("@/components/AddContentFlow"));
const warmPicker = () => void import("@/components/AddContentFlow");

/** The two ways in: start a room, or type a friend's code. */
export default function HeroActions() {
  const router = useRouter();
  const { user } = useAuth();
  const [picking, setPicking] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Hosting needs an account, so ask for one before opening the picker. */
  const openPicker = useCallback(() => {
    if (!user) {
      router.push("/login?next=/");
      return;
    }
    setPicking(true);
  }, [router, user]);

  /** One tap from a search result to a room everyone can join. */
  const startParty = useCallback(
    async (item: CatalogItem) => {
      const room = await api.createRoom({
        platform: item.platform,
        videoUrl: item.url,
        videoTitle: item.title,
        videoThumbnail: item.thumbnail,
        videoAuthor: item.author,
        durationMs: item.durationMs,
      });
      const invite = room.inviteToken ? `?invite=${encodeURIComponent(room.inviteToken)}` : "";
      router.push(`/room/${room.code}${invite}`);
    },
    [router],
  );

  const codeReady = joinCode.trim().length >= 4;

  return (
    <>
      <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:max-w-lg sm:flex-row">
        <Button size="lg" onClick={openPicker} onPointerEnter={warmPicker} onTouchStart={warmPicker} className="sm:flex-none">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Start a party
        </Button>

        <form
          className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full border border-line-strong bg-panel p-1 pl-5 transition focus-within:border-cobalt/70 focus-within:ring-4 focus-within:ring-cobalt/15"
          onSubmit={(event) => {
            event.preventDefault();
            if (codeReady) router.push(`/room/${joinCode.trim().toUpperCase()}`);
          }}
        >
          <label htmlFor="join-code" className="sr-only">
            Room code
          </label>
          <input
            id="join-code"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="Room code"
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            // w-0: an input is 20 characters wide by default, which alone made
            // the form wider than a 320px phone. flex-1 gives it the room back.
            className="w-0 min-w-0 flex-1 bg-transparent font-mono text-base uppercase tracking-[0.2em] text-cream placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-faint focus:outline-none"
          />
          <Button type="submit" size="sm" variant={codeReady ? "light" : "secondary"} disabled={!codeReady} className="h-10 px-5">
            Join
          </Button>
        </form>
      </div>

      <p className="mt-3 text-xs text-faint">Joining needs no account. Hosting needs a free one.</p>

      {error ? (
        <div className="mt-5 max-w-md">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      {picking ? (
        <AddContentFlow
          open
          onClose={() => setPicking(false)}
          onPick={async (item) => {
            try {
              await startParty(item);
            } catch (ex) {
              setError(ex instanceof HttpError ? ex.message : "The room could not be created.");
              throw ex;
            }
          }}
        />
      ) : null}
    </>
  );
}
