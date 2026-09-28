"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { preconnect } from "react-dom";
import { Button, IconButton, LiveDot, Spinner } from "@/components/ui";
import { useStartParty } from "@/components/home/useStartParty";
import { api } from "@/lib/api";
import type { CatalogItem } from "@/lib/types";
import { loadYouTubeApi } from "@/lib/youtube";

const TRAILER = /\b(trailer|teaser)\b/i;
/** Trailers open on ratings cards and studio logos; start on the picture. */
const START_AT_S = 4;
/** The page paints first; the backdrop's player is fetched a beat later. */
const START_DELAY_MS = 900;
const PLAYLIST_SIZE = 12;
/**
 * YouTube draws its own title bar and buttons over the first seconds of
 * playback, controls off or not. The still stays up until they have gone:
 * the title bar by ~3 s, the centre pause button (desktop and phone embeds
 * alike) ~4.7 s after start.
 */
const YOUTUBE_CHROME_MS = 5200;
/** How often the player is checked for having stopped when it should play. */
const WATCH_EVERY_MS = 2000;
/** How often the progress hairline is moved on; it glides between updates. */
const PROGRESS_EVERY_MS = 1000;
/** Checks it may spend stopped, being asked to play, before a tap is offered. */
const BLOCKED_AFTER_CHECKS = 3;

/**
 * The home screen's trailer is our own player: YouTube's embed is only the
 * picture (chromeless, never clickable), and everything around it is drawn
 * here. The still covers the embed whenever it is not actually playing, so
 * YouTube's own paused screen, title bar and "More videos" are never seen.
 */
interface Hero {
  item: CatalogItem | null;
  /** Counts every change of trailer, so a one-trailer playlist still replays. */
  turn: number;
  /** lg and up. Followed live, so a tablet turned sideways gets the wide look. */
  wide: boolean;
  /** Motion allowed and not saving data: the trailer plays by itself. */
  motion: boolean;
  /** There is (or is about to be) a player: by itself, or because the viewer asked. */
  wantsPlayer: boolean;
  /** The trailer is actually playing right now. */
  showing: boolean;
  setShowing: (showing: boolean) => void;
  /** Playing, and past YouTube's opening overlay: the trailer may be seen. */
  revealed: boolean;
  /**
   * It should be playing but will not start by itself: the browser or the
   * device blocks autoplay (an iPhone in Low Power Mode, a strict setting).
   * Only a tap can start it, so the play control asks for one.
   */
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
  /** The viewer paused it; nothing restarts it until they press play. */
  userPausedRef: MutableRefObject<boolean>;
  muted: boolean;
  /**
   * How far into the trailer (0–1), and the hairline that shows it. Written
   * straight to the element, never through state: a re-render every second
   * of the hero is main-thread time taken from YouTube's player, which on a
   * phone runs on the same thread.
   */
  progressRef: MutableRefObject<number>;
  progressBarRef: MutableRefObject<HTMLDivElement | null>;
  next: () => void;
  togglePlay: () => void;
  toggleSound: () => void;
  playerRef: MutableRefObject<YT.Player | null>;
}

const HeroContext = createContext<Hero | null>(null);

