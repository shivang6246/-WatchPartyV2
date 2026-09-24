"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { PlayerHandle, QualityLevel } from "@/lib/player";

interface Props {
  src: string;
  onHandle: (handle: PlayerHandle | null) => void;
  onBuffering: (buffering: boolean) => void;
  /** The video played to its end; the room may advance its queue. */
  onEnded?: () => void;
}

const AUTO: QualityLevel = { id: "auto", label: "Auto" };

/**
 * A plain video element the page owns outright, so it accepts any rate.
 *
 * <p>An .m3u8 goes through hls.js unless the browser plays HLS natively
 * (Safari): Chrome and Firefox cannot, so without this the "direct link"
 * source silently fails for most viewers. It also hands us the real quality
 * ladder, which a progressive MP4 does not have.
 *
 * <p>hls.js is about half a megabyte, so it is fetched only when the source is
 * actually HLS; an MP4 or a YouTube room never downloads it.
 */
export default function HostedPlayer({ src, onHandle, onBuffering, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  // Re-announces the handle when the ladder arrives, so the menu appears.
  const [qualities, setQualities] = useState<QualityLevel[]>([]);

  const isHls = /\.m3u8(\?|$)/i.test(src);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const playNatively = () => {
      video.src = src;
      setQualities([]);
    };
    if (!isHls) {
      playNatively();
      return;
    }

    let cancelled = false;
    // hls.js first wherever it runs: Chrome answers "maybe" to canPlayType for
    // HLS and then plays it without a quality ladder, so native is the fallback
    // for the browsers that have no MSE (iOS Safari), not the preference.
    void import("hls.js")
      .then(({ default: HlsPlayer }) => {
        if (cancelled) return;
        if (!HlsPlayer.isSupported()) {
          playNatively();
          return;
        }
        const hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: false });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(src);
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          setQualities([
            AUTO,
            ...hls.levels
              .map((level, index) => ({
                id: String(index),
                label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}k`,
              }))
              .reverse(),
          ]);
        });
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // Network and media errors are usually recoverable; anything else is not.
          if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else hls.destroy();
        });
      })
      // The chunk failed to load (offline, a deploy in between): try the browser's own player.
      .catch(() => {
        if (!cancelled) playNatively();
      });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, isHls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handle: PlayerHandle = {
      play: () => {
        // Autoplay with sound is blocked until the viewer interacts; muting is
        // the only way to keep an un-clicked tab in sync at all.
        void video.play().catch(() => {
          video.muted = true;
          void video.play().catch(() => undefined);
        });
      },
      pause: () => video.pause(),
      seek: (positionMs: number) => {
        video.currentTime = positionMs / 1000;
      },
      getPositionMs: () => video.currentTime * 1000,
      getDurationMs: () => (Number.isFinite(video.duration) ? video.duration * 1000 : null),
      setRate: (rate: number) => {
        video.playbackRate = rate;
      },
      isReady: () => video.readyState >= 1,
      isPlaying: () => !video.paused && !video.ended,
      setVolume: (volume: number) => {
        video.volume = Math.min(1, Math.max(0, volume));
        if (volume > 0) video.muted = false;
      },
      getVolume: () => video.volume,
      setMuted: (muted: boolean) => {
        video.muted = muted;
      },
      isMuted: () => video.muted || video.volume === 0,
      getQualities: () => qualities,
      getQuality: () => {
        const hls = hlsRef.current;
        if (!hls) return "auto";
        return hls.currentLevel < 0 || hls.autoLevelEnabled ? "auto" : String(hls.currentLevel);
      },
      setQuality: (id: string) => {
        const hls = hlsRef.current;
        if (!hls) return;
        hls.currentLevel = id === "auto" ? -1 : Number(id);
      },
      requestNativeFullscreen: () => {
        // iOS Safari allows fullscreen only on the video element itself.
        const legacy = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
        if (typeof legacy.webkitEnterFullscreen === "function" && !document.fullscreenEnabled) {
          legacy.webkitEnterFullscreen();
          return true;
        }
        return false;
      },
      fineRateSupported: true,
    };

    const announce = () => onHandle(handle);
    const stalled = () => onBuffering(true);
    const resumed = () => onBuffering(false);
    const ended = () => endedRef.current?.();

    video.addEventListener("loadedmetadata", announce);
    video.addEventListener("waiting", stalled);
    video.addEventListener("playing", resumed);
    video.addEventListener("canplay", resumed);
    video.addEventListener("ended", ended);
    announce();

    return () => {
      video.removeEventListener("loadedmetadata", announce);
      video.removeEventListener("waiting", stalled);
      video.removeEventListener("playing", resumed);
      video.removeEventListener("canplay", resumed);
      video.removeEventListener("ended", ended);
      onHandle(null);
    };
  }, [src, qualities, onHandle, onBuffering]);

  return (
    <div className="stage-frame aspect-video w-full overflow-hidden bg-black">
      <video ref={videoRef} playsInline className="h-full w-full" preload="auto" />
    </div>
  );
}
