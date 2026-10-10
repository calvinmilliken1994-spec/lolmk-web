/**
 * Route transition (handover Phase 6). A template remounts on every
 * navigation, so the page content gets the default 200ms fade with an 8px
 * rise, while the header and footer (in the root layout) stay put. CSS only:
 * browsers without animation support, and reduced-motion users, just see the
 * page.
 *
 * Next 15.5's `experimental.viewTransition` flag was checked and left off:
 * see OPEN_QUESTIONS.md.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-ds-rise motion-reduce:animate-none">{children}</div>;
}
