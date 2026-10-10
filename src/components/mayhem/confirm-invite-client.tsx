"use client";

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
  slotId,
  token,
  viewerDisplayName,
}: {
  slotId: string;
  token: string;
  viewerDisplayName: string;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "confirmed" | "declined" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function accept() {
    setStatus("pending");
    const result = await confirmApplicationSlot(slotId, token);
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
    const result = await declineApplicationSlot(slotId, token);
    if (!result.ok) {
      setStatus("error");
      setMessage(result.reason);
      return;
    }
    setStatus("declined");
    setMessage("You've declined this invite.");
  }

  return (
    <section className="container-wide py-20 max-w-lg">
      <div className="border border-line bg-surface p-8 text-center space-y-5">
        {status === "confirmed" ? (
          <>
            <Check className="h-10 w-10 mx-auto text-success" />
            <p className="font-heading text-heading-md text-ink">{message}</p>
          </>
        ) : status === "declined" ? (
          <>
            <X className="h-10 w-10 mx-auto text-ink-muted" />
            <p className="font-heading text-heading-md text-ink">{message}</p>
          </>
        ) : status === "error" ? (
          <>
            <ShieldAlert className="h-10 w-10 mx-auto text-danger" />
            <p className="font-heading text-heading-md text-ink">{message}</p>
          </>
        ) : (
          <>
            <p className="text-caption uppercase text-ink-muted">Signed in as {viewerDisplayName}</p>
            <p className="font-heading text-heading-md text-ink mb-1">Join this premade team?</p>
            <p className="text-body-sm text-ink-secondary">
              A captain invited you to their ARAM Mayhem team. Confirm below, or decline if this
              wasn&apos;t meant for you.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button onClick={accept} disabled={status === "pending"}>
                {status === "pending" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </Button>
              <Button variant="ghost" onClick={decline} disabled={status === "pending"}>
                Decline
              </Button>
            </div>
          </>
        )}
        <Link href="/tournaments/aram" className="block text-caption text-ink-muted hover:text-ink pt-2">
          Back to ARAM Mayhem
        </Link>
      </div>
    </section>
  );
}
