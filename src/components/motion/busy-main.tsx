"use client";

import { useEffect } from "react";

/** Marks <main> aria-busy while a route's loading.tsx is on screen. */
export function BusyMain() {
  useEffect(() => {
    const main = document.querySelector("main");
    main?.setAttribute("aria-busy", "true");
    return () => main?.removeAttribute("aria-busy");
  }, []);
  return null;
}