function useHero(): Hero {
  const hero = useContext(HeroContext);
  if (!hero) throw new Error("useHero outside HeroProvider");
  return hero;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The home screen's backdrop: one of the month's most-watched film trailers,
 * playing muted behind the top of the page, a different one each visit.
 * The provider holds the playlist and the player's state, so the backdrop and
 * the "Now showing" controls agree on what is on.
 */
export function HeroProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [index, setIndex] = useState(0);
  const [wide, setWide] = useState(false);
  const [motion, setMotion] = useState(false);
  const [started, setStarted] = useState(false);
  const [showing, setShowing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(true);
  const progressRef = useRef(0);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const userPausedRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onWidth = () => setWide(query.matches);
    onWidth();
    query.addEventListener("change", onWidth);
    // A playing trailer costs data and battery: someone who asked for less
    // motion or less data gets the still, and can still press play.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    setMotion(!calm && !saveData);
    // The trailer will play by itself: open the connections its player needs
    // (the API script and the embed) while the page is still settling.
    if (!calm && !saveData) {
      preconnect("https://www.youtube.com");
      preconnect("https://www.youtube-nocookie.com");
    }

    let cancelled = false;
    api
      .youtubeTrailers()
      .then((page) => {
        if (cancelled) return;
        const playable = page.items.filter((item) => item.ref && !item.live);
        const trailers = playable.filter((item) => TRAILER.test(item.title));
        setItems(shuffled(trailers.length >= 3 ? trailers : playable).slice(0, PLAYLIST_SIZE));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      query.removeEventListener("change", onWidth);
    };
  }, []);

  // Shown a moment after it starts playing (YouTube's overlay), hidden the
  // moment it stops, whatever stopped it.
  useEffect(() => {
    if (!showing) {
      setRevealed(false);
      return;
    }
    const timer = setTimeout(() => setRevealed(true), YOUTUBE_CHROME_MS);
    return () => clearTimeout(timer);
  }, [showing]);

  const next = useCallback(() => {
    // Asking for the next one is asking for it to play.
    userPausedRef.current = false;
    setShowing(false);
    progressRef.current = 0;
    setIndex((current) => current + 1);
  }, []);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player?.playVideo) {
      // No player yet (reduced motion, Save-Data, or still loading): the
      // viewer asked for the trailer, so make one now.
      userPausedRef.current = false;
      setStarted(true);
      return;
    }
    if (player.getPlayerState?.() === YT.PlayerState.PLAYING) {
      userPausedRef.current = true;
      player.pauseVideo();
    } else {
      // Inside the tap, which is the one thing an autoplay block accepts.
      userPausedRef.current = false;
      setBlocked(false);
      player.playVideo();
    }
  }, []);

  const toggleSound = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isMuted()) {
      player.unMute();
      player.setVolume(70);
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }, []);

  const item = items.length > 0 ? items[index % items.length] : null;
  const wantsPlayer = motion || started;

  const value = useMemo<Hero>(
    () => ({
      item,
      turn: index,
      wide,
      motion,
      wantsPlayer,
      showing,
      setShowing,
      revealed,
      blocked,
      setBlocked,
      userPausedRef,
      muted,
      progressRef,
      progressBarRef,
      next,
      togglePlay,
      toggleSound,
      playerRef,
    }),
    [item, index, wide, motion, wantsPlayer, showing, revealed, blocked, muted, next, togglePlay, toggleSound],
  );

  return <HeroContext.Provider value={value}>{children}</HeroContext.Provider>;
}

/**
 * The picture itself, behind the hero: the trailer's still at once, and the
 * trailer fading in over it only while it is actually playing and past
 * YouTube's opening overlay. It pauses when the tab is hidden or the hero is
 * scrolled away, asks again if something else stopped it, and says so
 * (Hero.blocked) when it will not start without a tap.
 */
