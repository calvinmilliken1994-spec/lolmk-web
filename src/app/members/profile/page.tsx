import { permanentRedirect } from "next/navigation";

/** The profile editor moved into the Locker. */
export default function MemberProfileRedirect() {
  permanentRedirect("/locker");
}
