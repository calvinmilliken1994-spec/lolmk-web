"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal hover/focus/keyboard-accessible tooltip. No Radix dependency in
 * this repo yet, and a single extra primitive isn't worth adding one for.
 *
 * - Shows on mouse hover AND keyboard focus (reachable without a pointer).
 * - Escape dismisses it without losing focus on the trigger.
 * - Wired to the trigger via aria-describedby, not just visually adjacent.
 * - Clamped horizontally on open so it never clips off-screen at the
 *   viewport edges (checked with actual measured geometry, not guessed).
 * - The tooltip text is always supplementary: every control this wraps
 *   also has a visible label, so nothing critical is tooltip-only.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  /** Extra classes on the wrapping span — pass e.g. "w-full" when the child is a full-width button. */
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) {
      setShiftX(0);
      return;
    }
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) {
      shift = window.innerWidth - margin - rect.right;
    }
    if (shift !== 0) setShiftX(shift);
  }, [open]);

  const trigger =
    isValidElement(children) ?
      cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": open ? id : undefined,
        onKeyDown: (e: React.KeyboardEvent) => {
          (children as ReactElement<{ onKeyDown?: (e: React.KeyboardEvent) => void }>).props.onKeyDown?.(e);
          if (e.key === "Escape") close();
        },
      })
    : children;

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocus={() => setOpen(true)}
      onBlur={close}
    >
      {trigger}
      {open && (
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 w-max max-w-[16rem] rounded-sm border border-line-strong bg-elevated px-2.5 py-1.5 text-caption text-ink-secondary shadow-lg",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
