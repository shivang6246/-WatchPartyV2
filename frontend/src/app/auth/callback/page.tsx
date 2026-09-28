"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo, Spinner } from "@/components/ui";
import { refreshAccessToken } from "@/lib/api";

/**
 * Where Google sends the browser back to. The refresh cookie is already set by
 * the backend, so this page just spends one rotation to pick up an access
 * token and moves on.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    refreshAccessToken().finally(() => router.replace("/"));
  }, [router]);

  return (
    <main className="spotlight grid min-h-screen place-items-center px-5">
      <div className="flex flex-col items-center gap-5 text-sm text-muted">
        <Logo />
        <span className="flex items-center gap-2.5">
          <Spinner className="h-4 w-4 text-gold" /> Finishing sign-in…
        </span>
      </div>
    </main>
  );
}
