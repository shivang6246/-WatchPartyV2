"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, restoreSession, setAccessToken } from "./api";
import type { AuthResponse, UserView } from "./types";

/** Either signed in already, or waiting on the code emailed to `email`. */
export type RegisterResult = { status: "signed-in"; user: UserView } | { status: "pending"; email: string };

interface AuthContextValue {
  user: UserView | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
    guestToken?: string | null,
  ) => Promise<RegisterResult>;
  /** Creates the held account from its emailed code or link, and signs in. */
  confirmRegistration: (body: { email: string; code: string } | { token: string }) => Promise<UserView>;
  signOut: () => Promise<void>;
  /** Re-reads the account, e.g. after confirming an email address. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Restores a session from the refresh cookie on load. The access token itself
 * never leaves memory, so a reload always goes through one rotation.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Shared with any API call that was made before this effect ran.
    restoreSession()
      .then(async (token) => {
        if (!token || cancelled) return;
        const me = await api.me().catch(() => null);
        if (!cancelled) setUser(me);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = await api.login({ email, password });
    setAccessToken(auth.accessToken);
    setUser(auth.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string, guestToken?: string | null) => {
      // Passing the guest pass here is what keeps a mid-room registrant in
      // their seat instead of creating a second participant.
      const result = await api.register({ email, password, displayName }, guestToken);
      if ("pending" in result) {
        return { status: "pending", email: result.email } as const;
      }
      setAccessToken(result.accessToken);
      setUser(result.user);
      return { status: "signed-in", user: result.user } as const;
    },
    [],
  );

  const confirmRegistration = useCallback(async (body: { email: string; code: string } | { token: string }) => {
    const auth: AuthResponse = await api.confirmRegistration(body);
    setAccessToken(auth.accessToken);
    setUser(auth.user);
    return auth.user;
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.me().catch(() => null);
    if (me) setUser(me);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  // The hint the layout's first-paint script reads (see AUTH_HINT in
  // layout.tsx): only a display name, never a credential. Written once the
  // session is known, so the next page load draws the right greeting at once.
  useEffect(() => {
    if (loading) return;
    const root = document.documentElement;
    try {
      if (user) localStorage.setItem("wp.name", user.displayName);
      else localStorage.removeItem("wp.name");
    } catch {
      // Private mode: every load simply starts from the signed-out layout.
    }
    root.dataset.auth = user ? "in" : "out";
    if (user) root.style.setProperty("--wp-name", JSON.stringify(user.displayName));
    else root.style.removeProperty("--wp-name");
  }, [user, loading]);

  const value = useMemo(
    () => ({ user, loading, signIn, register, confirmRegistration, signOut, refreshUser }),
    [user, loading, signIn, register, confirmRegistration, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
