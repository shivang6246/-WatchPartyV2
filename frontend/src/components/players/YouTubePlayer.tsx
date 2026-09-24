"use client";

import { useEffect, useRef } from "react";
import type { PlayerHandle } from "@/lib/player";

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<typeof YT> | null = null;

/** Loads the IFrame API once per page, however many players mount. */
function loadYouTubeApi(): Promise<typeof YT> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (typeof window !== "undefined" && window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

interface Props {
  videoId: string;
  onHandle: (handle: PlayerHandle | null) => void;
  /** The video played to its end; the room may advance its queue. */
  onEnded?: () => void;
  /** YouTube is buffering, so the stage can say so rather than look frozen. */
  onBuffering?: (buffering: boolean) => void;
}

/**
 * The web client does not need to reach into a YouTube tab, because it hosts
 * the player itself. YouTube's own controls are hidden: every play, pause and
 * seek goes through the room, so there is no second source of truth.
 */
export default function YouTubePlayer({ videoId, onHandle, onEnded, onBuffering }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const handleRef = useRef<(handle: PlayerHandle | null) => void>(onHandle);
  handleRef.current = onHandle;
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const bufferingRef = useRef(onBuffering);
  bufferingRef.current = onBuffering;

  useEffect(() => {
    let cancelled = false;
    let player: YT.Player | null = null;

    loadYouTubeApi().then((YTApi) => {
      if (cancelled || !containerRef.current) return;
      readyRef.current = false;

      player = new YTApi.Player(containerRef.current, {
        videoId,
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current = player;
            handleRef.current(buildHandle(player!, readyRef));
          },
          onStateChange: (event) => {
            if (event.data === YTApi.PlayerState.ENDED) endedRef.current?.();
            bufferingRef.current?.(event.data === YTApi.PlayerState.BUFFERING);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      handleRef.current(null);
      readyRef.current = false;
      playerRef.current = null;
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div className="stage-frame aspect-video w-full overflow-hidden bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function buildHandle(player: YT.Player, readyRef: { current: boolean }): PlayerHandle {
  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (positionMs: number) => player.seekTo(positionMs / 1000, true),
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
    // API and ignores setPlaybackQuality, so a menu here would do nothing.
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
