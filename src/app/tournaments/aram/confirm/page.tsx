import type { Metadata } from "next";
import { getMayhemInviteSelection } from "@/lib/mayhem-db";
import { getMemberSession } from "@/lib/discord-auth";
import { ConfirmInviteClient } from "@/components/mayhem/confirm-invite-client";
import { pageMetadata } from "@/lib/metadata";

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
      <section className="container-wide py-20 max-w-lg">
        <div className="border border-line bg-surface p-8 text-center space-y-3">
          <p className="font-heading text-heading-md text-ink">Invalid invite link</p>
          <p className="text-body-sm text-ink-secondary">
            This link is missing or malformed — ask the captain to send a fresh one.
          </p>
        </div>
      </section>
    );
  }

  if (!member) {
    // Same-origin relative path only, built from already-validated slot/token —
    // never accepts an attacker-controlled redirect target.
    const returnTo = `/tournaments/aram/confirm?t=${encodeURIComponent(selection!.eventId)}&g=${selection!.generation}&slot=${encodeURIComponent(slotId)}&token=${encodeURIComponent(token)}`;
    return (
      <section className="container-wide py-20 max-w-lg">
        <div className="border border-line bg-surface p-8 text-center space-y-4">
          <p className="font-heading text-heading-md text-ink mb-1">Sign in to view this invite.</p>
          <p className="text-body-sm text-ink-secondary max-w-md mx-auto">
            Team invites are tied to your verified Discord account — sign in to see who invited you and confirm.
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

  return <ConfirmInviteClient selection={selection!} slotId={slotId} token={token} viewerDisplayName={member.displayName} />;
}
