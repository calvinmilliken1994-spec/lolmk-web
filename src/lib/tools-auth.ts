/**
 * Admin-tools authentication.
 *
 * Formerly a shared ID+password cookie wall (see git history for
 * TOOLS_ADMIN_USERNAME/PASSWORD if you need the old implementation). Now
 * backed entirely by Discord OAuth — see discord-auth.ts for the real
 * implementation. This file re-exports the same isToolsSession() signature
 * so every existing server action/page that gated on it keeps working
 * unchanged.
 */
export { isToolsSession, getCurrentAdmin, isDiscordAuthConfigured } from "@/lib/discord-auth";
