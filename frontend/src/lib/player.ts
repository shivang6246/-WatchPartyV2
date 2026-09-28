/** One selectable rendition. `auto` is always present when there is a choice. */
export interface QualityLevel {
  id: string;
  label: string;
}

/** A captions language the viewer may turn on. */
export interface CaptionTrack {
  id: string;
  label: string;
}

/**
 * The one interface the room's player (PlayerSurface) and the sync engine
 * drive. YouTube, a plain video element and anything added later all look the
 * same from here, which keeps the engine free of player-specific branches.
 * Every player is chromeless: WatchParty draws all the controls.
 */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  /** Absolute position, in milliseconds. */
  seek(positionMs: number): void;
  getPositionMs(): number;
  getDurationMs(): number | null;
  setRate(rate: number): void;
  isReady(): boolean;
  /** 0 to 1. Volume is per viewer and never synced: the room shares a video, not a living room. */
  setVolume(volume: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /**
   * What the viewer may pick from, or empty when the player decides for
   * itself. YouTube is empty on purpose: its IFrame API deprecated quality
   * selection and ignores what it is told, so offering a menu there would be
   * a lie. HLS through hls.js reports its real ladder.
   */
  getQualities(): QualityLevel[];
  getQuality(): string;
  setQuality(id: string): void;
  /**
   * Fullscreen for browsers that only allow it on a video element (iOS
   * Safari). Returns false when the page should use the Fullscreen API on the
   * whole stage instead, which is what keeps the room's controls visible.
   */
  requestNativeFullscreen?(): boolean;
  /** How much is loaded, 0 to 1, for the seek bar's buffered track. */
  getBufferedFraction?(): number;
  /** The playback speeds this player honours, for the host's speed menu. */
  getRates?(): number[];
  /**
   * Captions, per viewer and never synced. The list may be empty until they
   * have been turned on once (YouTube only reports its tracks then).
   */
  getCaptionTracks?(): CaptionTrack[];
  getCaptionTrack?(): string | null;
  /** A track id, "auto" for the best match to the viewer's language, or null for off. */
  setCaptionTrack?(id: string | null): void;
  /** Picture-in-picture, where the browser has it for this player (a video element). */
  togglePictureInPicture?(): void;
  /**
   * Whether the player is actually advancing, which can differ from what it
   * was last told: YouTube's seekTo resumes playback unless the player is
   * already paused, so a paused room has to check and re-pause.
   */
  isPlaying(): boolean;
  /**
   * Whether the player honours arbitrary playback rates.
   *
   * A video element does, so drift can be closed with an inaudible 3% nudge.
   * YouTube only accepts its own published rates and snaps anything else, so
   * corrections there are coarser and the thresholds differ. See LADDERS.
   */
  readonly fineRateSupported: boolean;
}

export interface Ladder {
  /** Below this, a correction is more noticeable than the error. */
  ignoreMs: number;
  /** Up to this, close the gap by rate rather than by seeking. */
  nudgeMs: number;
  rateUp: number;
  rateDown: number;
  /** Beyond this it is a dropped event, not drift: resync and log it. */
  resyncMs: number;
}

export const LADDERS: Record<"fine" | "coarse", Ladder> = {
  // A video element we own outright: 3% is inaudible and leaves no seek artifact.
  fine: { ignoreMs: 250, nudgeMs: 2000, rateUp: 1.03, rateDown: 0.97, resyncMs: 30000 },
  // YouTube: 1.25x is the smallest step it will actually apply. It still
  // catches up to 2.5 s (in about ten seconds) rather than seeking, because a
  // YouTube seek means seconds of buffering, which is worse than the drift.
  coarse: { ignoreMs: 300, nudgeMs: 2500, rateUp: 1.25, rateDown: 0.75, resyncMs: 30000 },
};
