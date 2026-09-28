"use client";

import Link from "next/link";
import { AppHeader, AppNav } from "@/components/AppNav";
import { JoinCodeForm } from "@/components/home/HeroActions";
import MyRooms from "@/components/home/MyRooms";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

/** Every open room the account hosts or has joined, and a way into anyone else's. */
export default function RoomsPage() {
  const { user, loading } = useAuth();

  return (
    <main className="spotlight mx-auto w-full max-w-6xl px-5 pb-32 sm:px-6 lg:px-8 lg:pb-16">
      <AppHeader />

      <header className="pt-5 lg:pt-8">
        <h1 className="font-serif text-[28px] font-normal leading-tight sm:text-[31px] tracking-[-0.01em] lg:text-5xl">Your rooms</h1>
        <p className="mt-1 text-[13px] text-muted lg:text-sm">Rooms you host or have joined, while they are open.</p>
      </header>

      <div className="mt-6 max-w-xl">
        <JoinCodeForm />
      </div>

      <div className="mt-8">
        {loading ? null : user ? (
          <MyRooms variant="page" />
        ) : (
          <div className="rounded-[20px] border border-line bg-panel px-6 py-10 text-center">
            <p className="font-serif text-2xl italic text-cream/85">Sign in to see your rooms.</p>
            <p className="mt-1 text-sm text-faint">Guests can still join any room with its code.</p>
            <div className="mt-6 flex justify-center gap-2">
              <Link href="/login?next=/rooms">
                <Button>Sign in</Button>
              </Link>
              <Link href="/register">
                <Button variant="secondary">Create account</Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      <AppNav />
    </main>
  );
}
