"use client";

import Link from "next/link";
import { useState } from "react";
import Poster from "@/components/Poster";
import { Button, Eyebrow, Input, LiveDot, Logo, Spinner } from "@/components/ui";
import type { RoomPreview } from "@/lib/types";

interface Props {
  preview: RoomPreview | null;
  onJoin: (displayName: string) => Promise<void>;
}

/**
 * The whole product in one screen: a name, one tap, watching. No install, no
 * account, no email. On a phone it is a single column; the artwork sits on top.
 * On its side the artwork moves beside the form, or it would fill the screen
 * and push the name field below the fold.
 */
export default function JoinGate({ preview, onJoin }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="spotlight flex min-h-dvh flex-col px-4">
      <header className="flex h-16 items-center land:h-12">
        <Link href="/" aria-label="WatchParty home">
          <Logo />
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col pb-10 pt-2 sm:justify-center sm:pt-0 land:max-w-2xl land:pb-3">
        <div className="animate-rise overflow-hidden rounded-[24px] border land:flex border-line bg-panel shadow-[0_30px_90px_-30px_rgb(0_0_0/0.95)]">
          {preview?.videoThumbnail ? (
            <div className="relative aspect-video w-full overflow-hidden bg-panel-2 land:aspect-auto land:w-[42%] land:shrink-0">
              <Poster src={preview.videoThumbnail} />
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-transparent to-transparent land:bg-gradient-to-l" />
              <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/75 px-3 py-1 text-[11px] font-medium">
                <LiveDot />
                {preview.memberCount} watching now
              </span>
            </div>
          ) : null}

          <div className="p-5 sm:p-7 land:min-w-0 land:flex-1 land:p-5">
            <Eyebrow>{preview?.code ? `Room ${preview.code}` : "You're invited"}</Eyebrow>
            <h1 className="mt-2 font-serif text-[1.9rem] font-normal leading-tight tracking-[-0.01em] sm:text-4xl land:text-2xl">
              {preview?.title ?? "Join the room"}
            </h1>
            {preview?.videoTitle && preview.videoTitle !== preview.title ? (
              <p className="mt-1.5 line-clamp-2 text-sm text-muted land:line-clamp-1">{preview.videoTitle}</p>
            ) : null}
            {!preview?.videoThumbnail && preview ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                <LiveDot /> {preview.memberCount} {preview.memberCount === 1 ? "person is" : "people are"} watching
              </p>
            ) : null}

            <form
              className="mt-6 space-y-3 land:mt-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  await onJoin(displayName.trim() || "Guest");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label htmlFor="guest-name" className="sr-only">
                Your name
              </label>
              <Input
                id="guest-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name"
                maxLength={40}
                autoComplete="nickname"
                enterKeyHint="go"
              />
              <Button type="submit" size="lg" disabled={busy} className="w-full">
                {busy ? <Spinner /> : "Take a seat"}
              </Button>
              <p className="pt-1 text-center text-xs text-faint">No account needed. Make one later and keep your place.</p>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
