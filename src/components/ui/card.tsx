import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  size?: "default" | "lg";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, size = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-surface border border-line",
        size === "default" ? "p-6" : "p-8",
        interactive &&
          "transition-all duration-200 ease-out-soft hover:border-line-strong hover:-translate-y-0.5",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-heading text-heading-lg text-ink", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-ink-secondary text-body-md", className)} {...props} />
  ),
);
CardBody.displayName = "CardBody";

export const CardKicker = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("font-sans text-label uppercase text-ink-muted", className)}
      {...props}
    />
  ),
);
CardKicker.displayName = "CardKicker";
