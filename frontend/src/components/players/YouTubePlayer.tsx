"use client";

import { useEffect, useRef } from "react";
import type { CaptionTrack, PlayerHandle } from "@/lib/player";
import { loadYouTubeApi } from "@/lib/youtube";

interface Props {
  videoId: string;
  /**
   * Captions are on for this viewer. YouTube draws them near the bottom of
   * its player, inside the band the frame normally clips, so while they are
   * on the embed is sized to the picture alone (see the class comment).
   */
  captions?: boolean;
  onHandle: (handle: PlayerHandle | null) => void;
  /** The video played to its end; the room may advance its queue. */
  onEnded?: () => void;
  /** YouTube is buffering, so the stage can say so rather than look frozen. */
  onBuffering?: (buffering: boolean) => void;
  /**
   * YouTube refused the video (IFrame API error code), or null when a new
   * video starts. Its own error screen is behind the room's controls, so the
   * stage has to say it.
   */
  onError?: (code: number | null) => void;
}

/** Captions calls the IFrame API supports but does not declare. */
interface CaptionsApi {
  loadModule(module: "captions"): void;
  unloadModule(module: "captions"): void;
  getOption(module: "captions", option: "tracklist"): YouTubeCaption[] | undefined;
  setOption(module: "captions", option: "track", value: { languageCode?: string }): void;
}

interface YouTubeCaption {
  languageCode: string;
  languageName?: string;
  displayName?: string;
}

/** Speeds offered even if YouTube does not say (it always has these). */
const FALLBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * YouTube as a picture only. A YouTube video can only be shown through
 * YouTube's embed, so this is that embed with every piece of YouTube's own
 * interface taken away: no controls or keyboard (`controls: 0`,
 * `disablekb`), never clickable (the room's own controls sit on top, see
 * PlayerSurface), and sized so what YouTube still draws falls outside the
 * frame. The iframe is the fitted 16:9 picture plus 30% above and below it,
 * centred and clipped: YouTube pins its title bar to the top of the player and
 * its paused "More videos" panel and logo to the bottom, so they land in the
 * clipped bands while the picture fills the frame exactly.
 *
 * <p>YouTube always centres the picture, so the bands are always equal, and
 * its captions sit in the bottom one. While a viewer has captions on, the
 * iframe is the picture alone and YouTube's title bar can show at the start
 * and while paused: the price of captions. The resize happens only when they
 * are switched, since YouTube re-picks its quality on every resize.
 */
export default function YouTubePlayer({ videoId, captions: captionsOn = false, onHandle, onEnded, onBuffering, onError }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);
  const handleRef = useRef<(handle: PlayerHandle | null) => void>(onHandle);
  handleRef.current = onHandle;
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const bufferingRef = useRef(onBuffering);
  bufferingRef.current = onBuffering;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let player: YT.Player | null = null;
    // YouTube lists a video's caption tracks only once the captions module is
    // loaded, which is also what shows them: so they are loaded on demand.
    const captions: CaptionsState = { tracks: [], current: null, wanted: null };

    errorRef.current?.(null);
    loadYouTubeApi().then((YTApi) => {
      if (cancelled || !containerRef.current) return;
      readyRef.current = false;

      player = new YTApi.Player(containerRef.current, {
        // Privacy-enhanced mode, like the home trailer: no YouTube cookies
        // until someone plays. It also plays on pages the standard embed
        // refuses (a site reached by an IP address, e.g. a phone testing a
        // dev machine over Wi-Fi, got "This video is unavailable" there).
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            handleRef.current(buildHandle(player!, readyRef, captions));
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === YTApi.PlayerState.ENDED) endedRef.current?.();
            bufferingRef.current?.(state === YTApi.PlayerState.BUFFERING);
          },
          onError: (event) => {
            // Nothing more to drive: without this the sync engine keeps
            // correcting a player that cannot play, and asks for a resync
            // every tick once its drift passes the threshold.
            readyRef.current = false;
            handleRef.current(null);
            bufferingRef.current?.(false);
            errorRef.current?.(Number(event.data));
          },
          // The captions module loaded (or changed): its tracks are known now.
          onApiChange: () => {
            if (!player) return;
            const list = (player as unknown as CaptionsApi).getOption("captions", "tracklist") ?? [];
            captions.tracks = list.map((track) => ({
              id: track.languageCode,
              label: track.displayName ?? track.languageName ?? track.languageCode,
            }));
            if (captions.wanted) applyCaptions(player, captions, captions.wanted);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      handleRef.current(null);
      readyRef.current = false;
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div
      className={`stage-frame relative aspect-video w-full overflow-hidden bg-black [container-type:size] [&_iframe]:pointer-events-none [&_iframe]:absolute [&_iframe]:left-1/2 [&_iframe]:top-1/2 [&_iframe]:w-[min(100cqw,177.78cqh)] [&_iframe]:max-w-none [&_iframe]:-translate-x-1/2 [&_iframe]:-translate-y-1/2 ${
        captionsOn ? "[&_iframe]:h-[calc(min(100cqw,177.78cqh)*0.5625)]" : "[&_iframe]:h-[calc(min(100cqw,177.78cqh)*0.9)]"
      }`}
    >
      <div ref={containerRef} />
    </div>
  );
}

interface CaptionsState {
  tracks: CaptionTrack[];
  current: string | null;
  /**
   * What the viewer asked for, "auto" or a language code, kept until captions
   * are turned off: a track set while the module is still loading can be
   * dropped, so it is set again whenever YouTube reports the module changed.
   */
  wanted: string | null;
}

/** The viewer's language if the video has it, then English, then whatever there is. */
function pickTrack(tracks: CaptionTrack[]): string | null {
  const language = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  const base = language.split("-")[0];
  return (
    tracks.find((track) => track.id.toLowerCase() === language)?.id ??
    tracks.find((track) => track.id.toLowerCase().split("-")[0] === base)?.id ??
    tracks.find((track) => track.id.toLowerCase().startsWith("en"))?.id ??
    tracks[0]?.id ??
    null
  );
}

function applyCaptions(player: YT.Player, captions: CaptionsState, wanted: string) {
  if (captions.tracks.length === 0) return;
  const id = wanted === "auto" ? pickTrack(captions.tracks) : wanted;
  if (!id) return;
  (player as unknown as CaptionsApi).setOption("captions", "track", { languageCode: id });
  captions.current = id;
}

function buildHandle(player: YT.Player, readyRef: { current: boolean }, captions: CaptionsState): PlayerHandle {
  const api = player as unknown as CaptionsApi;
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
    // API and ignores setPlaybackQuality; it picks the quality itself.
    getQualities: () => [],
    getQuality: () => "auto",
    setQuality: () => undefined,
    getBufferedFraction: () => player.getVideoLoadedFraction?.() ?? 0,
    getRates: () => {
      const rates = player.getAvailablePlaybackRates?.() ?? [];
      return rates.length > 1 ? rates : FALLBACK_RATES;
    },
    getCaptionTracks: () => captions.tracks,
    // Asked for but still loading counts as on, so the button does not flicker.
    getCaptionTrack: () => captions.current ?? captions.wanted,
    setCaptionTrack: (id: string | null) => {
      if (id === null) {
        captions.wanted = null;
        captions.current = null;
        api.unloadModule("captions");
        return;
      }
      captions.wanted = id;
      api.loadModule("captions");
      // Known already: switch now. Either way onApiChange applies it again
      // once the module has loaded and listed the video's tracks.
      if (captions.tracks.length > 0) applyCaptions(player, captions, id);
    },
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
