import type { ServerClock } from "./clock";
import { LADDERS, type Ladder, type PlayerHandle } from "./player";
import type { PlaybackMessage } from "./types";

export interface SyncState {
  positionMs: number;
  playing: boolean;
  speed: number;
  anchorTs: number;
  durationMs: number | null;
  sequence: number;
}

/** How often each ladder tier fired since the last drain; sent on heartbeats. */
export interface CorrectionCounts {
  rateCorrections: number;
  seekCorrections: number;
  resyncs: number;
}

export interface SyncDiagnostics {
  driftMs: number;
  offsetMs: number;
  rttMs: number;
  correcting: "none" | "rate" | "seek";
  behind: boolean;
  /**
   * The room is playing but this player will not start: almost always the
   * browser's autoplay policy on a guest who has not touched the page yet.
   * Only a click can fix it, so the UI offers one.
   */
  blocked: boolean;
}

/** Ticks a playing room may spend with a stopped player before we call it blocked. */
const BLOCKED_AFTER_TICKS = 3;
/** Near the end a stopped player is just finished, and must not be restarted. */
const END_GUARD_MS = 1500;
/**
 * How long a buffering player is left alone before the ladder may seek it.
 * Seeking a player that is still filling its buffer throws that buffer away,
 * so a correction there turns one stall into a loop of them.
 */
const BUFFER_GRACE_MS = 8000;
/** After the buffer refills, let the player report a fresh position first. */
const AFTER_BUFFER_SETTLE_MS = 700;
/**
 * A tick this much later than its one-second schedule means the page's thread
 * was blocked (a heavy render, a backgrounded tab). The player's reported
 * position is stale then, YouTube's especially, so that tick measures nothing.
 */
const LATE_TICK_MS = 1800;
/**
 * A seek on a playing room aims this far past where the room is now, because
 * the room keeps moving while the player loads the new spot. Without it the
 * player always lands behind by the load time, seeks again, loads again: a
 * chase that looks like endless buffering. It starts at a typical load time
 * and learns from where each seek actually lands.
 */
const INITIAL_LEAD_MS = { fine: 150, coarse: 900 } as const;
const MAX_LEAD_MS = 6000;

/**
 * The client half of the sync engine.
 *
 * <p>The room's state is a position anchored to a server timestamp, so this
 * never replays history: it projects where playback should be right now and
 * corrects towards it on a ladder. The ladder matters more than the rest of
 * the engine, because the wrong correction is worse than the drift it fixes.
 */
export class SyncEngine {
  private state: SyncState | null = null;
  private player: PlayerHandle | null = null;
  private nudging = false;
  private lastDrift = 0;
  private lastCorrection: SyncDiagnostics["correcting"] = "none";
  /** Set while we are seeking, so the next tick does not chase our own seek. */
  private settleUntil = 0;
  private counts: CorrectionCounts = { rateCorrections: 0, seekCorrections: 0, resyncs: 0 };
  private stalledTicks = 0;
  private buffering = false;
  private bufferingSince = 0;
  private lastTickAt = 0;
  /** How far ahead a playing seek aims; see INITIAL_LEAD_MS. Null until a player is attached. */
  private leadMs: number | null = null;
  /** A playing seek was issued and its landing has not been measured yet. */
  private awaitingLanding = false;
  /**
   * Until then the player is left exactly where the viewer put it: the host
   * just played, paused or seeked with the player's own controls and the
   * room's answer is still on its way. Correcting now would undo their click.
   */
  private localHoldUntil = 0;

  constructor(
    private readonly clock: ServerClock,
    private readonly onDiagnostics?: (diagnostics: SyncDiagnostics) => void,
    private readonly onDefect?: (driftMs: number) => void,
  ) {}

  attach(player: PlayerHandle | null) {
    this.player = player;
    if (player && this.leadMs === null) {
      this.leadMs = player.fineRateSupported ? INITIAL_LEAD_MS.fine : INITIAL_LEAD_MS.coarse;
    }
    if (player && this.state) {
      this.hardApply();
    }
  }

  /** The player started or stopped buffering; see BUFFER_GRACE_MS. */
  setBuffering(buffering: boolean) {
    if (buffering === this.buffering) return;
    this.buffering = buffering;
    if (buffering) {
      this.bufferingSince = Date.now();
    } else {
      this.settleUntil = Math.max(this.settleUntil, Date.now() + AFTER_BUFFER_SETTLE_MS);
    }
  }

