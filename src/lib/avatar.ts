/**
 * Turning a picked photo into an avatar.
 *
 * The file input opens the device's own picker (gallery or camera on mobile),
 * so a player never has to host an image somewhere and paste a URL. The image
 * is downscaled and re-encoded in the browser before it leaves the device: a
 * modern phone photo is several megabytes and far larger than the ~100px it is
 * ever displayed at, so uploading it untouched would waste the player's data
 * and the storage budget.
 */

/** Longest edge of the stored avatar. Enough for a 2x retina card. */
export const AVATAR_MAX_EDGE = 512;

/** Refuse absurd inputs before doing any decoding work. */
export const AVATAR_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class AvatarError extends Error {}

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

/**
 * Downscale and re-encode a picked image as a JPEG data URL.
 *
 * Uses an `<img>` + object URL rather than `createImageBitmap`, which is not
 * available on older mobile Safari — the browser this most needs to work on.
 */
export function fileToAvatarDataUrl(file: File, maxEdge = AVATAR_MAX_EDGE): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isAcceptedImage(file)) {
      reject(new AvatarError("Pick a PNG, JPEG, WebP or GIF image."));
      return;
    }
    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      reject(new AvatarError("That image is too large — pick one under 12 MB."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const done = (fn: () => void) => {
      URL.revokeObjectURL(objectUrl);
      fn();
    };

    image.onload = () =>
      done(() => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new AvatarError("This browser cannot process images.");
          ctx.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } catch (err) {
          reject(err instanceof Error ? err : new AvatarError("Could not read that image."));
        }
      });

    image.onerror = () => done(() => reject(new AvatarError("That file is not a readable image.")));

    image.src = objectUrl;
  });
}
