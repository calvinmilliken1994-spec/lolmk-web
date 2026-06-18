import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our tailwind.config.ts defines custom fontSize tokens (display-xl, body-lg,
// etc.). Without telling tailwind-merge about them, it can't distinguish
// `text-body-lg` (size) from `text-[#181600]` (color) — they both start with
// `text-` so it dedupes them as if they were conflicting colors and drops
// whichever appears earlier in the class string. Registering them as the
// "font-size" group fixes that everywhere `cn()` is used.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-xl",
            "display-lg",
            "display-md",
            "display-sm",
            "heading-lg",
            "heading-md",
            "heading-sm",
            "body-lg",
            "body-md",
            "body-sm",
            "label",
            "caption",
            "score",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
