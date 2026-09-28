"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { Banner, Button, Spinner } from "@/components/ui";
import { HttpError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * Confirming an email address, either way the message offers: the link, which
 * lands here with a token, or the six-digit code, which is what works when
 * mail opens in a browser that is not signed in on a phone.
 *
 * A new sign-up has no account yet: it arrives with `?email=` (enter the
 * code) or `?signup=` (the link), and confirming is what creates the account
 * and signs it in. `?token=` is the older link for an existing account.
 */
function Verify() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading, refreshUser, confirmRegistration } = useAuth();
  const signupToken = params.get("signup");
  const pendingEmail = params.get("email");
  const token = params.get("token") ?? signupToken;
  const next = params.get("next") ?? "/";

  const [state, setState] = useState<"idle" | "working" | "done" | "failed">(token ? "working" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  // React runs effects twice in development; a link is single-use.
  const redeemed = useRef(false);

  useEffect(() => {
    if (!token || redeemed.current) return;
    redeemed.current = true;
    const redeem = signupToken
      ? confirmRegistration({ token: signupToken })
      : api.verifyEmail(token).then(() => refreshUser().catch(() => undefined));
    redeem
      .then(() => setState("done"))
      .catch((ex) => {
        setError(ex instanceof HttpError ? ex.message : "That link could not be confirmed.");
        setState("failed");
      });
  }, [token, signupToken, refreshUser, confirmRegistration]);

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setState("working");
    setError(null);
    try {
      if (pendingEmail) {
        // This is what creates the account.
        await confirmRegistration({ email: pendingEmail, code });
      } else {
        await api.verifyCode(code);
        await refreshUser().catch(() => undefined);
      }
      setState("done");
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That code could not be confirmed.");
      setState("idle");
    }
  }

  async function resend() {
    setError(null);
    try {
      if (pendingEmail) {
        await api.resendRegistration(pendingEmail);
      } else {
        await api.resendVerification();
      }
      setResent(true);
      setCode("");
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "That did not send. Try again in a minute.");
    }
  }

  if (state === "done" || (user && user.emailVerified && !token && !pendingEmail)) {
    return (
      <AuthShell
        eyebrow="Email confirmed"
        title={
          <>
            You can <span className="font-serif font-normal italic">host</span> now.
          </>
        }
        subtitle="Your address is confirmed. Start a party whenever you like."
      >
        <div className="space-y-5">
          <Banner tone="success">That is all we needed.</Banner>
          <Button size="lg" onClick={() => router.push(next)}>
            Start a party
          </Button>
        </div>
      </AuthShell>
    );
  }

  // The link path: redeeming, or spent.
  if (token && state === "working") {
    return (
      <AuthShell eyebrow="One moment" title="Checking your link…">
        <Spinner className="text-gold" />
      </AuthShell>
    );
  }

  if (token && state === "failed") {
    return (
      <AuthShell
        eyebrow="Email"
        title={
          <>
            That link is <span className="font-serif font-normal italic">spent.</span>
          </>
        }
        subtitle="Links work once and expire after a day. The code from the same email works too."
      >
        <div className="space-y-5">
          <Banner tone="error">{error}</Banner>
          {signupToken ? (
            <Link href="/register">
              <Button variant="secondary">Sign up again</Button>
            </Link>
          ) : (
            <Link href={user ? "/verify" : "/login"}>
              <Button variant="secondary">{user ? "Enter a code instead" : "Sign in to get a new one"}</Button>
            </Link>
          )}
        </div>
      </AuthShell>
    );
  }

  if (loading && !pendingEmail) {
    return (
      <AuthShell eyebrow="One moment" title="Loading…">
        <Spinner className="text-gold" />
      </AuthShell>
    );
  }

  // The code path needs to know whose code it is: the waiting sign-up's
  // address, or the signed-in account.
  const codeEmail = pendingEmail ?? user?.email;
  if (!pendingEmail && !user) {
    return (
      <AuthShell
        eyebrow="Confirm your email"
        title={
          <>
            Sign in <span className="font-serif font-normal italic">first.</span>
          </>
        }
        subtitle="Codes belong to one account, so we need to know who you are. Opening the link from the email works without signing in."
      >
        <Link href="/login?next=/verify">
          <Button size="lg">Sign in</Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Confirm your email"
      title={
        <>
          Check your <span className="font-serif font-normal italic">inbox.</span>
        </>
      }
      subtitle={
        <>
          We sent a six-digit code to <span className="text-cream">{codeEmail}</span>.{" "}
          {pendingEmail ? "Your account is created once you enter it" : "Enter it here"}, or open the link in the
          same email.
        </>
      }
      footer={
        pendingEmail ? (
          <>
            Wrong address?{" "}
            <Link className="font-medium text-gold underline-offset-4 hover:underline" href="/register">
              Sign up again
            </Link>
          </>
        ) : (
          <>
            Joining a room never needs this.{" "}
            <Link className="font-medium text-gold underline-offset-4 hover:underline" href="/">
              Skip for now
            </Link>
          </>
        )
      }
    >
      <form className="space-y-4" onSubmit={submitCode}>
        <label htmlFor="code" className="sr-only">
          Six-digit code
        </label>
        <input
          id="code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          autoFocus
          className="h-16 w-full rounded-2xl border border-line-strong bg-panel text-center font-mono text-3xl tracking-[0.5em] text-cream placeholder:text-faint/40 focus:border-gold/50 focus:outline-none focus:ring-4 focus:ring-gold/10"
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
        {resent && !error ? <Banner tone="success">A new code is on its way.</Banner> : null}
        <Button type="submit" size="lg" disabled={code.length !== 6 || state === "working"} className="w-full">
          {state === "working" ? <Spinner /> : "Confirm"}
        </Button>
        <Button type="button" variant="subtle" size="sm" onClick={() => void resend()} className="w-full">
          Send a new code
        </Button>
      </form>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  );
}
