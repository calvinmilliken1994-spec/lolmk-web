import type { Metadata } from "next";
import { getMemberSession } from "@/lib/discord-auth";
import { ConfirmInviteClient } from "@/components/sr/confirm-invite-client";

// Invite confirmation links are single-use and identity-bound — never worth
// indexing, and never worth leaking via a referrer header to whatever site an
// invitee clicks away to next.
export const metadata: Metadata = {
  title: "Confirm invite — Summoner's Rift",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

function isValidSlotId(v: string): boolean {
  // newId() = `${prefix}_${randomUUID().slice(0, 12)}` — a UUID slice contains
  // hyphens, so the id shape is alphanumerics AND hyphens, not alphanumerics
  // only. Prefix must match what createPremadeApplication/addDraftMember mint.
  return /^srslot_[a-zA-Z0-9-]{6,20}$/.test(v);
}

function isValidToken(v: string): boolean {
  // base64url from randomBytes(24) — this only rejects obviously malformed or
  // oversized input before it ever reaches a DB round-trip.
  return /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/**
 * Server wrapper: resolves the signed-in member (if any) and re-validates
 * slot/token shape before handing off to the client component. A visitor who
 * isn't signed in gets a real "sign in with Discord" path that preserves this
 * exact URL (slot + token) as the OAuth return destination, so the invite
 * survives the round trip instead of dead-ending on "sign in first".
 *
 * Shape validation here is a cheap filter and nothing more. Every check that
 * matters — token hash match, expiry, whether the signed-in account is
 * actually the addressee, whether signups are still open — happens inside
 * confirmApplicationSlot()/declineApplicationSlot().
 */
export default async function ConfirmInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string; token?: string }>;
}) {
  const params = await searchParams;
  const slotId = params.slot ?? "";
  const token = params.token ?? "";
  const validParams = isValidSlotId(slotId) && isValidToken(token);

  const member = validParams ? await getMemberSession().catch(() => null) : null;

  if (!validParams) {
    return (
      <section className="container-wide py-20 max-w-lg">
        <div className="border border-line bg-surface p-8 text-center space-y-3">
          <p className="font-heading text-heading-md text-ink">Invalid invite link</p>
          <p className="text-body-sm text-ink-secondary">
            This link is missing or malformed — ask your captain to send a fresh one.
          </p>
        </div>
      </section>
    );
  }

  if (!member) {
    // Same-origin relative path only, built from the already-validated
    // slot/token — never an attacker-controlled redirect target.
    const returnTo = `/tournaments/summoners-rift/confirm?slot=${encodeURIComponent(slotId)}&token=${encodeURIComponent(token)}`;
    return (
      <section className="container-wide py-20 max-w-lg">
        <div className="border border-line bg-surface p-8 text-center space-y-4">
          <p className="font-heading text-heading-md text-ink mb-1">Sign in to view this invite.</p>
          <p className="text-body-sm text-ink-secondary max-w-md mx-auto">
            Roster invites are tied to your verified Discord account — sign in to see who invited you
            and confirm your spot.
          </p>
          <a
            href={`/api/auth/member/login?next=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-2 border border-line-strong px-5 py-2.5 text-body-sm font-semibold text-ink hover:border-brand-red"
          >
            Sign in with Discord
          </a>
        </div>
      </section>
    );
  }

  return <ConfirmInviteClient slotId={slotId} token={token} viewerDisplayName={member.displayName} />;
}
