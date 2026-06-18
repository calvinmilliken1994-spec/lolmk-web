// Type declarations for CSS side-effect imports (e.g. `import "./globals.css"`).
//
// Next.js handles CSS imports at build time, so this file exists only to keep
// the TypeScript language server happy under strict mode (TS2882). Without
// it, the bare `import "./globals.css"` triggers:
//   "Cannot find module or type declarations for side-effect import…"
//
// Declared globally so any *.css in the project is recognised.
declare module "*.css";
