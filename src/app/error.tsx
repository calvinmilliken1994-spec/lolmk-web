"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/ds/page-header";
import { buttonVariants } from "@/components/ui/button";

/** Route-level error boundary (the site's 500 page). The header and footer stay. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageHeader
      tag="Error"
      title="Something broke."
      deck="This page hit an error on our side. Try again, and if it keeps happening, let an admin know in the Discord."
      actions={
        <button type="button" onClick={reset} className={buttonVariants({ variant: "primary", size: "md" })}>
          Try again
        </button>
      }
    />
  );
}
