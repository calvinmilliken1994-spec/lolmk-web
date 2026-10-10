"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";

/** The origin this page was opened from (so a QR points phones at a reachable host); "" until mounted. */
export function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/**
 * Scannable QR code as an inline SVG. Dark modules on a white tile with the
 * standard 4-module quiet zone, which phone cameras need even on a dark page.
 */
export function RbQrCode({ value, label, size = 160 }: { value: string; label: string; size?: number }) {
  const { path, dim } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return { path: d, dim: count + quiet * 2 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="flex-none bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

/** QR + the link it encodes, side by side. Shows the path alone until the origin is known. */
export function RbLinkQr({ path, label, description }: { path: string; label: string; description: string }) {
  const origin = useOrigin();
  const url = origin ? `${origin}${path}` : null;
  return (
    <div className="flex flex-wrap items-start gap-4">
      {url ? (
        <RbQrCode value={url} label={`QR code for ${label}`} />
      ) : (
        <div aria-hidden="true" className="h-40 w-40 flex-none border border-line-strong" />
      )}
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        <p className="text-[13px] text-ink-secondary">{description}</p>
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-[13px] text-link hover:text-ink"
        >
          {url ?? path}
        </a>
        <p className="text-[12px] text-ink-muted">The code uses the address you opened this page from.</p>
      </div>
    </div>
  );
}
