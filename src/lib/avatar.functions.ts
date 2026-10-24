/**
 * Storing a player's avatar.
 *
 * The browser downscales the picked photo to a small JPEG data URL
 * (`src/lib/avatar.ts`) and this uploads it with the service role, so no
 * storage policy has to be maintained for players to write their own file.
 * The path is derived from the caller's user id, so re-uploading replaces the
 * previous avatar instead of accumulating one file per attempt.
 *
 * The bucket is created on first use rather than by a migration: the storage
 * schema is owned by Supabase, not by this repo's migration set, so a migration
 * that inserts into `storage.buckets` would not be applied by the normal
 * deploy. Creating it lazily keeps the feature working on a fresh project.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "avatars";
const MAX_DATA_URL_BYTES = 2 * 1024 * 1024;

/**
 * Local dev has no service-role key, so storage is unreachable there (the same
 * reason the TAS/site boards keep an in-memory fallback). Rather than make the
 * picker fail with a confusing Supabase error, hand the caller the downscaled
 * data URL itself: the image still renders and the flow is exercisable end to
 * end. Production always has the key, so it always goes to storage.
 */
function useLocalAvatarFallback(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Parse `data:image/jpeg;base64,<payload>` into bytes. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("That image could not be read.");
  const [, contentType, payload] = match;
  const binary = atob(payload);
  if (binary.length > MAX_DATA_URL_BYTES) throw new Error("That image is too large.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

export const uploadAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dataUrl: string }) => {
    const dataUrl = String(input?.dataUrl ?? "");
    if (!dataUrl.startsWith("data:image/")) throw new Error("Pick an image first.");
    return { dataUrl };
  })
  .handler(async ({ data, context }) => {
    const { bytes, contentType } = decodeDataUrl(data.dataUrl);
    if (useLocalAvatarFallback()) return { url: data.dataUrl };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const extension =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `${context.userId}/avatar.${extension}`;

    // Idempotent: an existing bucket returns "already exists", so make sure it
    // is public either way — a bucket created by hand as private would hand
    // back a public URL that 403s.
    const { error: bucketError } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_DATA_URL_BYTES,
    });
    if (bucketError) {
      if (!/already exists|duplicate/i.test(bucketError.message)) {
        throw new Error(bucketError.message);
      }
      const { error: updateError } = await supabaseAdmin.storage.updateBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_DATA_URL_BYTES,
      });
      if (updateError) throw new Error(updateError.message);
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    // The path is stable across re-uploads, so bust the CDN cache with a stamp;
    // without it a new avatar can keep showing the previous image.
    return { url: `${publicUrl.publicUrl}?v=${Date.now()}` };
  });
