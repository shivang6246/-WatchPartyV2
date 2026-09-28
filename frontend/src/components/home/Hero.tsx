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
 * YouTube draws its own title bar and buttons over the first seconds of every
 * video, controls off or not. The still stays up until they have gone.
 */
const YOUTUBE_CHROME_MS = 3200;

interface Hero {
  item: CatalogItem | null;
  /** Counts every change of trailer, so a one-trailer playlist still replays. */
  turn: number;
  /** lg and up. Followed live, so a tablet turned sideways gets the wide look. */
  wide: boolean;
  /** Motion allowed and not saving data: the trailer plays. Otherwise its still. */
  motion: boolean;
  /** The trailer is actually playing. */
  showing: boolean;
  setShowing: (showing: boolean) => void;
  /** Playing, and past YouTube's opening overlay: the trailer may be seen. */
  revealed: boolean;
  muted: boolean;
  progress: number;
  setProgress: (progress: number) => void;
  next: () => void;
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
 * The provider holds the playlist so the backdrop and the "Now showing" card
 * agree on what is on.
 */
export function HeroProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [index, setIndex] = useState(0);
  const [wide, setWide] = useState(false);
  const [motion, setMotion] = useState(false);
  const [showing, setShowing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const playerRef = useRef<YT.Player | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onWidth = () => setWide(query.matches);
    onWidth();
    query.addEventListener("change", onWidth);
    // A playing trailer costs data and battery: someone who asked for less
    // motion or less data gets the still instead.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    setMotion(!calm && !saveData);

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

  useEffect(() => {
    if (!showing) {
      setRevealed(false);
      return;
    }
    const timer = setTimeout(() => setRevealed(true), YOUTUBE_CHROME_MS);
    return () => clearTimeout(timer);
  }, [showing]);

  const next = useCallback(() => {
    setShowing(false);
    setProgress(0);
    setIndex((current) => current + 1);
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

  const value = useMemo<Hero>(
    () => ({ item, turn: index, wide, motion, showing, setShowing, revealed, muted, progress, setProgress, next, toggleSound, playerRef }),
    [item, index, wide, motion, showing, revealed, muted, progress, next, toggleSound],
  );

  return <HeroContext.Provider value={value}>{children}</HeroContext.Provider>;
}

/**
 * The picture itself, behind the hero at every width: the trailer's still at
 * once, and the trailer fading in over it once it is playing and YouTube's
 * opening overlay has gone. It pauses when the tab is hidden or the hero is
 * scrolled away. On a wide screen it is the scenery; below lg the cards cover
 * most of it, so it is dimmed to a faded, low-opacity layer of motion behind
 * them rather than a picture they would seem to sit on.
 */
export function HeroBackdrop() {
  const { item, turn, wide, motion, showing, setShowing, revealed, setProgress, next, playerRef } = useHero();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  // Errors in a row. A few mean the trouble is not the video (the network,
  // an extension blocking YouTube): stop trying and keep the still.
  const failuresRef = useRef(0);
  const ref = item?.ref ?? null;

  // The widest still YouTube has on a wide screen; below lg, where it is
  // drawn faint and small, hqdefault is plenty at a fraction of the bytes.
  useEffect(() => {
    setPoster(ref ? `https://i.ytimg.com/vi/${ref}/${wide ? "maxresdefault" : "hqdefault"}.jpg` : null);
  }, [ref, wide]);

  // The player, made once, for the first trailer.
  const created = useRef(false);
  useEffect(() => {
    if (!motion || !ref || created.current) return;
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
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (event.data === YTApi.PlayerState.PLAYING) {
                failuresRef.current = 0;
                setShowing(true);
              }
              if (event.data === YTApi.PlayerState.ENDED) nextRef.current();
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
    }, START_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [motion, ref, playerRef, setShowing]);

  // Later trailers load into the same player.
  const loadedTurn = useRef(turn);
  useEffect(() => {
    const player = playerRef.current;
    if (loadedTurn.current === turn) return;
    loadedTurn.current = turn;
    if (ref && player && created.current) player.loadVideoById?.({ videoId: ref, startSeconds: START_AT_S });
  }, [turn, ref, playerRef]);

  // How far into the trailer, for the card's hairline.
  useEffect(() => {
    if (!showing) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      const duration = player?.getDuration?.() ?? 0;
      if (player && duration > 0) setProgress(Math.min(1, (player.getCurrentTime?.() ?? 0) / duration));
    }, 500);
    return () => clearInterval(timer);
  }, [showing, playerRef, setProgress]);

  // Nobody watching it, nothing playing: a hidden tab or a hero scrolled
  // away. The box exists once there is an item.
  const hasItem = ref !== null;
  useEffect(() => {
    if (!motion || !hasItem) return;
    let onScreen = true;
    const apply = () => {
      const player = playerRef.current;
      if (!player?.playVideo) return;
      if (onScreen && !document.hidden) player.playVideo();
      else player.pauseVideo();
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      apply();
    });
    if (boxRef.current) observer.observe(boxRef.current);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [motion, hasItem, playerRef]);

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

  return (
    // The sides fade into the page: a trailer that is not 16:9 comes with
    // YouTube's black bars, and any hard edge left would read as a seam.
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_9%,black_91%,transparent)]"
      aria-hidden="true"
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={poster}
          src={poster}
          alt=""
          onError={() => setPoster(item.thumbnail && poster !== item.thumbnail ? item.thumbnail : null)}
          className={`fade-in absolute inset-0 h-full w-full object-cover opacity-25 lg:opacity-70 ${letterboxed ? "scale-[1.34]" : ""}`}
        />
      ) : null}
      {/* The iframe is sized to cover the box whatever its shape, and scaled
          past the edges so YouTube's own corners never show, and far enough
          that a 4:3 trailer's side bars fall outside the box. */}
      <div
        ref={hostRef}
        className={`absolute inset-0 transition-opacity duration-1000 [container-type:size] [&_iframe]:absolute [&_iframe]:left-1/2 [&_iframe]:top-1/2 [&_iframe]:h-[max(100cqh,56.25cqw)] [&_iframe]:w-[max(100cqw,177.78cqh)] [&_iframe]:-translate-x-1/2 [&_iframe]:-translate-y-1/2 [&_iframe]:scale-[1.36] ${
          revealed ? "opacity-30 lg:opacity-85" : "opacity-0"
        }`}
      />
      {/* Enough dark for the words on top to read over any frame. A wide
          screen darkens the left, where the greeting is; below lg the cards
          span the width, so it is an even veil that fades out at the top and
          the bottom instead. */}
      <div className="absolute inset-0 bg-ink/30 lg:bg-ink/20" />
      <div className="absolute inset-0 hidden bg-gradient-to-r from-ink/90 via-ink/45 to-transparent lg:block" />
      <div className="absolute inset-y-0 right-0 hidden w-1/4 bg-gradient-to-l from-ink/60 to-transparent lg:block" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/85 to-transparent lg:h-40" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink via-ink/70 to-transparent lg:h-3/5 lg:via-ink/80" />
    </div>
  );
}

