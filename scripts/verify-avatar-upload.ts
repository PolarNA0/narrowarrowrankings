/**
 * Verify the avatar data-URL decoder, which is the boundary that decides what
 * bytes can reach storage. A crafted data URL must not smuggle a non-image
 * payload or an oversized one through.
 */
import { decodeDataUrl } from "@/lib/avatar.functions";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// "Hello" in base64.
const PNG = "data:image/png;base64,SGVsbG8=";

console.log("decoding");
const png = decodeDataUrl(PNG);
check("content type is read", png.contentType === "image/png", png.contentType);
check("bytes decode to the original", new TextDecoder().decode(png.bytes) === "Hello");
check(
  "jpeg is accepted",
  decodeDataUrl("data:image/jpeg;base64,SGVsbG8=").contentType === "image/jpeg",
);
check(
  "webp is accepted",
  decodeDataUrl("data:image/webp;base64,SGVsbG8=").contentType === "image/webp",
);

console.log("\nrejections");
check(
  "an SVG is refused",
  throws(() => decodeDataUrl("data:image/svg+xml;base64,PHN2Zz4=")),
);
check(
  "an HTML document is refused",
  throws(() => decodeDataUrl("data:text/html;base64,PHNjcmlwdD4=")),
);
check(
  "a bare payload with no prefix is refused",
  throws(() => decodeDataUrl("SGVsbG8=")),
);
check(
  "a non-base64 encoding is refused",
  throws(() => decodeDataUrl("data:image/png,hello")),
);
check(
  "an empty string is refused",
  throws(() => decodeDataUrl("")),
);
check(
  "a payload over the size cap is refused",
  throws(() => decodeDataUrl("data:image/png;base64," + "A".repeat(3 * 1024 * 1024))),
);

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
