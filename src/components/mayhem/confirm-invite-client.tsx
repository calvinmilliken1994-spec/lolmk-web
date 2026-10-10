"use client";

import type { MayhemSelection } from "@/lib/mayhem-operation";
import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmApplicationSlot, declineApplicationSlot } from "@/app/tools/mayhem/actions";

/**
 * Renders only once a real member session exists (see page.tsx's server
 * wrapper) — this component never confirms on mount/GET and never fires
 * anything automatically after login; both actions require an explicit
 * click. slot/token are pre-validated (shape only) server-side before
 * this ever renders; every real check (token hash match, expiry,
 * recipient identity, registration state) happens in
 * confirmApplicationSlot()/declineApplicationSlot() itself.
 */
export function ConfirmInviteClient({
  selection,
  slotId,
  token,
  viewerDisplayName,
}: {
  selection: MayhemSelection;
  slotId: string;
  token: string;
  viewerDisplayName: string;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "confirmed" | "declined" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function accept() {
    setStatus("pending");
    const result = await confirmApplicationSlot(selection, slotId, token);
    if (!result.ok) {
      setStatus("error");
      setMessage(result.reason);
      return;
    }
    setStatus("confirmed");
    setMessage(
      result.promoted
        ? "Team complete — you're all locked in."
        : "You're confirmed. Waiting on the rest of the team.",
    );
  }

  async function decline() {
    setStatus("pending");
    const result = await declineApplicationSlot(selection, slotId, token);
    if (!result.ok) {
      setStatus("error");
      setMessage(result.reason);
      return;
    }
    setStatus("declined");
    setMessage("You've declined this invite.");
  }

  return (
    <section className="ds-container pb-[clamp(64px,8vw,104px)]">
      <div className="max-w-xl space-y-5 border border-ds-line bg-ds-surface p-8">
        {status === "confirmed" ? (
          <>
            <Check className="h-10 w-10 text-success" />
            <p className="font-heading text-ds-ui-lg font-semibold text-ds-text">{message}</p>
          </>
        ) : status === "declined" ? (
          <>
            <X className="h-10 w-10 text-ink-muted" />
            <p className="font-heading text-ds-ui-lg font-semibold text-ds-text">{message}</p>
          </>
        ) : status === "error" ? (
          <>
            <ShieldAlert className="h-10 w-10 text-danger" />
            <p className="font-heading text-ds-ui-lg font-semibold text-ds-text">{message}</p>
          </>
        ) : (
          <>
            <p className="font-heading text-ds-label text-ds-text-dim">Signed in as {viewerDisplayName}</p>
            <p className="font-heading text-ds-ui-lg font-semibold text-ds-text mb-1">Join this premade team?</p>
            <p className="text-ds-body text-ds-text-muted">
              A captain invited you to their ARAM Mayhem team. Confirm below, or decline if this
              wasn&apos;t meant for you.
            </p>
            <div className="flex gap-3 pt-2">
              <Button onClick={accept} disabled={status === "pending"}>
                {status === "pending" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </Button>
              <Button variant="ghost" onClick={decline} disabled={status === "pending"}>
                Decline
              </Button>
            </div>
          </>
        )}
        <Link href={`/tournaments/aram?t=${encodeURIComponent(selection.eventId)}`} className="ds-link inline-flex min-h-11 items-center font-heading text-ds-ui text-ds-text-muted">
          Back to ARAM Mayhem
        </Link>
      </div>
    </section>
  );
}
