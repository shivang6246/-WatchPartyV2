"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader, AppNav } from "@/components/AppNav";
import VerifyEmailBanner from "@/components/VerifyEmailBanner";
import { Avatar, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

/** Who is signed in, and the way out. A visitor gets the two ways in. */
export default function AccountPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();

  return (
    <main className="spotlight mx-auto w-full max-w-6xl px-5 pb-32 sm:px-6 lg:px-8 lg:pb-16">
      <AppHeader />

      <header className="pt-5 lg:pt-8">
        <h1 className="font-serif text-[28px] font-normal leading-tight sm:text-[31px] tracking-[-0.01em] lg:text-5xl">Account</h1>
      </header>

      <div className="mt-6 max-w-xl space-y-4">
        {loading ? (
          <div className="h-40 animate-pulse rounded-[20px] bg-panel" aria-hidden />
        ) : user ? (
          <>
            <section className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <Avatar name={user.displayName} src={user.avatarUrl} size={56} ring />
                <div className="min-w-0">
                  <p className="truncate font-serif text-2xl">{user.displayName}</p>
                  <p className="truncate text-sm text-muted">{user.email}</p>
                </div>
              </div>
              <dl className="mt-6 divide-y divide-line border-t border-line text-sm">
                <div className="flex items-center justify-between py-3.5">
                  <dt className="text-muted">Signed in with</dt>
                  <dd className="capitalize">{user.provider === "local" ? "Email" : user.provider}</dd>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <dt className="text-muted">Email</dt>
                  <dd className={user.emailVerified ? "text-cream" : "text-gold-soft"}>
                    {user.emailVerified ? "Confirmed" : "Not confirmed yet"}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <dt className="text-muted">Hosting</dt>
                  <dd>{!user.verificationRequired || user.emailVerified ? "Available" : "After you confirm your email"}</dd>
                </div>
              </dl>
            </section>

            {user.verificationRequired && !user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}

            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={async () => {
                await signOut();
                router.push("/");
              }}
            >
              Sign out
            </Button>
          </>
        ) : (
          <section className="rounded-[20px] border border-line bg-panel p-6 text-center sm:p-8">
            <p className="font-serif text-2xl italic text-cream/85">You are watching as a guest.</p>
            <p className="mt-1 text-sm text-faint">An account lets you host rooms and find the ones you joined.</p>
            <div className="mt-6 flex justify-center gap-2">
              <Link href="/login?next=/account">
                <Button>Sign in</Button>
              </Link>
              <Link href="/register">
                <Button variant="secondary">Create account</Button>
              </Link>
            </div>
          </section>
        )}
      </div>

      <AppNav />
    </main>
  );
}
