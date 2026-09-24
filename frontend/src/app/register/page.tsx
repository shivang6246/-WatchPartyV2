"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { Banner, Button, Field, Input, PasswordInput } from "@/components/ui";
import { HttpError, readGuestToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Registering from inside a room keeps your seat: the guest pass is sent
  // along so the existing member row is rebound to the new account.
  const roomCode = params.get("room");
  const next = params.get("next") ?? (roomCode ? `/room/${roomCode}` : "/");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await register(email, password, displayName, roomCode ? readGuestToken(roomCode) : null);
      // Where confirmation is enforced there is no account yet: it is created
      // on the code screen. Otherwise carry on where they were headed.
      router.push(
        result.status === "pending"
          ? `/verify?email=${encodeURIComponent(result.email)}&next=${encodeURIComponent(next)}`
          : next,
      );
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow={roomCode ? `Room ${roomCode}` : "Get a ticket"}
      title={
        <>
          Your own <span className="font-serif font-normal italic text-cobalt-soft">screen.</span>
        </>
      }
      subtitle={
        roomCode
          ? `You keep your place in room ${roomCode}. An account lets you host your own rooms too.`
          : "An account lets you host rooms. Guests never need one."
      }
      footer={
        <>
          Already have one?{" "}
          <Link className="font-medium text-cobalt-soft underline-offset-4 hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="nickname"
            placeholder="What friends call you"
            maxLength={40}
            required
          />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint="8+ characters">
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
