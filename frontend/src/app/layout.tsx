import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import ResourceHints from "@/components/ResourceHints";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

// Self-hosted at build time: no request reaches Google from a visitor's browser.
// Plus Jakarta Sans is one variable file for every weight. Newsreader, the
// display serif (titles, the greeting, the wordmark), is one static weight in
// roman and italic: nothing sets it heavier, and a single weight is a much
// smaller file than the variable range. Mono only shows up in codes and
// timecodes, so it is not preloaded, and it too is fixed weights.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", preload: false });
const serif = Newsreader({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: "WatchParty",
  description: "Synced watch parties in any browser, phones included.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Deliberately not interactiveWidget "resizes-content": the keyboard must
  // not resize the layout. It would reflow the room (a short phone even reads
  // as landscape), resize the player, and YouTube re-buffers on every resize.
};

/**
 * Runs before the first paint. The session lives in an HttpOnly cookie on the
 * API's origin, so the static HTML cannot know who is signed in; this reads
 * the hint the client left last time (see auth-context) and marks <html>, so
 * the home screen draws the right greeting at once instead of swapping it in
 * after hydration and pushing the page down.
 */
const AUTH_HINT = `try{var d=document.documentElement,n=localStorage.getItem("wp.name");d.dataset.auth=n?"in":"out";if(n)d.style.setProperty("--wp-name",JSON.stringify(n))}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the hint script sets data-auth and a style on
    // <html> before React hydrates it, on purpose.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="min-h-dvh bg-ink font-sans text-cream antialiased">
        <ResourceHints />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
