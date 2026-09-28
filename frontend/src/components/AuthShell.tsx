"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Accent, Eyebrow, Logo } from "@/components/ui";

/**
 * The frame every sign-in screen shares: the mark, a headline, one form. On a
 * phone that is all there is. A wide screen gets the halo alongside, so the
 * page is not just a form.
 */
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="spotlight grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-4 sm:px-10">
        <header className="flex h-16 items-center">
          <Link href="/" aria-label="WatchParty home">
            <Logo />
          </Link>
        </header>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-start pb-12 pt-6 sm:justify-center sm:pt-0">
          <div className="animate-rise">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="mt-3 font-serif text-[2.4rem] font-normal leading-[1.04] tracking-[-0.015em] sm:text-5xl">{title}</h1>
            {subtitle ? <p className="mt-3 text-sm leading-relaxed text-muted">{subtitle}</p> : null}
            <div className="mt-8">{children}</div>
            {footer ? <div className="mt-8 border-t border-line pt-6 text-sm text-muted">{footer}</div> : null}
          </div>
        </div>
      </div>

      <aside className="hidden p-4 lg:block" aria-hidden>
        <div className="relative grid h-full place-items-center overflow-hidden rounded-[24px] border border-line bg-stage">
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgb(255_244_224/0.05),transparent_70%)]" />
          <div className="relative grid aspect-square w-[min(62%,28rem)] place-items-center">
            <div className="halo halo-dim -inset-[18%]" />
            <div className="halo inset-0" />
            <span className="relative text-center font-serif text-4xl leading-[1.12] xl:text-5xl">
              The best seat
              <br />
              is next to <Accent>them.</Accent>
            </span>
          </div>
          <p className="absolute bottom-10 max-w-xs text-center text-sm text-muted">
            Same frame, same laugh, same gasp, wherever everyone happens to be tonight.
          </p>
        </div>
      </aside>
    </main>
  );
}
