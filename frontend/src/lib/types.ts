export type Platform = "youtube" | "hosted" | "vimeo" | "drm_extension";

export interface UserView {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl?: string | null;
  provider: string;
  emailVerified: boolean;
  /** False when nothing is held back by being unverified (no SMTP configured). */
  verificationRequired: boolean;
}

/** Register's answer when the account only exists once the emailed code is confirmed. */
export interface PendingRegistration {
  pending: true;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: UserView;
}

export interface GuestResponse {
  guestToken: string;
  roomId: string;
  roomCode: string;
  displayName: string;
}

export interface MemberView {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "host" | "member";
  guest: boolean;
  present: boolean;
  muted: boolean;
  joinedAt: string;
}

/** One shape for playback in both directions; see the backend PlaybackMessage. */
export interface PlaybackMessage {
  action: string;
  positionMs?: number;
  playing?: boolean;
  speed?: number;
  durationMs?: number | null;
  sequence?: number;
  serverTs?: number;
  memberId?: string | null;
}

export interface RoomView {
  id: string;
  code: string;
  title: string;
  platform: Platform;
  videoUrl: string | null;
  videoRef: string | null;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  videoAuthor?: string | null;
  locked: boolean;
  active: boolean;
  maxMembers: number;
  expiresAt: string;
  hostMemberId: string | null;
  /** Returned to the host only: the room's real access credential. */
  inviteToken?: string | null;
  selfMemberId: string | null;
  selfRole: "host" | "member" | null;
  members: MemberView[];
  playback: PlaybackMessage;
  serverTs: number;
  /** Identifies what is playing now; a queue advance names the item it replaces. */
  currentItemId: string | null;
  /** What plays after the current video, in order. */
  queue: QueueItem[];
  /** Set while a disconnected host's grace period runs: epoch millis it ends. */
  hostAwayUntil?: number | null;
}

export interface QueueItem {
  id: string;
  platform: Platform;
  videoUrl: string | null;
  videoRef: string | null;
  title?: string | null;
  thumbnail?: string | null;
  author?: string | null;
  durationMs?: number | null;
  addedByMemberId?: string | null;
  addedByName?: string | null;
  addedAt: string;
}

export interface RoomPreview {
  code: string;
  title: string;
  platform: Platform;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  locked: boolean;
  active: boolean;
  memberCount: number;
}

/** A room tile on the home screen. */
export interface RoomCard {
  id: string;
  code: string;
  title: string;
  platform: Platform;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  host: boolean;
  memberCount: number;
  updatedAt: string;
}

/** One browsable item from the in-app catalogue. */
export interface CatalogItem {
  platform: Platform;
  ref: string | null;
  url: string;
  title: string;
  author?: string | null;
  thumbnail?: string | null;
  durationMs?: number | null;
  live: boolean;
}

export interface CatalogPage {
  items: CatalogItem[];
  nextPageToken?: string | null;
  /** "search_unavailable" when the deployment has no YouTube API key. */
  notice?: string | null;
}

export interface SourceStatus {
  id: Platform;
  label: string;
  /** Whether this source can be searched from inside the app. */
  browsable: boolean;
  playableOnWeb: boolean;
  note?: string | null;
}

export interface ChatMessageView {
  id: string;
  memberId: string;
  displayName: string;
  body: string;
  createdAt: string;
}

export interface ChatPage {
  messages: ChatMessageView[];
  nextBefore: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  timestamp?: string;
}

export interface RealtimeError {
  code: string;
  message: string;
  state?: PlaybackMessage;
  /** Set on member-targeted notices (removed, muted), which reach every tab. */
  roomId?: string;
}

export type MemberEvent =
  | { type: "roster"; members: MemberView[] }
  | { type: "left"; memberId: string }
  | { type: "health"; memberId: string; behind: boolean; driftMs: number }
  | { type: "room"; room: Partial<RoomView> }
  | { type: "closed"; reason?: "host" | "empty" | "expired" }
  | {
      type: "host";
      hostMemberId: string;
      hostName: string;
      previousHostMemberId?: string;
      reason: "transfer" | "failover";
    }
  | { type: "host-away"; memberId: string; deadline: number }
  | { type: "host-back"; memberId: string }
  | { type: "host-lost" }
  | { type: "queue"; queue: QueueItem[]; currentItemId: string | null };

/** Ephemeral room signals on the activity topic; nothing here is stored. */
export type ActivityEvent =
  | { type: "reaction"; id: string; memberId: string; displayName: string; emoji: string; serverTs: number }
  | { type: "typing"; memberId: string; displayName: string; typing: boolean };

/** Must match ChatService.REACTIONS on the backend, which rejects anything else. */
export const REACTIONS = ["👍", "😂", "😮", "😢", "❤️", "🔥", "👏", "🎉"] as const;
