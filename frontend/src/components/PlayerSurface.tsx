"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HostedPlayer from "@/components/players/HostedPlayer";
import YouTubePlayer from "@/components/players/YouTubePlayer";
import { Spinner, formatTime } from "@/components/ui";
import type { RoomSession } from "@/hooks/useRoom";
import type { QualityLevel } from "@/lib/player";

/** How far the ±10 s buttons and the arrow keys jump. */
const SKIP_MS = 10_000;
/** How long the bar holds a committed seek before trusting the projection again. */
const SEEK_HOLD_MS = 1500;

/**
 * The stage: the player, lit from behind by its own artwork, with the room's
 * transport underneath. The scrub bar reads the same projection as the sync
 * engine, so the bar and the picture never disagree about where the room is.
 */
export default function PlayerSurface({ session }: { session: RoomSession }) {
  const { room, canControl, playing, durationMs, diagnostics } = session;
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
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);

  // The session object is rebuilt on every render, so the ticker and the
  // keyboard handler read it through a ref instead of restarting.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const timer = setInterval(() => {
      const current = sessionRef.current;
      setPosition(current.projectedPositionMs());
      // Volume, mute and the quality ladder all come from the player itself,
      // and a new player (or an HLS manifest) arrives after the first render.
      const player = current.player();
      if (!player) return;
      setVolumeState((was) => (Math.abs(was - player.getVolume()) < 0.01 ? was : player.getVolume()));
      setMutedState((was) => (was === player.isMuted() ? was : player.isMuted()));
      setQualityState((was) => (was === player.getQuality() ? was : player.getQuality()));
      setQualities((was) => {
        const next = player.getQualities();
        return was.length === next.length && was.every((level, i) => level.id === next[i].id) ? was : next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // Fullscreen is the browser's to own, so the button only reflects it.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
    setVolumeState(next);
    setMutedState(next === 0);
    sessionRef.current.player()?.setVolume(next);
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
    if (!current.canControl) return;
    if (current.playing) current.pause();
    else current.play();
  }

  function skip(deltaMs: number) {
    const current = sessionRef.current;
    if (!current.canControl) return;
    current.skipBy(deltaMs);
    const target = Math.max(0, current.projectedPositionMs() + deltaMs);
    hold(current.durationMs ? Math.min(target, current.durationMs) : target);
  }

  // Space or K plays and pauses, the arrows jump ten seconds, unless the
  // viewer is typing somewhere.
  const keys = useRef({ toggle, skip, fullscreen: toggleFullscreen, mute: toggleMuted });
  keys.current = { toggle, skip, fullscreen: toggleFullscreen, mute: toggleMuted };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        keys.current.toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        keys.current.skip(SKIP_MS);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        keys.current.skip(-SKIP_MS);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        keys.current.fullscreen();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        keys.current.mute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!room) return null;

  const holding = held !== null && Date.now() < held.until && Math.abs(position - held.target) > 1200;
  const shown = scrubbing ?? (holding && held ? held.target : position);
  const blocked = Boolean(diagnostics?.blocked && playing);
  const embedded = Boolean(
    (room.platform === "youtube" && room.videoRef) || (room.platform === "hosted" && room.videoUrl),
  );
  const duration = durationMs ?? 0;
  const progress = duration ? Math.min(100, (shown / duration) * 100) : 0;
  const drifting = diagnostics ? Math.abs(diagnostics.driftMs) > 250 : false;

  const status =
    session.connection === "connected"
      ? { label: drifting ? "Catching up" : "In sync", dot: drifting ? "bg-cobalt" : "bg-sage" }
      : session.connection === "connecting"
        ? { label: "Connecting", dot: "bg-cobalt" }
        : { label: "Reconnecting", dot: "bg-ember" };

  return (
    <section ref={stageRef} className="stage @container relative land:mx-auto land:max-w-[calc((100svh-10rem)*16/9)]">
      {/* Ambilight: the artwork, blurred and spilled behind the screen. Only on
          a wide screen: a phone's player is edge to edge with nothing to spill onto,
          and a big blur is the most expensive thing a phone could paint here. */}
      {room.videoThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={room.videoThumbnail}
          alt=""
          aria-hidden
          loading="lazy"
          className="pointer-events-none absolute -inset-x-8 -top-10 -z-10 hidden h-[calc(100%+4rem)] w-[calc(100%+4rem)] object-cover opacity-30 blur-[70px] saturate-150 lg:block"
        />
      ) : null}

      <div className="stage-screen relative overflow-hidden bg-black lg:rounded-[var(--radius-screen)] lg:border lg:border-white/10 lg:shadow-[0_0_0_1px_rgb(59_91_255/0.12),0_0_60px_-20px_rgb(59_91_255/0.4),0_40px_100px_-30px_rgb(0_0_0/0.95)]">
        {room.platform === "youtube" && room.videoRef ? (
          <YouTubePlayer
            videoId={room.videoRef}
            onHandle={session.attachPlayer}
            onEnded={session.reportEnded}
            onBuffering={session.setBuffering}
          />
        ) : room.platform === "hosted" && room.videoUrl ? (
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
          <div className="relative grid aspect-video w-full place-items-center overflow-hidden p-5 text-center">
            <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_40%,rgb(59_91_255/0.16),transparent_70%)]" />
            <div className="halo halo-dim left-1/2 top-1/2 w-[min(46%,22rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden />
            <div className="relative max-w-sm">
              <p className="text-lg font-semibold tracking-tight @xl:text-2xl">
                Playing on the <span className="font-serif font-normal italic text-cobalt-soft">desktop extension</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted @xl:mt-3 @xl:text-sm">
                This service is DRM-protected and has no embeddable player. Chat and the guest list work
                here as usual.
              </p>
            </div>
          </div>
        )}

        {/* The player's own click-to-pause would pause only this screen, so a
            click on the picture is caught here and goes to the whole room. */}
        {embedded ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause for everyone" : "Play for everyone"}
            className={`absolute inset-0 h-full w-full ${canControl || blocked ? "cursor-pointer" : "cursor-default"}`}
          />
        ) : null}

        {session.buffering && !blocked ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2.5 rounded-full bg-ink/80 px-4 py-2 text-xs text-cream">
              <Spinner className="h-4 w-4 text-cobalt" />
              Buffering
            </span>
          </div>
        ) : null}

        {blocked ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/60 p-4">
            <button
              type="button"
              onClick={() => session.resume()}
              className="pointer-events-auto flex items-center gap-3 rounded-full bg-cobalt py-2.5 pl-2.5 pr-5 text-sm font-semibold text-white shadow-[0_12px_40px_-8px_rgb(59_91_255/0.8)] transition hover:bg-cobalt-bright active:scale-95"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15">
                <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current" aria-hidden>
                  <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
                </svg>
              </span>
              Tap to join in
            </button>
          </div>
        ) : null}

        {/* Reactions float over the video without ever taking a click from it. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {session.reactions.map((reaction) => (
            <span
              key={reaction.id}
              className="reaction-float absolute bottom-6 flex flex-col items-center"
              style={{ left: `${reaction.x}%` }}
            >
              <span className="text-3xl drop-shadow-[0_4px_12px_rgb(0_0_0/0.6)] @xl:text-4xl">{reaction.emoji}</span>
              <span className="mt-1 max-w-24 truncate rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-cream">
                {reaction.displayName}
              </span>
            </span>
          ))}
        </div>

      </div>

      {/* Transport. Inside the stage element, so fullscreen keeps the room's
          own controls rather than handing the viewer the bare player. It lays
          itself out by the stage's width (a container query), not the
          viewport's: a phone on its side is wide, but its player is not. */}
      <div className="stage-transport border-b border-line bg-ink px-3 pb-2 pt-1 @xl:px-4 lg:mt-3 lg:rounded-2xl lg:border lg:bg-panel lg:py-3">
        <div className="flex flex-wrap items-center gap-x-2 @xl:flex-nowrap @xl:gap-x-4">
          {/* Row one on a phone: time, bar, length. Inline from sm up. */}
          <div className="order-1 flex w-full items-center gap-3 @xl:order-2 @xl:w-auto @xl:flex-1">
            <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-cream/80 @xl:w-12 @xl:text-right @xl:text-xs">
              {formatTime(shown)}
            </span>

            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-cream/10 @xl:h-1.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cobalt-deep via-cobalt to-cobalt-soft transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 1}
                value={Math.min(shown, duration || 1)}
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
            </div>

            <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint @xl:w-12 @xl:text-left @xl:text-xs">
              {duration ? formatTime(duration) : "--:--"}
            </span>
          </div>

          {/* Row two on a phone: play, where the room is, and this screen's own controls. */}
          <div className="order-2 flex items-center gap-1 @xl:order-1 @xl:gap-3">
            <SkipButton label="Back 10 seconds" disabled={!canControl} onClick={() => skip(-SKIP_MS)} back />
            <button
              type="button"
              disabled={!canControl && !blocked}
              onClick={toggle}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cobalt text-white shadow-[0_8px_26px_-10px_rgb(59_91_255/0.8)] transition hover:bg-cobalt-bright active:scale-95 disabled:bg-panel-3 disabled:text-faint disabled:shadow-none @xl:h-12 @xl:w-12"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <rect x="6.5" y="5" width="3.8" height="14" rx="1.2" />
                  <rect x="13.7" y="5" width="3.8" height="14" rx="1.2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-current">
                  <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
                </svg>
              )}
            </button>
            <SkipButton label="Forward 10 seconds" disabled={!canControl} onClick={() => skip(SKIP_MS)} />
          </div>

          <p className="order-3 flex min-w-0 flex-1 items-center gap-1.5 truncate pl-1.5 text-[11.5px] text-muted @xl:hidden">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden />
            <span className="truncate">{canControl ? status.label : `${status.label} · host has the remote`}</span>
          </p>

          <div className="order-4 ml-auto flex shrink-0 items-center gap-0.5 @xl:order-3 @xl:ml-1">
            {/* Volume: the button alone on a phone, where the slider is a
                worse target than the device's own keys. */}
            <button
              type="button"
              onClick={toggleMuted}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute (M)" : "Mute (M)"}
              className="grid h-10 w-10 place-items-center rounded-full text-cream/80 transition hover:bg-white/[0.06] hover:text-cream active:scale-90 @xl:h-9 @xl:w-9"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                <path d="M11 5 6.5 9H3v6h3.5L11 19z" strokeLinejoin="round" />
                {muted ? (
                  <path d="m16 9.5 4 5m0-5-4 5" strokeLinecap="round" />
                ) : (
                  <>
                    <path d="M15.5 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
                    <path d="M18 7a7.5 7.5 0 0 1 0 10" strokeLinecap="round" className={volume > 0.5 ? "" : "opacity-30"} />
                  </>
                )}
              </svg>
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(event) => applyVolume(Number(event.currentTarget.value))}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label="Volume"
              className="hidden w-20 @xl:block"
              // The global range style leaves the track to the component: a
              // filled cobalt level over a dim rail, 4px tall.
              style={{
                background: `linear-gradient(to right, var(--color-cobalt) ${(muted ? 0 : volume) * 100}%, var(--color-panel-3) ${(muted ? 0 : volume) * 100}%) center / 100% 4px no-repeat`,
              }}
            />

            {/* Only where the player actually has a ladder to choose from. */}
            {qualities.length > 1 ? (
              <QualityMenu levels={qualities} current={quality} onPick={applyQuality} />
            ) : null}

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Leave fullscreen" : "Fullscreen"}
              title={fullscreen ? "Leave fullscreen (F)" : "Fullscreen (F)"}
              className="grid h-10 w-10 place-items-center rounded-full text-cream/80 transition hover:bg-white/[0.06] hover:text-cream active:scale-90 @xl:h-9 @xl:w-9"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                {fullscreen ? (
                  <path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-2.5 hidden flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10.5px] text-faint @xl:flex">
          <span className="flex items-center gap-1.5 text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          {!canControl ? (
            <span className="flex items-center gap-1.5 text-cobalt-soft">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
              Host controls playback
            </span>
          ) : null}
          {diagnostics ? (
            <>
              <span className={drifting ? "text-cobalt" : undefined}>
                drift {diagnostics.driftMs > 0 ? "+" : ""}
                {diagnostics.driftMs}ms
              </span>
              <span>rtt {diagnostics.rttMs}ms</span>
              {diagnostics.correcting !== "none" ? (
                <span className="text-cobalt-soft">{diagnostics.correcting === "rate" ? "nudging" : "seeking"}</span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SkipButton({
  label,
  onClick,
  disabled,
  back = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  back?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="relative hidden h-9 w-9 shrink-0 place-items-center rounded-full text-cream/80 transition hover:bg-white/[0.06] hover:text-cream active:scale-90 disabled:opacity-30 @xl:grid"
    >
      <svg viewBox="0 0 24 24" className={`h-7 w-7 ${back ? "" : "-scale-x-100"}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
        <path d="M5 12a7 7 0 1 0 2.1-5" strokeLinecap="round" />
        <path d="M5 4.5V8h3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="absolute font-mono text-[8.5px] font-semibold">10</span>
    </button>
  );
}

/** The rendition picker. Shown only when the player reports more than one. */
function QualityMenu({
  levels,
  current,
  onPick,
}: {
  levels: QualityLevel[];
  current: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const label = levels.find((level) => level.id === current)?.label ?? "Auto";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Video quality"
        aria-expanded={open}
        title="Video quality"
        className={`h-10 rounded-full px-2.5 font-mono text-[11px] transition hover:bg-white/[0.06] @xl:h-9 ${
          open ? "bg-white/[0.08] text-cream" : "text-cream/80"
        }`}
      >
        {label}
      </button>
      {open ? (
        <div className="sheet-in absolute bottom-11 right-0 z-30 w-32 rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)]">
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => {
                onPick(level.id);
                setOpen(false);
              }}
              className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.05] ${
                level.id === current ? "text-cobalt" : "text-cream/90"
              }`}
            >
              {level.label}
              {level.id === current ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                  <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
