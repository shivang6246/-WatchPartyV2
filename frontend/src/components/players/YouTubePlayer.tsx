"use client";

import { useEffect, useRef } from "react";
import type { PlayerHandle, ViewerAction } from "@/lib/player";
import { loadYouTubeApi } from "@/lib/youtube";

/** State changes this soon after the engine drove the player are the engine's own. */
const ENGINE_STATE_MS = 1200;
/** A seek re-buffers on YouTube, and the state flickers for a while after it. */
const ENGINE_SEEK_MS = 2500;
/** Focus left in the player this recently still counts as the viewer using it. */
const FOCUS_GRACE_MS = 5000;
/** A position this far from where playback would have got to is a seek. */
const JUMP_MS = 1500;
/** Clicks and drags on the bar arrive in bursts; they are reported once it settles. */
const SETTLE_MS = 350;
const POLL_MS = 250;

interface Props {
  videoId: string;
  onHandle: (handle: PlayerHandle | null) => void;
  /** The video played to its end; the room may advance its queue. */
  onEnded?: () => void;
  /** YouTube is buffering, so the stage can say so rather than look frozen. */
  onBuffering?: (buffering: boolean) => void;
  /** The viewer played, paused or seeked with YouTube's own controls. */
  onViewerAction?: (action: ViewerAction) => void;
}

/**
 * YouTube's own player, with its own controls. The viewer uses YouTube's bar
 * as they would anywhere else; what they do there is reported through
 * onViewerAction, and the room decides whether it applies to everyone (the
 * host) or gets undone by the sync engine (everyone else).
 *
 * <p>The IFrame API reports state changes but not who caused them, and the
 * sync engine drives this same player. A change counts as the viewer's only
 * when the engine has not touched the player in the last moment and the
 * iframe holds focus, which it takes the moment someone clicks inside it.
 */
