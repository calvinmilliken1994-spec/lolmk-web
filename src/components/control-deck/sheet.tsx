"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DeckKicker } from "./status";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand sheet over the desk (table score pad, clock adjust). Esc and the
 * backdrop close it; focus moves into it, Tab stays inside it, and focus
 * returns to whatever opened it. Mount it only while open.
 */
export function DeckSheet({
  kicker,
  title,
  onClose,
  children,
  className,
}: {
  kicker?: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-base/70"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-[min(560px,100vw)] flex-col gap-4 overflow-y-auto border-l border-line-strong bg-deck-rail p-5 outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {kicker && <DeckKicker className="text-brand-red-bright">{kicker}</DeckKicker>}
            <h2 className="mt-1 truncate font-heading text-[22px] font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 shrink-0 rounded-sm border border-line-strong bg-transparent px-3 text-[12px] text-ink-secondary hover:text-ink"
          >
            Close · Esc
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
