import { cn } from "@/lib/utils";

/** Status dot. `pulse` is the live state; it stops under reduced motion. */
export function LiveDot({
  pulse = true,
  tone = "white",
  size = "md",
}: {
  pulse?: boolean;
  tone?: "white" | "grey";
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full",
        size === "sm" ? "h-[7px] w-[7px]" : "h-2.5 w-2.5",
        tone === "grey" ? "bg-ds-text-dim" : "bg-white",
        pulse && "animate-ds-pulse motion-reduce:animate-none",
      )}
    />
  );
}
