"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { Banner, Button, Field, Input, PasswordInput } from "@/components/ui";
import { API_BASE, HttpError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = params.get("next") ?? "/";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      router.push(next);
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title={
        <>
          Take your <span className="font-serif font-normal italic">seat.</span>
        </>
      }
      subtitle="Sign in to host rooms and find the ones you have joined."
      footer={
        <>
          New here?{" "}
          <Link className="font-medium text-gold underline-offset-4 hover:underline" href="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true" ? (
        <>
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <a href={`${API_BASE}/api/v1/auth/google/start`} className="block">
            <Button variant="secondary" size="lg" className="w-full">
              Continue with Google
            </Button>
          </a>
        </>
      ) : null}
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
