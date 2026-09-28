"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { useAuth } from "./auth-context";
import type { FriendActivity } from "./types";

/**
 * Who among your friends is watching right now, and how many requests are
 * waiting on you. One poll for the whole page, however many components read
 * it (the home row and the tab bar's badge): it runs while anything is
 * subscribed and the page is visible, and refreshes at once on focus.
 */
const REFRESH_MS = 8000;

let snapshot: FriendActivity | null = null;
let serialized = "";
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function load() {
  if (inFlight || document.hidden) return;
  inFlight = true;
  try {
    const fresh = await api.friendActivity();
    const next = JSON.stringify(fresh);
    if (next !== serialized) {
      serialized = next;
      snapshot = fresh;
      emit();
    }
  } catch {
    // Keep the last answer; the next tick tries again.
  } finally {
    inFlight = false;
  }
}

function start() {
  void load();
  timer = setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", load);
  window.addEventListener("focus", load);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", load);
  window.removeEventListener("focus", load);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks for fresh activity now, e.g. right after accepting a request. */
export function refreshFriendActivity() {
  if (subscribers > 0) void load();
}

/** Live friend activity for the signed-in account; null for a visitor or before the first answer. */
export function useFriendActivity(): FriendActivity | null {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      snapshot = null;
      serialized = "";
      return;
    }
    subscribers += 1;
    if (subscribers === 1) start();
    return () => {
      subscribers -= 1;
      if (subscribers === 0) stop();
    };
  }, [user]);

  const value = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
  return user ? value : null;
}
