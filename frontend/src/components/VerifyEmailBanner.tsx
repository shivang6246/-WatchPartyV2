"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";
import { HttpError, api } from "@/lib/api";

/**
 * Shown to an account whose address is not confirmed yet. Hosting is the only
 * thing being held back, so this explains that rather than blocking the page.
 */
export default function VerifyEmailBanner({ email }: { email: string | null }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    setError(null);
    try {
      await api.resendVerification();
      setState("sent");
    } catch (ex) {
      setState("idle");
      setError(ex instanceof HttpError ? ex.message : "That did not send. Try again in a minute.");
    }
  }

  return (
    <div className="fade-in flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 rounded-2xl border border-gold/25 bg-gold/[0.05] px-4 py-3 sm:gap-y-3 sm:px-5 sm:py-4">
      <p className="min-w-0 text-[13px] leading-relaxed text-cream/90 sm:text-sm">
        <span className="font-semibold">Confirm your email to host a room.</span>{" "}
        {state === "sent" ? (
          <>A new link is on its way to {email ?? "your inbox"}.</>
        ) : error ? (
          <span className="text-[#ffc2b5]">{error}</span>
        ) : (
          <>
            We sent a link to <span className="text-gold">{email ?? "your inbox"}</span>. Joining rooms works
            without it.
          </>
        )}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Link href="/verify">
          <Button size="sm">Enter the code</Button>
        </Link>
        <Button size="sm" variant="secondary" disabled={state !== "idle"} onClick={() => void resend()}>
          {state === "sending" ? "Sending…" : state === "sent" ? "Sent" : "Send it again"}
        </Button>
      </div>
    </div>
  );
}