  get current(): SyncState | null {
    return this.state;
  }

  /**
   * Leaves the player alone for a moment: the viewer acted on it directly and
   * the room has been asked to follow. The room's answer ends the hold early;
   * if it never comes, the hold runs out and the room's state wins again.
   */
  holdLocal(ms: number) {
    this.clearNudge();
    this.localHoldUntil = Date.now() + ms;
  }

  /**
   * This viewer's own play, pause or seek, done to the player now rather than
   * when the room's echo arrives, then held like holdLocal until it does. The
   * room anchors the change at the moment it was made, so the echo finds the
   * player already in place and has nothing to correct.
   */
  applyLocal(change: { playing: boolean; positionMs?: number }, holdMs: number) {
    this.holdLocal(holdMs);
    const player = this.player;
    if (!player || !player.isReady()) return;
    // Pause before seeking, as in hardApply: YouTube's seekTo resumes a player.
    if (!change.playing) player.pause();
    if (change.positionMs !== undefined) {
      player.seek(change.positionMs);
      // Past the hold, the load time is not drift to chase.
      this.settleUntil = Date.now() + 1200;
    }
    if (change.playing) player.play();
  }

  private get ladder(): Ladder {
    return this.player?.fineRateSupported ? LADDERS.fine : LADDERS.coarse;
  }

  /**
   * Applies an event from the server.
   *
   * <p>Anything not newer than what we already applied is dropped. That single
   * rule absorbs out-of-order delivery, duplicates from a reconnect, and the
   * race where two members seek at the same instant.
   */
  applyRemote(message: PlaybackMessage) {
    const sequence = message.sequence ?? 0;
    if (this.state && sequence <= this.state.sequence) {
      return;
    }
    this.state = {
      positionMs: message.positionMs ?? 0,
      playing: message.playing ?? false,
      speed: message.speed ?? 1,
      anchorTs: message.serverTs ?? this.clock.now(),
      durationMs: message.durationMs ?? this.state?.durationMs ?? null,
      sequence,
    };
    this.localHoldUntil = 0;
    this.hardApply();
  }

  /** Where playback should be right now, by this client's corrected clock. */
  projectedPositionMs(): number {
    if (!this.state) return 0;
    if (!this.state.playing) return this.state.positionMs;
    const elapsed = Math.max(0, this.clock.now() - this.state.anchorTs);
    const projected = this.state.positionMs + elapsed * this.state.speed;
    return this.state.durationMs ? Math.min(projected, this.state.durationMs) : projected;
  }

  /**
   * Brings the player to the projection: used on join and on every accepted
   * event. A player already in place is only played or paused, never seeked,
   * because every seek on YouTube is a trip back to the buffer.
   */
  private hardApply() {
    const player = this.player;
    if (!player || !this.state || !player.isReady()) return;

    this.clearNudge();
    // The room's speed, every time: clearNudge only restores it after a
    // nudge, so without this the host's speed change reached nobody.
    player.setRate(this.state.speed);
    const target = this.projectedPositionMs();
    const offBy = Math.abs(player.getPositionMs() - target);
    const needsSeek = offBy > this.ladder.ignoreMs;

    if (this.state.playing) {
      if (needsSeek) this.seekPlaying(target);
      player.play();
    } else {
      // Pause first: YouTube's seekTo resumes a player that is not already
      // paused, so seeking first would restart the video we just stopped.
      player.pause();
      if (needsSeek) {
        player.seek(target);
        this.settleUntil = Date.now() + 1200;
      }
    }
  }

  /** Seeks a playing player to where the room will be once it has loaded. */
  private seekPlaying(expected: number) {
    const player = this.player;
    if (!player || !this.state) return;
    const lead = this.leadMs ?? 0;
    const target = this.state.durationMs ? Math.min(expected + lead, this.state.durationMs) : expected + lead;
    player.seek(target);
    this.awaitingLanding = true;
    this.settleUntil = Date.now() + 1200;
  }

