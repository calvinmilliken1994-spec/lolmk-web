import { redirect } from "next/navigation";
import { LOCKER_LOGIN } from "@/components/locker/locker-content";
import { getMemberSession } from "@/lib/discord-auth";

/**
 * Sign-in gate above the Locker's loading boundary, so signed-out visitors
 * get a real 307 to Discord sign-in (returning to /locker) instead of a
 * streamed client-side redirect.
 */
export default async function LockerLayout({ children }: { children: React.ReactNode }) {
  if (!(await getMemberSession())) redirect(LOCKER_LOGIN);
  return children;
}
