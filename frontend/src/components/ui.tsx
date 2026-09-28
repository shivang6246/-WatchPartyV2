"use client";

import { useState, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "light" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const sizes = {
    sm: "h-9 px-4 text-[13px]",
    md: "h-11 px-5 text-sm",
    lg: "h-12 px-6 text-[15px]",
  } as const;
  const variants = {
    // Off-white on near-black: the one clear call to action on any screen.
    primary: "bg-cream text-ink hover:bg-white",
    // Kept for callers that pair it with primary; the two now read the same.
    light: "bg-cream text-ink hover:bg-white",
    secondary: "border border-line-strong bg-panel-2 text-cream hover:border-white/20 hover:bg-panel-3",
    ghost: "text-cream hover:bg-white/[0.05]",
    subtle: "text-muted hover:text-cream",
    danger: "border border-ember/30 bg-ember/10 text-ember hover:bg-ember/15",
  } as const;
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}

/** A round, icon-only button. Always pass an aria-label. */
export function IconButton({
  className = "",
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition active:scale-95 disabled:opacity-40 ${
        active
          ? "border-gold/50 bg-gold/10 text-gold"
          : "border-line bg-transparent text-cream hover:border-line-strong hover:bg-white/[0.04]"
      } ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      // 16px on a phone: anything smaller and iOS zooms the page on focus.
      className={`h-12 w-full rounded-xl border border-line-strong bg-panel px-4 text-base text-cream placeholder:text-faint transition focus:border-gold/50 focus:outline-none focus:ring-4 focus:ring-gold/10 sm:text-sm ${className}`}
      {...props}
    />
  );
}

/**
 * A password field with a reveal toggle. Typing a password blind is where
 * sign-in attempts are lost, and on a phone it is most of them.
 */
export function PasswordInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <Input {...props} type={shown ? "text" : "password"} className={`pr-12 ${className}`} />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        // The label says what the button does, not what the field is doing.
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-cream"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3.2" />
          {shown ? <path d="m4 20 16-16" strokeLinecap="round" /> : null}
        </svg>
      </button>
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rounded-[1.25rem] p-6 ${className}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between text-xs font-medium text-muted">
        {label}
        {hint ? <span className="text-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** A small uppercase label, the "Now showing" of the interface. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold ${className}`}>
      {children}
    </p>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: { box: "border-line-strong bg-panel-2/80 text-cream/90", dot: "bg-gold" },
    error: { box: "border-ember/30 bg-ember/10 text-[#f2c4bf]", dot: "bg-ember" },
    success: { box: "border-sage/30 bg-sage/10 text-[#d3e6d8]", dot: "bg-sage" },
  } as const;
  return (
    <div className={`fade-in flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${tones[tone].box}`}>
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tones[tone].dot}`} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** A champagne pulse for "live" and "watching". */
export function LiveDot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gold ${className}`} aria-hidden />;
}

/** The mark: a hairline ring with a play cue inside, and the serif wordmark. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/60 text-gold">
        <svg viewBox="0 0 24 24" className="ml-px h-3 w-3" fill="currentColor" aria-hidden>
          <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.8l10.6-7.2a1 1 0 0 0 0-1.6L8.6 4c-.7-.5-1.6 0-1.6.8Z" />
        </svg>
      </span>
      {!compact ? (
        <span className="font-serif text-[21px] font-normal leading-none tracking-[-0.01em]">WatchParty</span>
      ) : null}
    </span>
  );
}

/** A word or two of a headline set in the italic serif. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-serif font-normal italic tracking-normal">{children}</span>;
}

/** Initials stand in for an avatar, on a muted tone picked deterministically from the name. */
export function Avatar({
  name,
  src,
  size = 32,
  ring = false,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const seed = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  // Warm and cool greys: people are told apart by name, the colour only
  // keeps a crowd of initials from reading as one grey block.
  const tones = ["#3a3834", "#34383b", "#3b3632", "#33373a", "#383531", "#31363a", "#3d3a36", "#2f3437"];
  const tone = tones[seed % tones.length];
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-cream ${
        ring ? "ring-1 ring-gold/70 ring-offset-2 ring-offset-ink" : ""
      } ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background: src ? undefined : tone,
      }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials || "?"
      )}
    </span>
  );
}

/** Milliseconds as h:mm:ss, which is how a scrub bar should read. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
