import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Redesign buttons (handover Phase 2): Space Grotesk 600, no radius, 44px
// minimum touch target (52px at `lg`, used in bands). Primary and Discord
// carry the bottom-right 10px cut. Discord buttons are brand red with the
// Discord mark, never Discord blurple.
const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 font-heading font-semibold transition-colors duration-150 ease-out-soft disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-disabled disabled:border-transparent",
  {
    variants: {
      variant: {
        primary:
          "cut-btn bg-ds-red text-white hover:bg-brand-red-hover active:bg-brand-red-muted",
        // Outline on navy: 1px line-strong.
        secondary:
          "border border-ds-line-strong bg-transparent text-ds-text hover:border-ds-text",
        outline:
          "border border-ds-line-strong bg-transparent text-ds-text hover:border-ds-text",
        // Outline on red or blue panels: 1px white.
        "outline-light":
          "border border-white bg-transparent text-white hover:bg-white/10",
        ghost:
          "bg-transparent text-ds-text-muted hover:text-ds-text",
        discord:
          "cut-btn bg-ds-red text-white hover:bg-brand-red-hover active:bg-brand-red-muted",
        // KakaoTalk corporate yellow (#FEE500) with their conventional black
        // text. Hover step matches their official press kit hover spec.
        kakao:
          "bg-[#FEE500] text-[#181600] hover:bg-[#FDD835] active:bg-[#FBC02D]",
      },
      size: {
        sm: "px-4 py-2 text-ds-ui",
        md: "px-6 py-2 text-ds-ui",
        lg: "min-h-[52px] px-8 py-2 text-body-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
