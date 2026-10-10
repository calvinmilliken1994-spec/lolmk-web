import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ds/page-header";
import { buttonVariants } from "@/components/ui/button";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Page not found",
  description: "That page doesn't exist on LoLMK. It may have moved.",
  noindex: true,
});

export default function NotFound() {
  return (
    <PageHeader
      tag="404"
      title="Page not found."
      deck="That link is broken or the page has moved. Tournaments, guides and the members list are all one click away in the nav."
      actions={
        <Link href="/" className={buttonVariants({ variant: "primary", size: "md" })}>
          Back to the homepage
        </Link>
      }
    />
  );
}
