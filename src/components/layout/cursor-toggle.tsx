"use client";

import { useEffect, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lolmk-cursor";

export function CursorToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(document.documentElement.classList.contains("lolmk-cursor"));
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    document.documentElement.classList.toggle("lolmk-cursor", next);
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className="flex items-center gap-2 text-caption text-ink-muted hover:text-ink-secondary transition-colors"
    >
      <MousePointer2 strokeWidth={1.5} className="h-3.5 w-3.5" />
      <span>LoL cursor</span>
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          enabled ? "bg-brand-red" : "bg-line-subtle",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 transform rounded-full bg-ink transition-transform",
            enabled ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
