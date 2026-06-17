import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-2 px-2 py-1 text-label font-medium uppercase rounded-sm",
  {
    variants: {
      variant: {
        default: "bg-elevated text-ink-secondary",
        red: "bg-brand-red-muted text-brand-red-bright",
        blue: "bg-brand-blue-muted text-brand-blue-bright",
        success: "bg-success/20 text-success",
        warning: "bg-warning/20 text-warning",
        danger: "bg-danger/20 text-danger",
        outline: "border border-line-strong text-ink-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  pulse?: boolean;
}

export function Badge({ className, variant, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {pulse && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full animate-pulse-dot",
            variant === "red" || !variant ? "bg-brand-red-bright" : "bg-current",
          )}
        />
      )}
      {children}
    </span>
  );
}