export default function YouTubePlayer({ videoId, onHandle, onEnded, onBuffering, onViewerAction }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);
  const handleRef = useRef<(handle: PlayerHandle | null) => void>(onHandle);
  handleRef.current = onHandle;
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const bufferingRef = useRef(onBuffering);
  bufferingRef.current = onBuffering;
  const actionRef = useRef(onViewerAction);
  actionRef.current = onViewerAction;

  useEffect(() => {
    let cancelled = false;
    let player: YT.Player | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;

    // Until when a state change is the engine's doing rather than the viewer's.
    let engineUntil = 0;
    const markEngine = (ms: number) => {
      engineUntil = Math.max(engineUntil, Date.now() + ms);
    };

    let focusedAt = 0;
    const iframe = () => player?.getIframe?.() ?? null;
    const iframeFocused = () => {
      const frame = iframe();
      if (frame && document.activeElement === frame) {
        focusedAt = Date.now();
        return true;
      }
      return Date.now() - focusedAt < FOCUS_GRACE_MS;
    };
    // A click into a cross-origin frame is invisible to this page, except that
    // the window loses focus to it. That is the signal the viewer is using it.
    const onWindowBlur = () => {
      setTimeout(() => {
        if (document.activeElement === iframe()) focusedAt = Date.now();
      }, 0);
    };
    window.addEventListener("blur", onWindowBlur);

    const byViewer = () => !document.hidden && Date.now() >= engineUntil && iframeFocused();

    // The last settled state: buffering is a pause in the picture, not a
    // decision, so it never counts as playing or paused on its own.
    let settled = -1;
    // stateAt is when the last play or pause in the burst happened: the report
    // goes out a settle later, and the room anchors it back at that moment so
    // this player, which moved at the click, is not seeked when the echo lands.
    let pending: { wasPlaying: boolean; seeked: boolean; stateAt: number } | null = null;

    const flush = () => {
      settle = null;
      const change = pending;
      pending = null;
      if (!change || !player || !actionRef.current) return;
      const positionMs = (player.getCurrentTime?.() ?? 0) * 1000;
      const playingNow = settled === YT.PlayerState.PLAYING;
      // A seek is reported where the player is now, so it is anchored now.
      if (change.seeked) actionRef.current({ type: "seek", positionMs, at: Date.now() });
      if (playingNow !== change.wasPlaying) {
        actionRef.current({ type: playingNow ? "play" : "pause", positionMs, at: change.stateAt });
      }
    };

    const noteViewerChange = (kind: "state" | "seek", wasPlaying: boolean) => {
      if (!pending) pending = { wasPlaying, seeked: false, stateAt: Date.now() };
      if (kind === "seek") pending.seeked = true;
      else pending.stateAt = Date.now();
      if (settle) clearTimeout(settle);
      settle = setTimeout(flush, SETTLE_MS);
    };

    loadYouTubeApi().then((YTApi) => {
      if (cancelled || !containerRef.current) return;
      readyRef.current = false;

      player = new YTApi.Player(containerRef.current, {
        videoId,
        playerVars: {
          controls: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            handleRef.current(buildHandle(player!, readyRef, markEngine));

            // Seeks have no event of their own: the position jumps. Tracked
            // here against where playback would have got to by now.
            let last: { at: number; positionMs: number; state: number } | null = null;
            poll = setInterval(() => {
              if (!player || !readyRef.current) return;
              const at = performance.now();
              const positionMs = (player.getCurrentTime?.() ?? 0) * 1000;
              const state = player.getPlayerState?.() ?? -1;
              if (last) {
                const rate = player.getPlaybackRate?.() ?? 1;
                const advancing = last.state === YTApi.PlayerState.PLAYING;
                const expected = last.positionMs + (advancing ? (at - last.at) * rate : 0);
                if (Math.abs(positionMs - expected) > JUMP_MS && byViewer()) {
                  noteViewerChange("seek", settled === YTApi.PlayerState.PLAYING);
                }
              }
              last = { at, positionMs, state };
            }, POLL_MS);
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === YTApi.PlayerState.ENDED) endedRef.current?.();
            bufferingRef.current?.(state === YTApi.PlayerState.BUFFERING);
            if (state === YTApi.PlayerState.BUFFERING) return;

            const before = settled;
            settled = state;
            const decided = state === YTApi.PlayerState.PLAYING || state === YTApi.PlayerState.PAUSED;
            if (decided && state !== before && byViewer()) {
              noteViewerChange("state", before === YTApi.PlayerState.PLAYING);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      window.removeEventListener("blur", onWindowBlur);
      if (poll) clearInterval(poll);
      if (settle) clearTimeout(settle);
      handleRef.current(null);
      readyRef.current = false;
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div className="stage-frame aspect-video w-full overflow-hidden bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function buildHandle(player: YT.Player, readyRef: { current: boolean }, markEngine: (ms: number) => void): PlayerHandle {
  return {
    play: () => {
      markEngine(ENGINE_STATE_MS);
      player.playVideo();
    },
    pause: () => {
      markEngine(ENGINE_STATE_MS);
      player.pauseVideo();
    },
    seek: (positionMs: number) => {
      markEngine(ENGINE_SEEK_MS);
      player.seekTo(positionMs / 1000, true);
    },
    getPositionMs: () => (player.getCurrentTime?.() ?? 0) * 1000,
    getDurationMs: () => {
      const duration = player.getDuration?.() ?? 0;
      return duration > 0 ? duration * 1000 : null;
    },
    setRate: (rate: number) => player.setPlaybackRate(rate),
    setVolume: (volume: number) => {
      player.setVolume?.(Math.round(Math.min(1, Math.max(0, volume)) * 100));
      if (volume > 0) player.unMute?.();
    },
    getVolume: () => (player.getVolume?.() ?? 100) / 100,
    setMuted: (muted: boolean) => (muted ? player.mute?.() : player.unMute?.()),
    isMuted: () => player.isMuted?.() ?? false,
    // Deliberately empty: YouTube deprecated quality selection in the IFrame
    // API and ignores setPlaybackQuality. Its own settings menu still works.
    getQualities: () => [],
    getQuality: () => "auto",
    setQuality: () => undefined,
    isReady: () => readyRef.current && typeof player.getCurrentTime === "function",
    isPlaying: () => {
      const state = player.getPlayerState?.();
      return state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
    },
    // YouTube snaps anything outside its own published rates, so the engine
    // uses the coarse ladder here.
    fineRateSupported: false,
  };
}
