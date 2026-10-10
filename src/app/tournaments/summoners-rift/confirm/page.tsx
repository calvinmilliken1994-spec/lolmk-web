import type { Metadata } from "next";
import { getMemberSession } from "@/lib/discord-auth";
import { ConfirmInviteClient } from "@/components/sr/confirm-invite-client";
import { pageMetadata } from "@/lib/metadata";
import { PageHeader } from "@/components/ds/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";

// Invite confirmation links are single-use and identity-bound — never worth
// indexing, and never worth leaking via a referrer header to whatever site an
// invitee clicks away to next.
export const metadata: Metadata = {
  ...pageMetadata({
    title: "Confirm invite: Summoner's Rift",
    description: "Confirm your slot on a Summoner's Rift team.",
    noindex: true,
  }),
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
      <PageHeader
        tag="Summoner's Rift"
        title="Invite link not valid."
        deck="This link is missing or malformed. Ask your captain to send a fresh one."
      />
    );
  }

  if (!member) {
    // Same-origin relative path only, built from the already-validated
    // slot/token — never an attacker-controlled redirect target.
    const returnTo = `/tournaments/summoners-rift/confirm?slot=${encodeURIComponent(slotId)}&token=${encodeURIComponent(token)}`;
    return (
      <PageHeader
        tag="Summoner's Rift"
        title="Confirm your spot."
        deck="Roster invites are tied to your verified Discord account. Sign in to see who invited you and confirm your spot."
        actions={
          <a
            href={`/api/auth/member/login?next=${encodeURIComponent(returnTo)}`}
            className={buttonVariants({ variant: "discord", size: "md" })}
          >
            <DiscordIcon className="h-5 w-5" />
            Sign in with Discord
          </a>
        }
      />
    );
  }

  return (
    <>
      <PageHeader tag="Summoner's Rift" title="Confirm your spot." />
      <ConfirmInviteClient slotId={slotId} token={token} viewerDisplayName={member.displayName} />
    </>
  );
}
