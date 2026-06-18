import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 ease-out-soft disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-disabled disabled:border-transparent",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-red text-ink hover:bg-brand-red-hover active:bg-brand-red-muted rounded-md font-semibold",
        secondary:
          "border border-line-strong bg-transparent text-ink hover:border-brand-red rounded-md font-semibold",
        ghost:
          "bg-transparent text-ink-secondary hover:text-ink rounded-md",
        // Discord blurple. Hover shade matches Discord's own hover-on-button
        // treatment from their marketing site.
        discord:
          "bg-[#5865F2] text-white hover:bg-[#4752C4] active:bg-[#3C45A5] rounded-md font-semibold",
        // KakaoTalk corporate yellow (#FEE500) with their conventional black
        // text. Hover step matches their official press kit hover spec.
        kakao:
          "bg-[#FEE500] text-[#181600] hover:bg-[#FDD835] active:bg-[#FBC02D] rounded-md font-semibold",
      },
      size: {
        sm: "px-4 py-2 text-body-sm",
        md: "px-6 py-3 text-body-md",
        lg: "px-8 py-4 text-body-lg",
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
