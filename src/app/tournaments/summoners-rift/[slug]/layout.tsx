import { notFound } from "next/navigation";
import { getPublicTournamentBySlug } from "@/lib/sr-db";

/**
 * Existence check above the route's loading boundary, so an unknown, draft
 * or test slug gets a real 404 status. A notFound() thrown inside the
 * streamed page would arrive after a 200 was already sent.
 */
export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await getPublicTournamentBySlug(slug))) notFound();
  return children;
}
