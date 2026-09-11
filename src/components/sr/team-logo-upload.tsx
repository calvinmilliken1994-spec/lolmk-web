"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { clearTeamLogoAction, uploadTeamLogoAction } from "@/app/tools/summoners-rift/actions";

/**
 * Admin logo picker. The file is posted to a server action as multipart
 * FormData — the browser never talks to Blob directly and never holds a
 * write token, so authorization stays entirely server-side.
 *
 * When BLOB_READ_WRITE_TOKEN is unset the control renders disabled with an
 * explanation instead of failing at click time. `configured` is computed on
 * the server (env vars are not readable from the client) and passed down.
 */
export function TeamLogoUpload({
  teamId,
  configured,
  hasLogo,
  onUploaded,
  uploadAction,
  clearAction,
}: {
  teamId: string;
  configured: boolean;
  hasLogo?: boolean;
  onUploaded: () => void;
  /** Overridable so the captain surface can use its own ownership-scoped action. */
  uploadAction?: (teamId: string, formData: FormData) => Promise<{ url: string }>;
  clearAction?: (teamId: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const doUpload = uploadAction ?? uploadTeamLogoAction;
  const doClear = clearAction ?? clearTeamLogoAction;

  if (!configured) {
    return (
      <p className="w-16 text-caption leading-tight text-ink-muted" title="BLOB_READ_WRITE_TOKEN is not set on this deployment.">
        Uploads off
      </p>
    );
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        await doUpload(teamId, formData);
        onUploaded();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="w-16 space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="w-full inline-flex items-center justify-center gap-1 border border-line px-2 py-1 text-caption text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload strokeWidth={1.75} className="h-3.5 w-3.5" />
        )}
        Logo
      </button>
      {hasLogo && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await doClear(teamId);
                onUploaded();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't remove the logo.");
              }
            });
          }}
          className="w-full inline-flex items-center justify-center gap-1 border border-line px-2 py-1 text-caption text-ink-muted rounded-sm hover:border-danger hover:text-danger disabled:opacity-40"
        >
          <Trash2 strokeWidth={1.75} className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
      {error && <p className="text-caption text-danger leading-tight">{error}</p>}
    </div>
  );
}
