import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

// Self-hosted at build time: no request reaches Google from a visitor's browser.
// Geist is one variable file for every weight. Mono only shows up in codes and
// timecodes, so it is not preloaded; the serif is a single italic for accents.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", preload: false });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-instrument" });

export const metadata: Metadata = {
  title: "WatchParty",
  description: "Synced watch parties in any browser, phones included.",
};

export const viewport: Viewport = {
  themeColor: "#050507",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Deliberately not interactiveWidget "resizes-content": the keyboard must
  // not resize the layout. It would reflow the room (a short phone even reads
  // as landscape), resize the player, and YouTube re-buffers on every resize.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-dvh bg-ink font-sans text-cream antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
