"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { HttpError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CatalogItem } from "@/lib/types";

/**
 * One tap from a video to a room everyone can join. Hosting needs an account,
 * so a visitor who is not signed in is sent to sign in first and brought back.
 */
export function useStartParty() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const requireAccount = useCallback(() => {
    if (user) return true;
    router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
    return false;
  }, [user, router, pathname]);

  const start = useCallback(
    async (item: CatalogItem) => {
      if (!requireAccount()) return;
      setError(null);
      setBusyRef(item.ref ?? item.url);
      try {
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
      } catch (ex) {
        setError(ex instanceof HttpError ? ex.message : "The room could not be created.");
        setBusyRef(null);
        throw ex;
      }
    },
    [requireAccount, router],
  );

  return { start, error, busyRef, requireAccount, signedIn: Boolean(user) };
}
