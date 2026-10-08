"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DeckRun } from "@/components/control-deck";

/** What every setup panel receives from the desk. */
export interface RbPanelProps<S> {
  state: S;
  run: DeckRun;
  pending: boolean;
}

/** Step panel on the right of the checklist: "STEP 2" kicker, title, content. */
export function RbPanel({
  kicker,
  title,
  children,
  className,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-[999_1_420px] flex-col gap-[18px] border border-line-strong bg-surface p-5",
        className,
      )}
    >
      <div>
        <p className="font-mono text-[11px] text-ink-muted">{kicker}</p>
        <h3 className="mt-0.5 font-heading text-[20px] font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export const rbInputClass =
  "h-[42px] w-full rounded-sm border border-line-strong bg-base px-3 font-mono text-[15px] text-ink placeholder:text-ink-disabled disabled:cursor-not-allowed disabled:text-ink-muted";

/** Secondary button (neutral border). */
export const rbButtonClass =
  "h-10 rounded-sm border border-line-strong bg-elevated px-4 text-[13.33px] text-ink hover:border-brand-blue-bright disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:border-line-strong";

/** The one red button in a panel. Brand red is reserved, so panels use it sparingly. */
export const rbSubmitClass =
  "h-10 rounded-sm border border-brand-blue-bright bg-brand-blue-muted px-4 text-[13.33px] text-ink hover:bg-brand-blue disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-transparent disabled:text-ink-disabled";

export function RbLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] text-ink-secondary">
      {children}
    </label>
  );
}

export function RbHint({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[12px] text-ink-muted", className)}>{children}</span>;
}

/** Why a setting is read-only. */
export function RbLockLine({ reason, className }: { reason: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-[12px] text-ink-secondary", className)}>
      <span className="border border-line-strong px-1.5 py-px font-mono text-[10px] tracking-[0.08em] text-ink-muted">
        LOCKED
      </span>
      {reason}
    </p>
  );
}

export interface RbSegmentOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Segmented control: a row of equal toggle buttons, selected one on brand-blue-muted. */
export function RbSegmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  columns,
}: {
  label: string;
  columns: 2 | 4;
  options: RbSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-ink-secondary" id={`seg-${label.replace(/\s+/g, "-").toLowerCase()}`}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`seg-${label.replace(/\s+/g, "-").toLowerCase()}`}
        className={cn("grid gap-1", columns === 2 ? "grid-cols-2" : "grid-cols-4")}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={selected}
              disabled={disabled || o.disabled}
              onClick={() => {
                if (!selected) onChange(o.value);
              }}
              className={cn(
                "h-10 rounded-sm border text-[13.33px] disabled:cursor-not-allowed",
                selected
                  ? "border-brand-blue-bright bg-brand-blue-muted text-ink"
                  : "border-line-strong bg-transparent text-ink-secondary hover:text-ink disabled:hover:text-ink-secondary",
                (disabled || o.disabled) && !selected && "text-ink-disabled",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