export function HeroBackdrop() {
  const {
    item,
    turn,
    wide,
    motion,
    wantsPlayer,
    showing,
    setShowing,
    revealed,
    setBlocked,
    userPausedRef,
    progressRef,
    progressBarRef,
    next,
    playerRef,
  } = useHero();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  // Errors in a row. A few mean the trouble is not the video (the network,
  // an extension blocking YouTube): stop trying and keep the still.
  const failuresRef = useRef(0);
  const ref = item?.ref ?? null;

  // The widest still YouTube has on a wide screen; on a phone hqdefault is
  // plenty at a fraction of the bytes.
  useEffect(() => {
    setPoster(ref ? `https://i.ytimg.com/vi/${ref}/${wide ? "maxresdefault" : "hqdefault"}.jpg` : null);
  }, [ref, wide]);

  // The player, made once, for the first trailer: a beat after the page
  // paints, or at once when the viewer pressed play.
  const created = useRef(false);
  useEffect(() => {
    if (!wantsPlayer || !ref || created.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadYouTubeApi().then((YTApi) => {
        if (cancelled || !hostRef.current || created.current) return;
        created.current = true;
        const target = document.createElement("div");
        hostRef.current.appendChild(target);
        playerRef.current = new YTApi.Player(target, {
          host: "https://www.youtube-nocookie.com",
          videoId: ref,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            rel: 0,
            // Without it an iPhone opens the trailer fullscreen.
            playsinline: 1,
            start: START_AT_S,
          },
          events: {
            onReady: (event) => {
              // Muted is what lets it start without a tap, phones included.
              event.target.mute();
              if (!userPausedRef.current) event.target.playVideo();
            },
            onStateChange: (event) => {
              const state = event.data;
              if (state === YTApi.PlayerState.PLAYING) {
                failuresRef.current = 0;
                setBlocked(false);
                setShowing(true);
              } else if (state === YTApi.PlayerState.ENDED) {
                nextRef.current();
              } else if (state !== YTApi.PlayerState.BUFFERING) {
                // Paused, cued or not started: whoever did it, the still
                // covers YouTube's own paused screen. Buffering is only a
                // pause in the picture, so it changes nothing.
                setShowing(false);
              }
            },
            // Removed, private or not embeddable after all: on to the next one.
            onError: () => {
              failuresRef.current += 1;
              if (failuresRef.current >= 3) {
                setShowing(false);
                playerRef.current?.destroy();
                playerRef.current = null;
                return;
              }
              nextRef.current();
            },
          },
        });
      });
    }, motion ? START_DELAY_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wantsPlayer, motion, ref, playerRef, setShowing, setBlocked, userPausedRef]);

  // Later trailers load into the same player.
  const loadedTurn = useRef(turn);
  useEffect(() => {
    const player = playerRef.current;
    if (loadedTurn.current === turn) return;
    loadedTurn.current = turn;
    if (ref && player && created.current) player.loadVideoById?.({ videoId: ref, startSeconds: START_AT_S });
  }, [turn, ref, playerRef]);

  // How far into the trailer, for the progress hairline: once a second,
  // written to the element, which glides to it on the compositor (a
  // transform, never a width, which would lay the page out every frame).
  useEffect(() => {
    if (!showing) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      const duration = player?.getDuration?.() ?? 0;
      if (!player || duration <= 0) return;
      progressRef.current = Math.min(1, (player.getCurrentTime?.() ?? 0) / duration);
      if (progressBarRef.current) progressBarRef.current.style.transform = `scaleX(${progressRef.current})`;
    }, PROGRESS_EVERY_MS);
    return () => clearInterval(timer);
  }, [showing, playerRef, progressRef, progressBarRef]);

  // Plays only while someone can see it: paused in a hidden tab or with the
  // hero scrolled away. And kept playing otherwise: a browser can pause a
  // muted trailer on its own (power saving, a tab coming back), so a stopped
  // player is asked again, and one that will not start is reported blocked,
  // which offers a tap. The box exists once there is an item.
  const hasItem = ref !== null;
  useEffect(() => {
    if (!wantsPlayer || !hasItem) return;
    let onScreen = true;
    let stoppedChecks = 0;
    const wanted = () => onScreen && !document.hidden && !userPausedRef.current;
    const apply = () => {
      const player = playerRef.current;
      if (!player?.playVideo) return;
      if (wanted()) player.playVideo();
      else if (!onScreen || document.hidden) player.pauseVideo();
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      stoppedChecks = 0;
      apply();
    });
    if (boxRef.current) observer.observe(boxRef.current);
    const onVisibility = () => {
      stoppedChecks = 0;
      apply();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const watch = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getPlayerState) return;
      const state = player.getPlayerState();
      if (!wanted() || state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
        stoppedChecks = 0;
        return;
      }
      stoppedChecks += 1;
      if (stoppedChecks < BLOCKED_AFTER_CHECKS) player.playVideo();
      else setBlocked(true);
    }, WATCH_EVERY_MS);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(watch);
    };
  }, [wantsPlayer, hasItem, playerRef, userPausedRef, setBlocked]);

  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    [playerRef],
  );

  if (!item) return null;
  // YouTube's standard thumbnails are 4:3 with the picture letterboxed inside.
  const letterboxed = poster !== null && /ytimg\.com\/vi\/[^/]+\/(hqdefault|sddefault|0|default)\.jpg/.test(poster);

  // Everything over the playing video is redrawn with it every frame, so it
  // is kept to plain gradients: no mask (that renders the whole backdrop
  // off-screen first, every frame) and no separate veil (the picture's own
  // opacity is the veil: 81% is 90% under a tenth of ink).
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={poster}
          src={poster}
          alt=""
          onError={() => setPoster(item.thumbnail && poster !== item.thumbnail ? item.thumbnail : null)}
          // Gone once the trailer has faded in over it: seen through the
          // picture it would double every frame. Back at once when it stops.
          className={`fade-in absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            revealed ? "opacity-0 delay-700" : "opacity-[0.72]"
          } ${letterboxed ? "scale-[1.34]" : ""}`}
        />
      ) : null}
      {/* Sized in globals.css (.trailer-frame): covering the box whatever its
          shape, zoomed past YouTube's corners only where the crop does not
          already hide them. */}
      <div
        ref={hostRef}
        className={`trailer-frame absolute inset-0 transition-opacity duration-700 ${revealed ? "opacity-[0.81]" : "opacity-0"}`}
      />
      {/* Only as much dark as the words on top need: the top under the header
          and greeting, the bottom where it fades into the page, on a wide
          screen the left, where the greeting sits over the picture, and the
          two sides, which fade into the page so a trailer that is not 16:9
          (YouTube's black bars) leaves no seam. */}
      <div className="absolute inset-0 hidden bg-gradient-to-r from-ink/75 via-ink/20 via-45% to-transparent lg:block" />
      <div className="absolute inset-y-0 left-0 w-[9%] bg-gradient-to-r from-ink to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[9%] bg-gradient-to-l from-ink to-transparent" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/85 to-transparent lg:from-ink/70" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink via-ink/50 to-transparent" />
    </div>
  );
}

