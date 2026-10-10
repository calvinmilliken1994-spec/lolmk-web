import type { Metadata } from "next";
import { getMayhemInviteSelection } from "@/lib/mayhem-db";
import { getMemberSession } from "@/lib/discord-auth";
import { ConfirmInviteClient } from "@/components/mayhem/confirm-invite-client";
import { pageMetadata } from "@/lib/metadata";
import { PageHeader } from "@/components/ds/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";

// Invite confirmation links are single-use and identity-bound — never
// worth indexing, and never worth leaking via a referrer header to
// whatever site an invitee clicks away to next.
export const metadata: Metadata = {
  ...pageMetadata({
    title: "Confirm invite: ARAM Mayhem",
    description: "Confirm your slot on an ARAM Mayhem team.",
    noindex: true,
  }),
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

function isValidSlotId(v: string): boolean {
  // newId() = `${prefix}_${randomUUID().slice(0, 12)}` — a UUID slice
  // contains hyphens, so the id shape is alphanumerics AND hyphens, not
  // alphanumerics only.
  return /^maslot_[a-zA-Z0-9-]{6,20}$/.test(v);
}

function isValidToken(v: string): boolean {
  // base64url from randomBytes(24) — no fixed length requirement beyond
  // sane bounds, this only rejects obviously-malformed/oversized input
  // before it ever reaches a DB round-trip.
  return /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/**
 * Server wrapper: resolves the signed-in member (if any) and re-validates
 * slot/token shape before handing off to the client component. A visitor
 * who isn't signed in sees a real "sign in with Discord" path that
 * preserves this exact URL (slot + token) as the OAuth return
 * destination — previously this page called confirmApplicationSlot()
 * directly client-side with no session, which always failed with "sign
 * in first" and no way to actually do that from here.
 */
export default async function ConfirmInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string; token?: string; t?: string; g?: string }>;
}) {
  const params = await searchParams;
  const slotId = params.slot ?? "";
  const token = params.token ?? "";
  const storedSelection = isValidSlotId(slotId) ? await getMayhemInviteSelection(slotId).catch(() => null) : null;
  const selection = params.t && params.g !== undefined
    ? { eventId: params.t, generation: Number(params.g) }
    : storedSelection;
  const validParams = isValidSlotId(slotId) && isValidToken(token) && selection !== null &&
    Number.isInteger(selection.generation) && selection.generation >= 0 &&
    storedSelection?.eventId === selection.eventId && storedSelection.generation === selection.generation;

  const member = validParams ? await getMemberSession().catch(() => null) : null;

  if (!validParams) {
    return (
      <PageHeader
        tag="ARAM Mayhem"
        title="Invite link not valid."
        deck="This link is missing or malformed. Ask the captain to send a fresh one."
      />
    );
  }

  if (!member) {
    // Same-origin relative path only, built from already-validated slot/token —
    // never accepts an attacker-controlled redirect target.
    const returnTo = `/tournaments/aram/confirm?t=${encodeURIComponent(selection!.eventId)}&g=${selection!.generation}&slot=${encodeURIComponent(slotId)}&token=${encodeURIComponent(token)}`;
    return (
      <PageHeader
        tag="ARAM Mayhem"
        title="Confirm your spot."
        deck="Team invites are tied to your verified Discord account. Sign in to see who invited you and confirm your spot."
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
      <PageHeader tag="ARAM Mayhem" title="Confirm your spot." />
      <ConfirmInviteClient selection={selection!} slotId={slotId} token={token} viewerDisplayName={member.displayName} />
    </>
  );
}
