"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import HostedPlayer from "@/components/players/HostedPlayer";
import YouTubePlayer from "@/components/players/YouTubePlayer";
import { Spinner, formatTime } from "@/components/ui";
import type { RoomSession } from "@/hooks/useRoom";
import type { CaptionTrack, QualityLevel } from "@/lib/player";

/** How far the ±10 s buttons, J/L, the arrow keys and a double tap jump. */
const SKIP_MS = 10_000;
/** How long the bar holds a committed seek before trusting the projection again. */
const SEEK_HOLD_MS = 1500;
/** The controls fade this long after the last movement while the video plays. */
const IDLE_HIDE_MS = 2600;
/** Two taps on the same side this close together are a double tap. */
const DOUBLE_TAP_MS = 320;
/** A click waits this long for a second one: a double click is fullscreen, not two toggles. */
const CLICK_DELAY_MS = 220;
const VOLUME_STEP = 0.1;

type Flash = { kind: "play" | "pause" | "back" | "forward"; key: number };

/**
 * The room's player. Every video plays chromeless (YouTube with its interface
 * taken away, a bare video element for a direct link) and this draws all of
 * the controls over it, the way a video site does: a seek bar with what is
 * loaded, play/pause, ±10 s, volume, time, captions, speed, quality,
 * picture-in-picture and fullscreen, hiding while the video plays and back
 * on a move or a tap. Click the picture to play or pause, double-click for
 * fullscreen; on a phone tap for the controls and double-tap a side to skip.
 *
 * <p>Play, pause, seek and speed belong to the room, so they go through the
 * session and are the host's (anyone else gets told so); volume, captions,
 * quality and fullscreen are this viewer's own.
 */