const PLAY_MARK = (
  <svg viewBox="0 0 24 24" className="ml-0.5 h-3 w-3 fill-current" aria-hidden>
    <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
  </svg>
);

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

/** What the backdrop is playing, the sound, and one tap to watch it with friends. */
export function NowShowing() {
  const { item, motion, revealed, muted, progress, next, toggleSound } = useHero();
  const { start, busyRef } = useStartParty();
  if (!item) return null;
  const busy = busyRef !== null && busyRef === (item.ref ?? item.url);
  const watchTogether = () => void start(item).catch(() => undefined);
  const mark = busy ? <Spinner className="h-4 w-4" /> : PLAY_MARK;
  const sound = muted ? "Turn the sound on" : "Mute";

  return (
    <aside
      aria-label="Now showing"
      className="fade-in relative overflow-hidden rounded-2xl border border-white/10 bg-ink/60 lg:w-[21.5rem] lg:shrink-0"
    >
      {/* Below lg: one line over the backdrop, the sound and the play mark,
          at one fixed height, which the hero reserves. */}
      <div className="flex items-center gap-1 p-[7px] pl-3.5 sm:pl-4 lg:hidden">
        <div className="min-w-0 flex-1 pr-1">
          <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold sm:text-[10px]">
            {revealed ? <LiveDot /> : null}
            Now showing
          </p>
          <p className="mt-0.5 truncate text-[13px] font-medium">{item.title}</p>
        </div>
        {motion ? (
          <button
            type="button"
            onClick={toggleSound}
            aria-label={sound}
            title={sound}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95"
          >
            <span className={`grid h-[34px] w-[34px] place-items-center rounded-full border ${muted ? "border-line text-cream" : "border-gold/50 bg-gold/10 text-gold"}`}>
              <SoundIcon muted={muted} />
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={watchTogether}
          disabled={busy}
          aria-label="Watch together"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream text-ink transition hover:bg-white active:scale-95 disabled:opacity-40"
        >
          {mark}
        </button>
      </div>

      {/* A wide screen: the whole card. */}
      <div className="hidden p-5 lg:block">
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
          <IconButton aria-label="Next trailer" title="Next trailer" onClick={next}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="M6 6l8 6-8 6z" strokeLinejoin="round" />
              <path d="M18 6v12" strokeLinecap="round" />
            </svg>
          </IconButton>
          {motion ? (
            <IconButton aria-label={sound} title={muted ? "Sound on" : "Mute"} onClick={toggleSound} active={!muted}>
              <SoundIcon muted={muted} />
            </IconButton>
          ) : null}
        </div>
      </div>

      {motion && revealed ? (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10" aria-hidden>
          <div className="h-full bg-cream/80 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
    </aside>
  );
}