const PLAY_MARK = (
  <svg viewBox="0 0 24 24" className="ml-0.5 h-3 w-3 fill-current" aria-hidden>
    <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
  </svg>
);

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <rect x="6.5" y="5" width="3.8" height="14" rx="1.2" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current" aria-hidden>
      <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" strokeLinejoin="round" />
      {muted ? (
        <path d="m16 9.5 4 5m0-5-4 5" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.5 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
          <path d="M18 7a7.5 7.5 0 0 1 0 10" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** A round control drawn at 34px and tapped at 44. `invite` rings it in gold: it wants a tap. */
function RoundControl({
  label,
  onClick,
  active = false,
  invite = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  invite?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95"
    >
      <span
        className={`grid h-[34px] w-[34px] place-items-center rounded-full ${
          invite
            ? "animate-pulse-dot border border-gold/70 text-gold"
            : active
              ? "glass-raised bg-gold/15 text-gold"
              : "glass-raised text-cream"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

/**
 * The trailer's controls, and one tap to watch it with friends: play/pause,
 * sound and next, over a progress hairline. Pausing is also what anyone who
 * would rather not have moving pictures on the page needs.
 */
export function NowShowing() {
  const { item, wantsPlayer, showing, revealed, blocked, muted, progressRef, progressBarRef, next, togglePlay, toggleSound } =
    useHero();
  const { start, busyRef } = useStartParty();
  if (!item) return null;
  const busy = busyRef !== null && busyRef === (item.ref ?? item.url);
  const watchTogether = () => void start(item).catch(() => undefined);
  const mark = busy ? <Spinner className="h-4 w-4" /> : PLAY_MARK;
  const sound = muted ? "Turn the sound on" : "Mute";
  const playLabel = showing ? "Pause the trailer" : "Play the trailer";

  return (
    <aside
      aria-label="Now showing"
      className="glass fade-in relative overflow-hidden rounded-2xl lg:w-[21.5rem] lg:shrink-0"
    >
      {/* Below lg: one line, the trailer's controls and the way in, at one
          fixed height, which the hero reserves. */}
      <div className="flex items-center gap-0.5 p-[7px] pl-3.5 sm:pl-4 lg:hidden">
        <div className="over-picture min-w-0 flex-1 pr-1">
          <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-gold sm:text-[10px]">
            {revealed ? <LiveDot /> : null}
            Now showing
          </p>
          <p className="mt-0.5 truncate text-[12px] font-medium">{item.title}</p>
        </div>
        <RoundControl label={playLabel} onClick={togglePlay} invite={blocked}>
          <PlayPauseIcon playing={showing} />
        </RoundControl>
        {wantsPlayer ? (
          <RoundControl label={sound} onClick={toggleSound} active={!muted}>
            <SoundIcon muted={muted} />
          </RoundControl>
        ) : null}
        <button
          type="button"
          onClick={watchTogether}
          disabled={busy}
          aria-label="Watch together"
          title="Watch together"
          className="ml-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream text-ink transition hover:bg-white active:scale-95 disabled:opacity-40"
        >
          {mark}
        </button>
      </div>

      {/* A wide screen: the whole card. */}
      <div className="over-picture hidden p-5 lg:block">
        <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
          {revealed ? <LiveDot /> : null}
          Now showing · Trending
        </p>
        <p className="mt-2.5 line-clamp-2 font-serif text-[22px] leading-snug">{item.title}</p>
        {item.author ? <p className="mt-1 truncate text-xs text-muted">{item.author}</p> : null}
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={watchTogether} disabled={busy} className="shrink-0">
            {mark}
            Watch together
          </Button>
          <span className="flex-1" />
          <IconButton
            aria-label={playLabel}
            title={playLabel}
            onClick={togglePlay}
            active={blocked}
            className={blocked ? "animate-pulse-dot" : ""}
          >
            <PlayPauseIcon playing={showing} />
          </IconButton>
          <IconButton aria-label="Next trailer" title="Next trailer" onClick={next}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="M6 6l8 6-8 6z" strokeLinejoin="round" />
              <path d="M18 6v12" strokeLinecap="round" />
            </svg>
          </IconButton>
          {wantsPlayer ? (
            <IconButton aria-label={sound} title={muted ? "Sound on" : "Mute"} onClick={toggleSound} active={!muted}>
              <SoundIcon muted={muted} />
            </IconButton>
          ) : null}
        </div>
      </div>

      {revealed ? (
        // No track, and kept in from the edges, which fade into the trailer:
        // a line along the edge would read as a border.
        // The fill is moved by HeroBackdrop, straight on the element.
        <div className="absolute inset-x-5 bottom-1.5 h-[2px]" aria-hidden>
          <div
            ref={(bar) => {
              progressBarRef.current = bar;
              if (bar) bar.style.transform = `scaleX(${progressRef.current})`;
            }}
            className="h-full origin-left rounded-full bg-cream/70 transition-transform duration-1000 ease-linear"
          />
        </div>
      ) : null}
    </aside>
  );
}
