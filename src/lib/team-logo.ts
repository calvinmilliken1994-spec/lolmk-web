// Server-only module: imported exclusively from "use server" action files and
// server components. Not marked with the `server-only` package because the
// project does not depend on it; the `sharp` import alone already makes this
// unbundleable for the client.
import { put, del } from "@vercel/blob";
import sharp from "sharp";

/**
 * Team logo storage: validate → normalize → Vercel Blob → permanent URL.
 *
 * Two rules this module exists to enforce:
 *
 *  1. We never persist a third-party CDN URL (a Discord attachment link, an
 *     imgur hotlink, whatever the admin happened to paste). Those expire,
 *     rate-limit, or vanish when a message is deleted, and they leak the
 *     referrer of everyone who loads the public bracket. Every logo that
 *     reaches sr_teams.logo_url has been re-encoded by us and re-hosted on
 *     our own Blob store — see `assertOwnBlobUrl`, which is the check the
 *     write layer calls before any logo_url is stored.
 *
 *  2. Uploads are re-encoded, never passed through. `sharp` decoding and
 *     re-emitting the pixels drops EXIF/ICC payloads, polyglot file
 *     trailers, and anything else riding along inside a "png" — the bytes
 *     we store are bytes we generated.
 *
 * BLOB_READ_WRITE_TOKEN is injected automatically by Vercel once a Blob
 * store is attached to the project. Everything here degrades to a clean
 * "not configured" state when it is missing, rather than throwing at
 * import time or at render time.
 */

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB pre-resize
const MAX_DIMENSION = 8192;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const OUTPUT_SIZE = 256; // square px
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

/** sharp's container names for the MIME types in ACCEPTED. */
const DECODABLE = new Set(["png", "jpeg", "webp", "gif", "avif", "heif"]);

export const ACCEPTED_MIME_LIST = Array.from(ACCEPTED).join(",");
export const MAX_UPLOAD_MB = MAX_BYTES / (1024 * 1024);

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Vercel Blob public URLs live on `<storeId>.public.blob.vercel-storage.com`.
 * Rather than hardcoding a store id, accept any host under the
 * blob.vercel-storage.com apex — matched on the parsed URL's hostname, not
 * with a substring test, so `https://evil.com/?x=blob.vercel-storage.com`
 * cannot slip through.
 */
export function isOwnBlobUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return (
    url.hostname === "blob.vercel-storage.com" ||
    url.hostname.endsWith(".blob.vercel-storage.com")
  );
}

export function assertOwnBlobUrl(value: string): void {
  if (!isOwnBlobUrl(value)) {
    throw new Error("Team logos must be uploaded through this form, not linked from another site.");
  }
}

export interface LogoUploadResult {
  url: string;
}

/**
 * Validate, square-crop, re-encode and upload a logo. `keyPrefix` scopes the
 * blob path (e.g. `sr/<tournamentId>/<teamId>`); a random suffix is always
 * appended so a replacement never has to overwrite — the old blob is deleted
 * separately, after the new URL is safely persisted.
 */
export async function uploadTeamLogo(file: File, keyPrefix: string): Promise<LogoUploadResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error("Logo uploads aren't configured on this deployment (BLOB_READ_WRITE_TOKEN is unset).");
  }
  if (!file || file.size === 0) throw new Error("Choose an image file to upload.");
  if (file.size > MAX_BYTES) {
    throw new Error(`That image is too large — the limit is ${MAX_UPLOAD_MB} MB.`);
  }
  if (!ACCEPTED.has(file.type)) {
    throw new Error("Unsupported image type. Use PNG, JPEG, WebP, GIF or AVIF.");
  }

  const input = Buffer.from(await file.arrayBuffer());

  // Check what the bytes ACTUALLY are: file.type is just the browser-supplied
  // Content-Type of the multipart part and is fully attacker-controlled.
  // sharp's metadata comes from the real container.
  let output: Buffer;
  try {
    // Reading container metadata does not decode the raster. Inspect declared
    // dimensions first, then enforce sharp's decoder-level pixel ceiling on
    // the actual transform as defense in depth against decompression bombs.
    const meta = await sharp(input, { failOn: "error", limitInputPixels: false }).metadata();
    // Compare against sharp's own container names, not MIME subtypes: sharp
    // reports AVIF as "heif" (AVIF is a HEIF profile), so an
    // `image/${meta.format}` lookup against ACCEPTED would reject every real
    // AVIF upload.
    if (!meta.format || !DECODABLE.has(meta.format)) {
      throw new Error("That file isn't an image we can read.");
    }
    if (!meta.width || !meta.height || meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
      throw new Error(`That image's dimensions are too large (maximum ${MAX_DIMENSION} × ${MAX_DIMENSION}px).`);
    }
    if (meta.width * meta.height > MAX_INPUT_PIXELS) {
      throw new Error(`That image has too many pixels (maximum ${MAX_INPUT_PIXELS.toLocaleString("en-US")}).`);
    }
    output = await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // honour EXIF orientation before we discard the EXIF block
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 90 })
      .toBuffer();
  } catch (e) {
    // Surface our own validation messages; otherwise treat any sharp decode
    // failure as a bad upload rather than leaking library internals.
    if (e instanceof Error && (e.message.startsWith("That file isn't") || e.message.startsWith("That image"))) {
      throw e;
    }
    throw new Error("Couldn't read that image. Try a different file.");
  }

  const blob = await put(`${keyPrefix}.webp`, output, {
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
    token,
  });

  return { url: blob.url };
}

/** Best-effort cleanup of a superseded logo. Never throws — the new URL is already saved. */
export async function deleteTeamLogo(url: string | null): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token || !url || !isOwnBlobUrl(url)) return;
  try {
    await del(url, { token });
  } catch {
    /* orphaned blob is not worth failing a request over */
  }
}
