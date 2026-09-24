import HeroActions from "@/components/home/HeroActions";
import HomeHeader from "@/components/home/HomeHeader";
import MyRooms from "@/components/home/MyRooms";
import VerifyNotice from "@/components/home/VerifyNotice";
import { Accent, Avatar, LiveDot, Logo } from "@/components/ui";

/*
 * The landing page is a server component: the words and the picture arrive as
 * HTML, and only the account menu, the two actions and the room list hydrate.
 */

const STEPS = [
  {
    title: "Pick something",
    body: "Search YouTube or paste an MP4, HLS or Vimeo link.",
    icon: <path d="M5 12h14M12 5v14" strokeLinecap="round" />,
  },
  {
    title: "Share the code",
    body: "Friends join from any browser, phones included. No app, no sign-up.",
    icon: (
      <>
        <path d="M8.5 12.5 15.5 16.5M15.5 7.5l-7 4" strokeLinecap="round" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
      </>
    ),
  },
  {
    title: "Watch in sync",
    body: "Play, pause and seek land on every screen together, within a quarter second.",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
];

/** A drawing of a room, inside the halo. Pure markup, no script. */
function HeroVisual() {
  const viewers = ["Maya Chen", "Theo", "Ana Ruiz", "Jules"];
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-[26rem] place-items-center lg:max-w-[30rem]" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(59_91_255/0.22),transparent)]" />
      <div className="halo inset-[6%]" />
      <div className="relative w-[88%] overflow-hidden rounded-2xl border border-white/15 bg-panel shadow-[0_30px_80px_-24px_rgb(0_0_0/0.95)]">
        <div className="relative aspect-video overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(110%_90%_at_18%_8%,#c9d4ff_0%,#5a77ff_22%,#2a1f7a_50%,#0b0a1f_78%,#050507_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-ink via-ink/50 to-transparent" />
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1 text-[10.5px] font-medium">
            <LiveDot /> 4 watching
          </div>
          <span className="reaction-float absolute bottom-12 left-[78%] text-2xl [animation-iteration-count:infinite]">🔥</span>
          <div className="absolute bottom-3 left-3 right-3">
            <p className="text-sm font-semibold">Friday night, somewhere else</p>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-[38%] rounded-full bg-cobalt" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex -space-x-1.5">
            {viewers.map((name) => (
              <Avatar key={name} name={name} size={22} className="ring-2 ring-panel" />
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-sage" /> In sync · ±38 ms
          </span>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="spotlight mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
      <HomeHeader />
      <VerifyNotice />

      <section className="grid items-center gap-10 pb-14 pt-8 sm:pb-20 sm:pt-14 lg:grid-cols-[1.1fr_1fr] lg:gap-8 lg:pt-16">
        <div className="animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            <LiveDot /> YouTube, MP4, HLS and Vimeo
          </p>
          <h1 className="text-balance mt-5 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            Watch together, <Accent>in perfect sync.</Accent>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg">
            Start a room, share the code, and everyone presses play at the same moment. From any browser, on any
            screen.
          </p>
          <HeroActions />
        </div>

        <HeroVisual />
      </section>

      <MyRooms />

      <section className="border-t border-line py-14 sm:py-20" aria-labelledby="how">
        <h2 id="how" className="text-xl font-semibold tracking-tight sm:text-2xl">
          How it works
        </h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-line bg-panel p-4 sm:flex-col sm:p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cobalt/12 text-cobalt-soft">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                  {step.icon}
                </svg>
              </span>
              <div>
                <p className="text-[15px] font-semibold">
                  <span className="mr-1.5 text-faint">{index + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-col gap-3 border-t border-line py-8 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <span className="max-w-md">Netflix and other DRM services play through the desktop extension; chat works everywhere.</span>
      </footer>
    </main>
  );
}