  /** Runs about once a second while a room is open. */
  tick() {
    const player = this.player;
    if (!player || !this.state || !player.isReady()) return;

    const expected = this.projectedPositionMs();
    const actual = player.getPositionMs();
    const drift = actual - expected;
    this.lastDrift = drift;

    if (Date.now() < this.localHoldUntil) {
      this.stalledTicks = 0;
      this.report("none");
      return;
    }

    // A playing room must actually be playing. The player can stop on its own:
    // a click on the video, an autoplay block, a tab that was backgrounded.
    // The ladder below only ever seeks or nudges the rate, so without this a
    // stopped player would sit frozen while the room played on without it.
    const nearEnd = this.state.durationMs !== null && expected >= this.state.durationMs - END_GUARD_MS;
    if (this.state.playing && !nearEnd && !player.isPlaying()) {
      this.stalledTicks += 1;
      player.play();
    } else {
      this.stalledTicks = 0;
    }

    // A paused room must actually be paused. Checked before the settle window
    // too: without it, a player that resumed after a seek keeps running, and
    // the correction below seeks it back every second — frames playing in
    // jumps instead of a still picture.
    if (!this.state.playing && player.isPlaying()) {
      player.pause();
    }

    const now = Date.now();
    const late = this.lastTickAt > 0 && now - this.lastTickAt > LATE_TICK_MS;
    this.lastTickAt = now;

    if (now < this.settleUntil) {
      this.report("seek");
      return;
    }

    // Measurements that cannot be trusted are not acted on: a correction from
    // a stale position is a seek, and on YouTube every seek re-buffers.
    if (late || (this.buffering && now - this.bufferingSince < BUFFER_GRACE_MS)) {
      this.report(this.nudging ? "rate" : "none");
      return;
    }

    if (!this.state.playing) {
      // Paused rooms only need to agree on a position, and only loosely.
      if (Math.abs(drift) > 500) {
        player.pause();
        player.seek(expected);
        this.settleUntil = Date.now() + 800;
      }
      this.report("none");
      return;
    }

    if (this.awaitingLanding) {
      // Where the seek landed says how long loading took: behind means the
      // lead was too short, ahead means too long. Damped, so one slow load
      // does not swing it.
      this.awaitingLanding = false;
      this.leadMs = Math.min(MAX_LEAD_MS, Math.max(0, (this.leadMs ?? 0) - drift * 0.7));
    }

    const magnitude = Math.abs(drift);
    const ladder = this.ladder;

    if (magnitude < ladder.ignoreMs) {
      this.clearNudge();
      this.report("none");
      return;
    }

    if (magnitude < ladder.nudgeMs) {
      // Inaudible on a video element, brief on YouTube; either way no seek
      // artifact and it converges in a few seconds.
      const factor = drift > 0 ? ladder.rateDown : ladder.rateUp;
      player.setRate(this.state.speed * factor);
      // Counted once per nudge, not once per tick spent nudging.
      if (!this.nudging) this.counts.rateCorrections += 1;
      this.nudging = true;
      this.report("rate");
      return;
    }

    this.clearNudge();
    this.seekPlaying(expected);

    if (magnitude > ladder.resyncMs) {
      // Too far to be ordinary drift: something was dropped.
      this.counts.resyncs += 1;
      this.onDefect?.(drift);
      this.report("seek");
      return;
    }
    this.counts.seekCorrections += 1;
    this.report("seek");
  }

  /**
   * Starts playback from inside a user gesture, which is the one thing an
   * autoplay block accepts. Call it synchronously from a click handler.
   */
  userStart() {
    const player = this.player;
    if (!player || !this.state) return;
    player.play();
    this.stalledTicks = 0;
    this.hardApply();
  }

  /** Returns and resets the tier counts; the heartbeat reports them. */
  drainCorrections(): CorrectionCounts {
    const counts = this.counts;
    this.counts = { rateCorrections: 0, seekCorrections: 0, resyncs: 0 };
    return counts;
  }

  private clearNudge() {
    if (this.nudging && this.player && this.state) {
      this.player.setRate(this.state.speed);
      this.nudging = false;
    }
  }

  private report(correcting: SyncDiagnostics["correcting"]) {
    this.lastCorrection = correcting;
    this.onDiagnostics?.({
      driftMs: Math.round(this.lastDrift),
      offsetMs: Math.round(this.clock.offset),
      rttMs: Math.round(this.clock.rtt),
      correcting,
      behind: Math.abs(this.lastDrift) > 2000,
      blocked: this.stalledTicks >= BLOCKED_AFTER_TICKS,
    });
  }

  get diagnostics(): SyncDiagnostics {
    return {
      driftMs: Math.round(this.lastDrift),
      offsetMs: Math.round(this.clock.offset),
      rttMs: Math.round(this.clock.rtt),
      correcting: this.lastCorrection,
      behind: Math.abs(this.lastDrift) > 2000,
      blocked: this.stalledTicks >= BLOCKED_AFTER_TICKS,
    };
  }
}
