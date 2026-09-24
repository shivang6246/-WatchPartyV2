"use client";

import VerifyEmailBanner from "@/components/VerifyEmailBanner";
import { useAuth } from "@/lib/auth-context";

/** Asks a signed-in, unverified account to confirm its email before hosting. */
export default function VerifyNotice() {
  const { user } = useAuth();
  if (!user || !user.verificationRequired || user.emailVerified) return null;
  return (
    <div className="pt-2">
      <VerifyEmailBanner email={user.email} />
    </div>
  );
}
