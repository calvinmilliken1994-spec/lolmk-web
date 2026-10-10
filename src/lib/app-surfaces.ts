/**
 * Routes that are tools or venue screens rather than public pages: the admin
 * desks, the live/venue screens and the captain dashboard. They use
 * full-screen fixed layouts, so site motion (route rise, section wipe) skips
 * them.
 */
const APP_SURFACE_PREFIXES = ["/tools", "/srlive", "/rblive", "/mayhemlive", "/captain"];

export function isAppSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return APP_SURFACE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
