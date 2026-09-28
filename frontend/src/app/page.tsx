import { AppHeader, AppNav } from "@/components/AppNav";
import FriendsWatching from "@/components/home/FriendsWatching";
import { HeroBackdrop, HeroProvider, NowShowing } from "@/components/home/Hero";
import { JoinCodeForm, StartPartyButton } from "@/components/home/HeroActions";
import HomeGreeting from "@/components/home/HomeGreeting";
import MyRooms from "@/components/home/MyRooms";
import TrendingRow from "@/components/home/TrendingRow";
import VerifyNotice from "@/components/home/VerifyNotice";
import { Eyebrow, Logo } from "@/components/ui";

/*
 * The home screen is a server component: the words and the layout arrive as
 * HTML, and only the greeting, the trailer backdrop, the two actions, the room
 * list, the trending row and the navigation hydrate.
 */

const STEPS = [
  { title: "Pick something", body: "Search YouTube or paste an MP4, HLS or Vimeo link." },
  { title: "Share the code", body: "Friends join from any browser, phones included. No app, no sign-up." },
  {
    title: "Watch in sync",
    body: "Play, pause and seek land on every screen together, within a quarter second.",
  },
];

const column = "mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8";

export default function HomePage() {
  return (
    <main className="spotlight w-full pb-32 lg:pb-16">
      <HeroProvider>
        {/* The hero: a trailer from what is popular right now plays behind
            it, full width, fading into the page at the bottom. Below lg it is
            faint, a layer of motion behind the cards (see HeroBackdrop). */}
        {/* Nothing that arrives late may move what is already on screen: the
            "Now showing" card has its space reserved (the row's min height on
            a wide screen, the hero's bottom padding below lg, sized to the
            compact card's one line). */}
        <div className="relative isolate pb-24 lg:pb-20">
          <HeroBackdrop />
          <div className={column}>
            <AppHeader />
            <VerifyNotice />
            <div className="lg:flex lg:min-h-64 lg:items-end lg:justify-between lg:gap-10 lg:pt-14">
              <HomeGreeting />
              <div className="absolute inset-x-5 bottom-5 sm:inset-x-6 lg:static">
                <NowShowing />
              </div>
            </div>

            {/* One column on a phone; the two cards side by side from a
                tablet up, where one full-width card is mostly empty. */}
            <div className="mt-14 grid grid-cols-1 gap-3 sm:mt-16 md:grid-cols-[1.08fr_1fr] md:gap-4 lg:mt-12 lg:grid-cols-[1.25fr_1fr] lg:gap-5">
              {/* Below md one short row: title, a line, and the button on the
                  right, where the rings sit behind it. From md the full card. */}
              <section
                aria-labelledby="start-h"
                className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#17171a]/85 to-panel/85 px-4 py-3.5 md:block md:rounded-[18px] md:p-6 lg:rounded-[20px] lg:p-8"
              >
                <div className="halo halo-dim -right-12 top-1/2 w-[150px] -translate-y-1/2 md:-right-14 md:w-[240px] lg:w-[300px]" aria-hidden />
                <div className="halo -right-4 top-1/2 w-[96px] -translate-y-1/2 md:-right-5 md:w-[150px] lg:w-[190px]" aria-hidden />
                <span
                  className="absolute right-8 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-gold/60 text-gold md:grid lg:right-10 lg:h-14 lg:w-14"
                  aria-hidden
                >
                  <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current lg:h-5 lg:w-5">
                    <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
                  </svg>
                </span>
                {/* From md kept clear of the ring on the right. */}
                <div className="relative min-w-0 md:max-w-[calc(100%-6rem)] lg:max-w-sm">
                  <Eyebrow className="hidden md:block">Watch together</Eyebrow>
                  <h2 id="start-h" className="font-serif text-[18px] font-normal leading-tight tracking-[-0.01em] md:mt-2 md:text-[28px] md:leading-[1.1] lg:mt-2.5 lg:text-4xl">
                    Start a <span className="italic">watch party</span>
                  </h2>
                  <p className="mt-0.5 truncate text-[12px] text-muted md:mt-1.5 md:whitespace-normal md:text-[13px] md:leading-relaxed lg:mt-2 lg:text-sm">
                    <span className="md:hidden">Pick a video, share the code.</span>
                    <span className="hidden md:inline">Pick a video, share the code, and press play together.</span>
                  </p>
                </div>
                {/* contents below md: the button is the row's second cell. */}
                <div className="contents md:relative md:mt-4 md:block lg:mt-6">
                  <StartPartyButton className="relative" />
                </div>
              </section>

              <section
                aria-labelledby="join-h"
                className="flex flex-col justify-center md:rounded-[18px] md:border md:border-white/10 md:bg-panel/85 md:p-5 lg:rounded-[20px] lg:p-8"
              >
                <h2 id="join-h" className="sr-only md:not-sr-only md:font-serif md:text-[22px] md:font-normal lg:text-2xl">
                  Have a code?
                </h2>
                <p className="hidden text-[13px] text-muted md:mt-1 md:block lg:mt-1.5 lg:text-sm">Friends join straight from the code. No account needed.</p>
                <JoinCodeForm className="md:mt-5 lg:mt-6" />
                <p className="mt-2 px-2 text-[11px] text-faint md:hidden lg:block lg:px-1 lg:text-xs">Joining needs no account. Hosting needs a free one.</p>
              </section>
            </div>
          </div>
        </div>
      </HeroProvider>

      <div className={column}>
        <div className="space-y-8 lg:space-y-14">
          <FriendsWatching />
          <MyRooms />
          <TrendingRow />

          <section className="border-t border-line pt-8 lg:pt-14" aria-labelledby="how">
            <h2 id="how" className="font-serif text-[22px] font-normal tracking-[-0.01em] sm:text-3xl">
              How it works
            </h2>
            {/* A phone: one panel, the steps divided by hairlines. From sm up:
                three cards in a row. */}
            <ol className="mt-4 divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-panel sm:mt-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex gap-3.5 px-4 py-3.5 sm:flex-col sm:gap-3 sm:rounded-[18px] sm:border sm:border-line sm:bg-panel sm:p-6"
                >
                  <span className="w-5 shrink-0 font-serif text-2xl italic leading-none text-gold sm:w-auto sm:text-4xl">{index + 1}</span>
                  <div>
                    <p className="text-[14px] font-semibold sm:text-[15px]">{step.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted sm:mt-1 sm:text-sm">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="mt-10 flex flex-col gap-3 border-t border-line py-7 text-xs text-faint sm:flex-row sm:items-center sm:justify-between lg:mt-12 lg:py-8">
          <Logo />
          <span className="max-w-md">Netflix and other DRM services play through the desktop extension; chat works everywhere.</span>
        </footer>
      </div>

      <AppNav />
    </main>
  );
}
