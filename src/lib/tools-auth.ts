import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Temporary admin-tools login wall.
 *
 * Everything under /tools (except the landing page, login, and logout) is
 * gated by a single shared ID + password. The cookie value is
 * sha256("username:password") — knowing the cookie without the credentials
 * is useless, and rotating the password instantly invalidates every session.
 *
 * This is a stopgap: once Discord OAuth lands (assets/TOURNAMENT.md Phase 1),
 * replace it with the `Tournament Admin` role check and delete this file.
 */

export const TOOLS_COOKIE_NAME = "lolmk-tools";
export const TOOLS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface ToolsCredentials {
  username: string;
  password: string;
}

export function getToolsCredentials(): ToolsCredentials | null {
  const username = (process.env.TOOLS_ADMIN_USERNAME ?? "").trim();
  const password = (process.env.TOOLS_ADMIN_PASSWORD ?? "").trim();
  if (!username || !password) return null;
  return { username, password };
}

export function hashToolsCredentials(username: string, password: string): string {
  return createHash("sha256").update(`${username}:${password}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True when the request carries a valid admin-tools session cookie. */
export async function isToolsSession(): Promise<boolean> {
  const creds = getToolsCredentials();
  if (!creds) return false;
  const store = await cookies();
  const value = store.get(TOOLS_COOKIE_NAME)?.value;
  if (!value) return false;
  return safeEqualHex(value, hashToolsCredentials(creds.username, creds.password));
}