export default function PlayerSurface({ session }: { session: RoomSession }) {
  const { room, canControl, playing, durationMs, diagnostics, isHost, speed } = session;
  const [position, setPosition] = useState(0);
  // While dragging, the bar follows the finger; nothing is sent yet.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // After letting go, the bar holds the target until the room's answer lands,
  // instead of snapping back to the old position for a round trip.
  const [held, setHeld] = useState<{ target: number; until: number } | null>(null);

  // Per viewer, never synced: the room shares a video, not a living room.
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [quality, setQualityState] = useState("auto");
  const [buffered, setBuffered] = useState(0);
  const [rates, setRates] = useState<number[]>([]);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [caption, setCaption] = useState<string | null>(null);
  const [captionsSupported, setCaptionsSupported] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);
  // YouTube refused the video (its IFrame API error code); cleared per video.
  const [refusal, setRefusal] = useState<number | null>(null);

  // What is on screen: the controls wake on activity and sleep while playing.
  const [awake, setAwake] = useState(true);
  const [overControls, setOverControls] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [coarse, setCoarse] = useState(false);
  const [hoverTime, setHoverTime] = useState<{ ms: number; x: number } | null>(null);

  const stageRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ at: number; side: "back" | "center" | "forward" } | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressType = useRef("mouse");

  // The session object is rebuilt on every render, so the ticker and the
  // keyboard handler read it through a ref instead of restarting.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const same = <T extends { id: string }>(a: T[], b: T[]) => a.length === b.length && a.every((item, i) => item.id === b[i].id);
    const timer = setInterval(() => {
      const current = sessionRef.current;
      setPosition(current.projectedPositionMs());
      // Everything per viewer comes from the player itself, and a new player
      // (or an HLS manifest, or YouTube's captions module) arrives later.
      const player = current.player();
      if (!player) return;
      setVolumeState((was) => (Math.abs(was - player.getVolume()) < 0.01 ? was : player.getVolume()));
      setMutedState((was) => (was === player.isMuted() ? was : player.isMuted()));
      setQualityState((was) => (was === player.getQuality() ? was : player.getQuality()));
      setQualities((was) => {
        const next = player.getQualities();
        return same(was, next) ? was : next;
      });
      const loaded = player.getBufferedFraction?.() ?? 0;
      setBuffered((was) => (Math.abs(was - loaded) < 0.002 ? was : loaded));
      setRates((was) => {
        const next = player.getRates?.() ?? [];
        return was.length === next.length && was.every((rate, i) => rate === next[i]) ? was : next;
      });
      setCaptionsSupported(typeof player.setCaptionTrack === "function");
      setCaptionTracks((was) => {
        const next = player.getCaptionTracks?.() ?? [];
        return same(was, next) ? was : next;
      });
      setCaption(player.getCaptionTrack?.() ?? null);
      setPipSupported(typeof player.togglePictureInPicture === "function");
      setFullscreenSupported(Boolean(document.fullscreenEnabled) || typeof player.requestNativeFullscreen === "function");
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // Fullscreen is the browser's to own, so the button only reflects it.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The settings panel closes on any press outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current?.contains(target) || target?.closest("[data-settings-toggle]")) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [],
  );

  const wake = useCallback(() => {
    setAwake(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAwake(false), IDLE_HIDE_MS);
  }, []);

  const sleep = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setAwake(false);
  }, []);

  const showFlash = useCallback((kind: Flash["kind"]) => setFlash({ kind, key: Date.now() }), []);

  // Playback starting by itself (the room, not this viewer) is activity too:
  // the controls show, then get out of the way.
  useEffect(() => {
    if (playing) wake();
  }, [playing, wake]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    // iOS Safari only allows the video element itself, which loses the room's
    // controls; everywhere else the whole stage goes, so they come along.
    if (sessionRef.current.player()?.requestNativeFullscreen?.()) return;
    void stageRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const applyVolume = useCallback((next: number) => {
    const level = Math.min(1, Math.max(0, next));
    setVolumeState(level);
    setMutedState(level === 0);
    sessionRef.current.player()?.setVolume(level);
  }, []);

  const toggleMuted = useCallback(() => {
    const player = sessionRef.current.player();
    const next = !(player?.isMuted() ?? muted);
    setMutedState(next);
    player?.setMuted(next);
    // Unmuting at zero would stay silent, so give it something to hear.
    if (!next && (player?.getVolume() ?? 0) === 0) applyVolume(0.5);
  }, [muted, applyVolume]);

  const applyQuality = useCallback((id: string) => {
    setQualityState(id);
    sessionRef.current.player()?.setQuality(id);
  }, []);

  const pickCaption = useCallback((id: string | null) => {
    setCaption(id === "auto" ? "auto" : id);
    sessionRef.current.player()?.setCaptionTrack?.(id);
  }, []);

  const toggleCaptions = useCallback(() => {
    const player = sessionRef.current.player();
    if (!player?.setCaptionTrack) return;
    pickCaption(player.getCaptionTrack?.() ? null : "auto");
  }, [pickCaption]);

  const hold = (target: number) => setHeld({ target, until: Date.now() + SEEK_HOLD_MS });

  function commitSeek(target: number) {
    if (!Number.isFinite(target)) return;
    sessionRef.current.seek(target);
    hold(target);
    setScrubbing(null);
  }

  function toggle() {
    const current = sessionRef.current;
    if (current.diagnostics?.blocked && current.playing) {
      current.resume();
      return;
    }
    if (!current.canControl) {
      current.explainLocked();
      return;
    }
    showFlash(current.playing ? "pause" : "play");
    if (current.playing) current.pause();
    else current.play();
  }

  function skip(deltaMs: number) {
    const current = sessionRef.current;
    if (!current.canControl) {
      current.explainLocked();
      return;
    }
    showFlash(deltaMs < 0 ? "back" : "forward");
    current.skipBy(deltaMs);
    const target = Math.max(0, current.projectedPositionMs() + deltaMs);
    hold(current.durationMs ? Math.min(target, current.durationMs) : target);
  }

  // The keys a video site has, unless the viewer is typing somewhere: Space
  // or K, J and L or the arrows for ten seconds, up and down for volume, M,
  // C for captions, F for fullscreen, Escape to close the settings. The
  // iframe never takes focus, so they work on YouTube too.
  const keys = useRef({ toggle, skip, fullscreen: toggleFullscreen, mute: toggleMuted, captions: toggleCaptions, volume: applyVolume, wake });
  keys.current = { toggle, skip, fullscreen: toggleFullscreen, mute: toggleMuted, captions: toggleCaptions, volume: applyVolume, wake };
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
        return;
      }
      // A focused button (any control, just after a click on it) keeps the
      // shortcuts working; only Space and Enter are its own, to press it.
      if (target?.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      const key = event.key.toLowerCase();
      const act = (run: () => void) => {
        event.preventDefault();
        keys.current.wake();
        run();
      };
      if (key === " " || key === "k") act(() => keys.current.toggle());
      else if (key === "arrowright" || key === "l") act(() => keys.current.skip(SKIP_MS));
      else if (key === "arrowleft" || key === "j") act(() => keys.current.skip(-SKIP_MS));
      else if (key === "arrowup") act(() => keys.current.volume(volumeRef.current + VOLUME_STEP));
      else if (key === "arrowdown") act(() => keys.current.volume(volumeRef.current - VOLUME_STEP));
      else if (key === "f") act(() => keys.current.fullscreen());
      else if (key === "m") act(() => keys.current.mute());
      else if (key === "c") act(() => keys.current.captions());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!room) return null;

  const holding = held !== null && Date.now() < held.until && Math.abs(position - held.target) > 1200;
  const shownPosition = scrubbing ?? (holding && held ? held.target : position);
  const blocked = Boolean(diagnostics?.blocked && playing);
  const youtube = room.platform === "youtube" && Boolean(room.videoRef);
  const hosted = room.platform === "hosted" && Boolean(room.videoUrl);
  const refused = youtube && refusal !== null;
  // Our controls, only over a video that can play: over YouTube's error they
  // would promise what cannot happen, and "Tap to join in" would loop.
  const ours = (youtube || hosted) && !refused;
  const duration = durationMs ?? 0;
  const progress = duration ? Math.min(100, (shownPosition / duration) * 100) : 0;
  const bufferedPercent = Math.max(progress, Math.min(100, buffered * 100));
  // At the end the player would show its own end screen; ours covers it, and
  // the controls stay up with it (the room still counts as playing there).
  const ended = ours && duration > 0 && shownPosition >= duration - 400;
  const controlsShown = awake || !playing || ended || overControls || menuOpen || scrubbing !== null;
  const volumeLevel = muted ? 0 : volume;
  // A phone shows the big play/pause whenever the controls are up; a mouse
  // only when paused, since a click anywhere on the picture does it there.
  // Only for whoever may control the room: anyone else is told why on a press.
  const bigButton = ours && canControl && !blocked && !ended && !session.buffering && (coarse ? controlsShown : !playing);

  /**
   * A press on the picture: see the class comment for what each one does.
   * Handled on click, not on pointer-up: after a finger lifts, the browser
   * sends a click to whatever is under it by then, and controls revealed on
   * pointer-up would be under it and take that click (a tap that shows the
   * controls would also press the big pause button that just appeared).
   */
  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    // A finger that travelled was scrolling the page, not tapping the video.
    const start = pressStart.current;
    pressStart.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    if (pressType.current === "mouse") {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
        toggleFullscreen();
        return;
      }
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        toggle();
      }, CLICK_DELAY_MS);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const side = x < 0.35 ? "back" : x > 0.65 ? "forward" : "center";
    const now = Date.now();
    const previous = lastTap.current;
    if (previous && now - previous.at < DOUBLE_TAP_MS && previous.side === side && side !== "center") {
      lastTap.current = null;
      skip(side === "back" ? -SKIP_MS : SKIP_MS);
      wake();
      return;
    }
    lastTap.current = { at: now, side };
    if (controlsShown && playing) sleep();
    else wake();
  }

  return (
    <section ref={stageRef} className="stage @container relative land:mx-auto land:max-w-[calc((100svh-10rem)*16/9)]">
      <div className="stage-screen relative mx-2.5 overflow-hidden rounded-[18px] border border-white/[0.09] bg-black shadow-[0_28px_60px_-24px_rgb(0_0_0/0.9)] land:mx-0 land:rounded-none land:border-0 lg:mx-0 lg:rounded-[var(--radius-screen)] lg:shadow-[0_40px_100px_-40px_rgb(0_0_0/0.95)]">
        {youtube && room.videoRef ? (
          <YouTubePlayer
            videoId={room.videoRef}
            captions={caption !== null}
            onHandle={session.attachPlayer}
            onEnded={session.reportEnded}
            onBuffering={session.setBuffering}
            onError={setRefusal}
          />
        ) : hosted && room.videoUrl ? (
          <HostedPlayer
            src={room.videoUrl}
            onHandle={session.attachPlayer}
            onBuffering={session.setBuffering}
            onEnded={session.reportEnded}
          />
        ) : room.platform === "vimeo" && room.videoUrl ? (
          <div className="aspect-video w-full bg-black">
            <iframe
              src={room.videoUrl.replace("vimeo.com/", "player.vimeo.com/video/")}
              className="h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
            />
          </div>
        ) : (
          <div className="relative grid aspect-video w-full place-items-center overflow-hidden bg-stage p-5 text-center">
            <div className="halo halo-dim left-1/2 top-1/2 w-[min(62%,30rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden />
            <div className="halo left-1/2 top-1/2 w-[min(40%,19rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden />
            <div className="relative max-w-sm">
              <p className="font-serif text-xl @xl:text-3xl">
                Playing on the <span className="italic">desktop extension</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted @xl:mt-3 @xl:text-sm">
                This service is DRM-protected and has no embeddable player. Chat and the guest list work
                here as usual.
              </p>
            </div>
          </div>
        )}

        {/* Reactions float over the video without ever taking a press from it. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {session.reactions.map((reaction) => (
            <span
              key={reaction.id}
              className="reaction-float absolute bottom-20 flex flex-col items-center"
              style={{ left: `${reaction.x}%` }}
            >
              <span className="text-3xl drop-shadow-[0_4px_12px_rgb(0_0_0/0.6)] @xl:text-4xl">{reaction.emoji}</span>
              <span className="mt-1 max-w-24 truncate rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-cream">
                {reaction.displayName}
              </span>
            </span>
          ))}
        </div>

        {ours ? (
          <>
            {/* The picture itself takes the presses, so neither YouTube's frame
                nor the video element ever does. */}
            <div
              className={`absolute inset-0 select-none ${controlsShown ? "" : "cursor-none"}`}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") wake();
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse" && playing) sleep();
              }}
              onPointerDown={(event) => {
                pressType.current = event.pointerType;
                pressStart.current = { x: event.clientX, y: event.clientY };
              }}
              onClick={onSurfaceClick}
              aria-hidden="true"
            />

            {/* A double tap, a key or a click answers where it happened. */}
            {flash ? (
              <div
                key={flash.key}
                className={`pointer-events-none absolute top-1/2 grid -translate-y-1/2 place-items-center ${
                  flash.kind === "back" ? "left-[12%]" : flash.kind === "forward" ? "right-[12%]" : "left-1/2 -translate-x-1/2"
                }`}
                aria-hidden="true"
              >
                <span className="bezel grid h-16 w-16 place-items-center rounded-full bg-ink/60 text-cream">
                  {flash.kind === "play" ? (
                    <PlayIcon className="ml-1 h-7 w-7" />
                  ) : flash.kind === "pause" ? (
                    <PauseIcon className="h-7 w-7" />
                  ) : (
                    <span className="flex flex-col items-center font-mono text-[11px] font-semibold">
                      <SkipIcon back={flash.kind === "back"} className="h-6 w-6" />
                      10s
                    </span>
                  )}
                </span>
              </div>
            ) : null}

            {session.buffering && !blocked ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label="Buffering">
                <Spinner className="h-10 w-10 text-cream/90" />
              </div>
            ) : null}

            {bigButton ? (
              <button
                type="button"
                onClick={() => toggle()}
                aria-label={playing ? "Pause for everyone" : "Play for everyone"}
                // Opaque, and bigger than YouTube's red play button, which it
                // sits on before the first play (YouTube draws it smaller in a
                // small player).
                className="fade-in absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-ink text-cream shadow-[0_12px_40px_-8px_rgb(0_0_0/0.8)] transition hover:bg-panel-2 active:scale-95 @xl:h-20 @xl:w-20"
              >
                {playing ? <PauseIcon className="h-7 w-7" /> : <PlayIcon className="ml-1 h-7 w-7" />}
              </button>
            ) : null}

            {/* The end: our card over the player's own end screen, and the way
                to start again for whoever holds the remote. */}
            {ended ? (
              <div className="fade-in absolute inset-0 z-[5] grid place-items-center bg-ink/90 p-4 text-center">
                {canControl ? (
                  <button
                    type="button"
                    onClick={() => session.restart()}
                    className="flex items-center gap-2.5 rounded-full bg-cream py-2.5 pl-3 pr-5 text-sm font-semibold text-ink transition hover:bg-white active:scale-95"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M4 12a8 8 0 1 0 2.3-5.6" strokeLinecap="round" />
                      <path d="M4 4.5V8h3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Watch again
                  </button>
                ) : (
                  <p className="font-serif text-xl @xl:text-2xl">
                    That&apos;s the <span className="italic">end</span>.
                  </p>
                )}
              </div>
            ) : null}

            {/* The controls, over a shade at the bottom of the picture. */}
            <div
              className={`absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200 ${
                controlsShown ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setOverControls(true);
              }}
              onPointerLeave={() => setOverControls(false)}
              onPointerDown={wake}
            >
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
              <div className="relative px-2 pb-1 @xl:px-4 @xl:pb-2">
                <div
                  className="group/seek relative"
                  onPointerMove={(event) => {
                    if (event.pointerType !== "mouse" || !duration) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
                    setHoverTime({ ms: ratio * duration, x: ratio * 100 });
                  }}
                  onPointerLeave={() => setHoverTime(null)}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-[5px]">
                    <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferedPercent}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-cream" style={{ width: `${progress}%` }} />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    value={Math.min(shownPosition, duration || 1)}
                    disabled={!canControl || !duration}
                    onChange={(event) => setScrubbing(Number(event.target.value))}
                    // Committed on release, whatever did the dragging: a mouse, a
                    // finger, or the arrow keys on a focused bar. Reading the value
                    // off the element avoids a stale scrubbing state.
                    onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                    onTouchEnd={(event) => commitSeek(Number(event.currentTarget.value))}
                    onKeyUp={(event) => {
                      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
                        commitSeek(Number(event.currentTarget.value));
                      }
                    }}
                    // The bar handles its own arrows; the page shortcut must not jump as well.
                    onKeyDown={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                      if (scrubbing !== null) commitSeek(Number(event.currentTarget.value));
                    }}
                    className="relative block w-full"
                    aria-label="Seek"
                  />
                  {hoverTime ? (
                    <span
                      className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-ink/90 px-1.5 py-0.5 font-mono text-[11px] text-cream"
                      style={{ left: `clamp(1.5rem, ${hoverTime.x}%, calc(100% - 1.5rem))` }}
                    >
                      {formatTime(hoverTime.ms)}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center">
                  <ControlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle}>
                    {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
                  </ControlButton>
                  {/* On a phone a double tap on either side does this. */}
                  <ControlButton label="Back 10 seconds (j)" onClick={() => skip(-SKIP_MS)} className="hidden @md:grid">
                    <SkipIcon back className="h-[22px] w-[22px]" />
                  </ControlButton>
                  <ControlButton label="Forward 10 seconds (l)" onClick={() => skip(SKIP_MS)} className="hidden @md:grid">
                    <SkipIcon className="h-[22px] w-[22px]" />
                  </ControlButton>

                  {/* Volume: the button alone on a phone, where the device's
                      own keys beat a slider; the slider slides out on hover. */}
                  <div className="group/volume flex items-center">
                    <ControlButton label={muted ? "Unmute (m)" : "Mute (m)"} onClick={toggleMuted}>
                      <VolumeIcon level={volumeLevel} className="h-5 w-5" />
                    </ControlButton>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={volumeLevel}
                      onChange={(event) => applyVolume(Number(event.currentTarget.value))}
                      onKeyDown={(event) => event.stopPropagation()}
                      aria-label="Volume"
                      className="hidden w-0 opacity-0 transition-all duration-200 focus:w-20 focus:opacity-100 group-hover/volume:w-20 group-hover/volume:opacity-100 @xl:block"
                      // The global range style leaves the track to the component: a
                      // filled off-white level over a dim rail, 3px tall.
                      style={{
                        background: `linear-gradient(to right, var(--color-cream) ${volumeLevel * 100}%, rgb(255 255 255 / 0.25) ${volumeLevel * 100}%) center / 100% 3px no-repeat`,
                      }}
                    />
                  </div>

                  <span className="ml-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-cream/90 @xl:ml-2 @xl:text-xs">
                    {formatTime(shownPosition)}
                    <span className="text-cream/50"> / {duration ? formatTime(duration) : "--:--"}</span>
                  </span>

                  <span className="flex-1" />

                  {speed !== 1 ? (
                    <span className="mr-1 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10.5px] text-cream/90">{speed}×</span>
                  ) : null}
                  {captionsSupported && (youtube || captionTracks.length > 0) ? (
                    <ControlButton label={caption ? "Captions off (c)" : "Captions (c)"} onClick={toggleCaptions} active={caption !== null}>
                      <CaptionsIcon on={caption !== null} className="h-5 w-5" />
                    </ControlButton>
                  ) : null}
                  <ControlButton
                    label="Settings"
                    onClick={() => setMenuOpen((open) => !open)}
                    active={menuOpen}
                    data-settings-toggle
                  >
                    <SettingsIcon className={`h-5 w-5 transition-transform duration-300 ${menuOpen ? "rotate-45" : ""}`} />
                  </ControlButton>
                  {pipSupported ? (
                    <ControlButton label="Picture in picture" onClick={() => sessionRef.current.player()?.togglePictureInPicture?.()} className="hidden @md:grid">
                      <PipIcon className="h-5 w-5" />
                    </ControlButton>
                  ) : null}
                  {fullscreenSupported ? (
                    <ControlButton label={fullscreen ? "Leave fullscreen (f)" : "Fullscreen (f)"} onClick={toggleFullscreen}>
                      <FullscreenIcon exit={fullscreen} className="h-[19px] w-[19px]" />
                    </ControlButton>
                  ) : null}
                </div>
              </div>
            </div>

            {menuOpen ? (
              <div
                ref={menuRef}
                className="sheet-in absolute bottom-[4.25rem] right-2 z-20 max-h-[calc(100%-5rem)] w-[min(19rem,calc(100%-1rem))] overflow-y-auto rounded-2xl border border-line-strong bg-ink/95 p-3 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)] thin-scrollbar @xl:bottom-[4.75rem] @xl:right-3"
                role="dialog"
                aria-label="Playback settings"
              >
                <MenuSection title="Speed" note={isHost ? "For everyone" : "Set by the host"}>
                  {(rates.length > 0 ? rates : [1]).map((rate) => (
                    <Chip key={rate} selected={Math.abs(rate - speed) < 0.001} disabled={!isHost} onClick={() => session.setSpeed(rate)}>
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </Chip>
                  ))}
                </MenuSection>
                {qualities.length > 1 ? (
                  <MenuSection title="Quality" note="Just you">
                    {qualities.map((level) => (
                      <Chip key={level.id} selected={level.id === quality} onClick={() => applyQuality(level.id)}>
                        {level.label}
                      </Chip>
                    ))}
                  </MenuSection>
                ) : youtube ? (
                  <MenuSection title="Quality" note="Just you">
                    <p className="text-xs text-muted">Auto: YouTube picks the best for your connection.</p>
                  </MenuSection>
                ) : null}
                {captionsSupported && (youtube || captionTracks.length > 0) ? (
                  <MenuSection title="Captions" note="Just you">
                    <Chip selected={caption === null} onClick={() => pickCaption(null)}>
                      Off
                    </Chip>
                    {captionTracks.length > 0 ? (
                      captionTracks.map((track) => (
                        <Chip key={track.id} selected={caption === track.id} onClick={() => pickCaption(track.id)}>
                          {track.label}
                        </Chip>
                      ))
                    ) : (
                      <Chip selected={caption !== null} onClick={() => pickCaption("auto")}>
                        On
                      </Chip>
                    )}
                  </MenuSection>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {refused && room.videoRef ? (
          <div className="fade-in absolute inset-0 z-30 grid place-items-center bg-ink/95 p-4 text-center" role="alert">
            <div className="max-w-xs @xl:max-w-sm">
              <p className="font-serif text-lg leading-snug @xl:text-2xl">
                YouTube won&apos;t play this <span className="italic">here</span>
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted @xl:text-sm">{refusalText(refusal)}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <a
                  href={`https://www.youtube.com/watch?v=${room.videoRef}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center rounded-full bg-cream px-4 text-[13px] font-semibold text-ink transition hover:bg-white"
                >
                  Watch on YouTube
                </a>
                {isHost && room.queue.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void session.skip()}
                    className="inline-flex h-10 items-center rounded-full border border-line-strong bg-panel-2 px-4 text-[13px] font-semibold text-cream transition hover:bg-panel-3"
                  >
                    Skip to next
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {blocked && !refused ? (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-ink/60 p-4">
            <button
              type="button"
              onClick={() => session.resume()}
              className="pointer-events-auto flex items-center gap-3 rounded-full bg-cream py-2.5 pl-2.5 pr-5 text-sm font-semibold text-ink shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)] transition hover:bg-white active:scale-95"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/10">
                <PlayIcon className="ml-0.5 h-4 w-4" />
              </span>
              Tap to join in
            </button>
          </div>
        ) : null}

        {/* Why a guest's press did nothing. At the top, clear of the controls. */}
        {session.hint ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3" role="status">
            <span className="fade-in flex items-center gap-2 rounded-full border border-white/10 bg-ink/85 px-3.5 py-1.5 text-xs text-cream">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-gold" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
              {session.hint}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Why YouTube refused, from its IFrame API error code, in the viewer's words. */
function refusalText(code: number | null): string {
  switch (code) {
    case 2:
      return "The link to this video isn't valid.";
    case 5:
      return "This browser couldn't play it.";
    case 100:
      return "It was removed or made private.";
    case 101:
    case 150:
      return "Its owner doesn't allow it to be played on other sites.";
    case 152:
    case 153:
      return "YouTube didn't accept this page. Open the site from its web address rather than an IP address.";
    default:
      return "YouTube refused to play it on this site.";
  }
}

function ControlButton({
  label,
  onClick,
  active = false,
  className = "",
  children,
  ...rest
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  children: ReactNode;
  "data-settings-toggle"?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-90 @xl:h-10 @xl:w-10 ${
        active ? "text-gold" : "text-cream/90 hover:text-white"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function MenuSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="py-1.5 [&+&]:border-t [&+&]:border-line [&+&]:pt-3">
      <p className="mb-2 flex items-baseline justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold">
        {title}
        {note ? <span className="text-[10px] font-medium normal-case tracking-normal text-faint">{note}</span> : null}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  selected,
  disabled = false,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`min-h-9 rounded-full border px-3 text-[12.5px] font-medium transition disabled:cursor-not-allowed ${
        selected
          ? "border-cream bg-cream text-ink"
          : "border-line-strong text-cream/90 hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden>
      <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
    </svg>
  );
}

function PauseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden>
      <rect x="6.5" y="5" width="3.8" height="14" rx="1.2" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1.2" />
    </svg>
  );
}

function SkipIcon({ back = false, className = "" }: { back?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${back ? "" : "-scale-x-100"} ${className}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M5 12a7 7 0 1 0 2.1-5" strokeLinecap="round" />
      <path d="M5 4.5V8h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 10v5M13.5 10h1.5a.8.8 0 0 1 .8.8v3.4a.8.8 0 0 1-.8.8h-1.5a.8.8 0 0 1-.8-.8v-3.4a.8.8 0 0 1 .8-.8Z" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  );
}

function VolumeIcon({ level, className = "" }: { level: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" strokeLinejoin="round" />
      {level === 0 ? (
        <path d="m16 9.5 4 5m0-5-4 5" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.5 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
          <path d="M18 7a7.5 7.5 0 0 1 0 10" strokeLinecap="round" className={level > 0.5 ? "" : "opacity-30"} />
        </>
      )}
    </svg>
  );
}

function CaptionsIcon({ on, className = "" }: { on: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.18 : 0} />
      <path d="M10.2 10.3a2 2 0 1 0 0 3.4M16.2 10.3a2 2 0 1 0 0 3.4" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PipIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="12" y="11.5" width="6.5" height="5" rx="1" className="fill-current" stroke="none" />
    </svg>
  );
}

function FullscreenIcon({ exit, className = "" }: { exit: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {exit ? (
        <path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
