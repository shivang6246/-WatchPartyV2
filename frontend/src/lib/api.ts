import type {
  AuthResponse,
  CatalogItem,
  CatalogPage,
  ChatPage,
  FriendActivity,
  FriendRelation,
  FriendsOverview,
  GuestResponse,
  PendingRegistration,
  QueueItem,
  RoomCard,
  RoomPreview,
  RoomView,
  SourceStatus,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8080";

/**
 * The access token is held in memory only. The refresh token is an HttpOnly
 * cookie the page can never read, which is the point: a script that leaks the
 * access token leaks fifteen minutes, not the session.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let restoring: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Guest passes are scoped to one room and survive a refresh in local storage. */
export function guestTokenKey(roomCode: string) {
  return `wp.guest.${roomCode.toUpperCase()}`;
}

export function readGuestToken(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(guestTokenKey(roomCode));
  } catch {
    return null;
  }
}

export function writeGuestToken(roomCode: string, token: string) {
  try {
    window.localStorage.setItem(guestTokenKey(roomCode), token);
  } catch {
    // Private mode: the pass simply will not survive a reload.
  }
}

/** Drops a guest pass the server no longer accepts, so the next visit asks for a name. */
export function clearGuestToken(roomCode: string) {
  try {
    window.localStorage.removeItem(guestTokenKey(roomCode));
  } catch {
    // Nothing stored, or storage is unavailable.
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions extends RequestInit {
  /** A room-scoped guest token to use instead of the account access token. */
  token?: string | null;
  /** Skips the refresh-and-retry dance, e.g. for the refresh call itself. */
  noRetry?: boolean;
  /** Sends no Authorization header at all. */
  noAuth?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, noRetry, noAuth, headers, ...rest } = options;
  // A call made while the page is still restoring the session would go out
  // with no token, be refused (a 401 in the console) and only then retried.
  // Wait for the restore instead: it is started once and settles once, so
  // after the first page load this costs nothing.
  if (!noAuth && !token && !accessToken) {
    await restoreSession();
  }
  // An expired access token would be rejected by the auth filter before the
  // handler ever runs, so the refresh call must send none at all.
  const bearer = noAuth ? null : (token ?? accessToken);

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(headers ?? {}),
    },
  });

  if (response.status === 401 && !noRetry && !token) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, noRetry: true });
    }
  }

  if (!response.ok) {
    let code = "http_error";
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new HttpError(response.status, code, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * The session restore from the refresh cookie as the page loads: started by
 * whichever comes first, the auth provider or an early API call (a child's
 * effect runs before its provider's), and shared by both. Later refreshes go
 * through refreshAccessToken.
 */
export function restoreSession(): Promise<string | null> {
  if (!restoring) restoring = refreshAccessToken(true);
  return restoring;
}

/**
 * Concurrent 401s share one rotation: refresh tokens are single-use.
 *
 * @param optional asks "is there a session?" rather than "refresh this one":
 *     with no refresh cookie at all the server answers 204, not a 401 that a
 *     signed-out visitor would see in the console on every page.
 */
export function refreshAccessToken(optional = false): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = apiFetch<AuthResponse | undefined>(`/api/v1/auth/refresh${optional ? "?optional=true" : ""}`, {
      method: "POST",
      noRetry: true,
      noAuth: true,
    })
      .then((auth) => {
        // undefined: the 204, no session to restore.
        const token = auth?.accessToken ?? null;
        setAccessToken(token);
        return token;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// ---- Endpoints ------------------------------------------------------------

export const api = {
  /**
   * Where email confirmation is enforced this creates no account: it answers
   * `pending` and the account appears once `confirmRegistration` succeeds.
   */
  register: (body: { email: string; password: string; displayName: string }, guestToken?: string | null) =>
    apiFetch<AuthResponse | PendingRegistration>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
      token: guestToken ?? undefined,
    }),

  /** Finishes a held sign-up with its code (and address) or its link; signs in. */
  confirmRegistration: (body: { email: string; code: string } | { token: string }) =>
    apiFetch<AuthResponse>("/api/v1/auth/register/confirm", {
      method: "POST",
      body: JSON.stringify(body),
      noAuth: true,
    }),

  resendRegistration: (email: string) =>
    apiFetch<void>("/api/v1/auth/register/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
      noAuth: true,
    }),

  login: (body: { email: string; password: string }) =>
    apiFetch<AuthResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),

  logout: () => apiFetch<void>("/api/v1/auth/logout", { method: "POST" }),

  me: () => apiFetch<AuthResponse["user"]>("/api/v1/auth/me"),

  /** Redeems an emailed link. Needs no session: the token is the proof. */
  verifyEmail: (token: string) =>
    apiFetch<AuthResponse["user"]>("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
      noAuth: true,
    }),

  /** The six-digit code from the same email; needs the session it belongs to. */
  verifyCode: (code: string) =>
    apiFetch<AuthResponse["user"]>("/api/v1/auth/verify/code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  resendVerification: () => apiFetch<void>("/api/v1/auth/verify/resend", { method: "POST" }),

  /** A guest pass for one room, by invite link or by room code alone. */
  guestPass: (body: { inviteToken?: string | null; roomCode?: string; displayName: string }) =>
    apiFetch<GuestResponse>("/api/v1/auth/guest", { method: "POST", body: JSON.stringify(body) }),

  myRooms: () => apiFetch<RoomCard[]>("/api/v1/rooms"),

  // ---- Friends (accounts only) ----
  friends: () => apiFetch<FriendsOverview>("/api/v1/friends"),
  friendActivity: () => apiFetch<FriendActivity>("/api/v1/friends/activity"),
  /** By email, by someone in your room (roomId + memberId), or by a friend link's code. */
  addFriend: (body: { email?: string; roomId?: string; memberId?: string; code?: string }) =>
    apiFetch<FriendsOverview>("/api/v1/friends/requests", { method: "POST", body: JSON.stringify(body) }),
  acceptFriend: (requestId: string) =>
    apiFetch<FriendsOverview>(`/api/v1/friends/requests/${encodeURIComponent(requestId)}/accept`, { method: "POST" }),
  /** Declines a request you received, or cancels one you sent. */
  dismissFriendRequest: (requestId: string) =>
    apiFetch<FriendsOverview>(`/api/v1/friends/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" }),
  unfriend: (userId: string) =>
    apiFetch<FriendsOverview>(`/api/v1/friends/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  setShareActivity: (shareActivity: boolean) =>
    apiFetch<FriendsOverview>("/api/v1/friends/settings", { method: "PATCH", body: JSON.stringify({ shareActivity }) }),
  friendLink: () => apiFetch<{ code: string }>("/api/v1/friends/link"),
  rotateFriendLink: () => apiFetch<{ code: string }>("/api/v1/friends/link/rotate", { method: "POST" }),
  friendsInRoom: (roomId: string) =>
    apiFetch<{ members: Record<string, FriendRelation> }>(`/api/v1/friends/rooms/${encodeURIComponent(roomId)}`),

  createRoom: (body: {
    title?: string;
    platform: string;
    videoUrl?: string;
    videoTitle?: string | null;
    videoThumbnail?: string | null;
    videoAuthor?: string | null;
    durationMs?: number | null;
    maxMembers?: number;
    visibility?: string;
  }) => apiFetch<RoomView>("/api/v1/rooms", { method: "POST", body: JSON.stringify(body) }),

  // ---- In-app catalogue ---------------------------------------------------

  sources: () => apiFetch<SourceStatus[]>("/api/v1/catalog/sources"),

  youtubeSearch: (query: string, pageToken?: string | null) =>
    apiFetch<CatalogPage>(
      `/api/v1/catalog/youtube/search?q=${encodeURIComponent(query)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
    ),

  youtubeTrending: () => apiFetch<CatalogPage>("/api/v1/catalog/youtube/trending"),

  /** New film trailers. Public: the home backdrop plays one to signed-out visitors too. */
  youtubeTrailers: () => apiFetch<CatalogPage>("/api/v1/catalog/youtube/trailers"),

  /** Resolves a pasted link to a title and thumbnail; needs no API key. */
  resolveLink: (url: string, platform?: string) =>
    apiFetch<CatalogItem>(
      `/api/v1/catalog/resolve?url=${encodeURIComponent(url)}` +
        (platform ? `&platform=${encodeURIComponent(platform)}` : ""),
    ),

  preview: (code: string) => apiFetch<RoomPreview>(`/api/v1/rooms/${encodeURIComponent(code)}/preview`),

  getRoom: (code: string, token?: string | null, invite?: string | null) =>
    apiFetch<RoomView>(
      `/api/v1/rooms/${encodeURIComponent(code)}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`,
      { token },
    ),

  joinRoom: (code: string, body: { displayName?: string; inviteToken?: string | null }, token?: string | null) =>
    apiFetch<RoomView>(`/api/v1/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  leaveRoom: (code: string, token?: string | null) =>
    apiFetch<void>(`/api/v1/rooms/${encodeURIComponent(code)}/leave`, { method: "POST", token }),

  patchRoom: (code: string, body: Record<string, unknown>, token?: string | null) =>
    apiFetch<RoomView>(`/api/v1/rooms/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    }),

  closeRoom: (code: string, token?: string | null) =>
    apiFetch<void>(`/api/v1/rooms/${encodeURIComponent(code)}`, { method: "DELETE", token }),

  messages: (code: string, token?: string | null, before?: string | null) =>
    apiFetch<ChatPage>(
      `/api/v1/rooms/${encodeURIComponent(code)}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      { token },
    ),

  // ---- Queue --------------------------------------------------------------

  enqueue: (
    code: string,
    body: {
      platform: string;
      videoUrl: string;
      videoTitle?: string | null;
      videoThumbnail?: string | null;
      videoAuthor?: string | null;
      durationMs?: number | null;
    },
    token?: string | null,
  ) =>
    apiFetch<QueueItem[]>(`/api/v1/rooms/${encodeURIComponent(code)}/queue`, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  dequeue: (code: string, itemId: string, token?: string | null) =>
    apiFetch<QueueItem[]>(
      `/api/v1/rooms/${encodeURIComponent(code)}/queue/${encodeURIComponent(itemId)}`,
      { method: "DELETE", token },
    ),

  reorderQueue: (code: string, itemIds: string[], token?: string | null) =>
    apiFetch<QueueItem[]>(`/api/v1/rooms/${encodeURIComponent(code)}/queue/order`, {
      method: "PUT",
      body: JSON.stringify({ itemIds }),
      token,
    }),

  /** "ended" may come from any member and is checked server-side; "skip" is host-only. */
  advanceQueue: (
    code: string,
    body: { reason: "ended" | "skip"; ifCurrent?: string | null },
    token?: string | null,
  ) =>
    apiFetch<{ advanced: boolean }>(`/api/v1/rooms/${encodeURIComponent(code)}/queue/advance`, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),

  wsTicket: (roomId: string, token?: string | null) =>
    apiFetch<{ ticket: string; expiresInSeconds: number }>("/api/v1/ws-ticket", {
      method: "POST",
      body: JSON.stringify({ roomId }),
      token,
    }),
};
