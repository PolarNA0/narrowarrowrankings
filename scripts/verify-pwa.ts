/**
 * PWA wiring is easy to break silently: a typo in the manifest path, an icon
 * that was never generated, or a service worker that caches API responses all
 * fail quietly in the browser and only surface as "offline is broken" later.
 *
 * These checks exercise the real files on disk and the real routing decisions
 * from `sw.js` (loaded into a stubbed service-worker global), not a re-implemented
 * copy of them.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

// --- The manifest parses and every icon it names exists on disk --------------
const manifestPath = join(ROOT, "public/manifest.webmanifest");
check("manifest exists", existsSync(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

check("manifest has a name", typeof manifest.name === "string" && manifest.name.length > 0);
check("manifest has a short_name", typeof manifest.short_name === "string");
check("manifest start_url is in scope", manifest.start_url.startsWith(manifest.scope));
check("manifest is standalone", manifest.display === "standalone");
check("manifest declares a theme_color", /^#[0-9a-f]{6}$/i.test(manifest.theme_color));
check("manifest declares a background_color", /^#[0-9a-f]{6}$/i.test(manifest.background_color));

const icons: { src: string; sizes: string; purpose?: string }[] = manifest.icons ?? [];
check("manifest lists icons", icons.length > 0);
for (const icon of icons) {
  check(
    `icon file exists: ${icon.src}`,
    existsSync(join(ROOT, "public", icon.src.replace(/^\//, ""))),
  );
}
// A maskable icon is required for Android to render the icon without a white
// plate behind it.
check(
  "manifest has a maskable icon",
  icons.some((i) => (i.purpose ?? "").split(/\s+/).includes("maskable")),
);
check(
  "manifest has a 512px any icon",
  icons.some((i) => i.sizes === "512x512" && !(i.purpose ?? "").includes("maskable")),
);

// Shortcuts must point at real view params, or the long-press menu opens a
// blank app. Read the ids from the nav definition itself so the check follows a
// rename instead of pinning a list that drifts out of date.
const navSource = readFileSync(join(ROOT, "src/components/GroupedNavigation.tsx"), "utf8");
const navMatch = navSource.match(/export const NAV_GROUPS = (\[[\s\S]*?\n\]) as const;/);
check("found NAV_GROUPS in source", navMatch !== null);
const navSandbox: Record<string, unknown> = {};
vm.createContext(navSandbox);
vm.runInContext(`globalThis.__nav = ${navMatch?.[1] ?? "[]"};`, navSandbox);
const navGroups = navSandbox.__nav as { items: { id: string }[] }[];
const viewIds = new Set(navGroups.flatMap((g) => g.items.map((i) => i.id)));
check("read real nav view ids", viewIds.size > 0, `${viewIds.size} ids`);

for (const shortcut of manifest.shortcuts ?? []) {
  const view = new URL(shortcut.url, "https://x").searchParams.get("v");
  check(
    `shortcut "${shortcut.name}" targets a real view`,
    view !== null && viewIds.has(view),
    view ?? "",
  );
}

// --- The icons are real PNGs of the size they claim --------------------------
function pngSize(path: string): { w: number; h: number } | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const isPng = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

for (const icon of icons) {
  const size = pngSize(join(ROOT, "public", icon.src.replace(/^\//, "")));
  check(`${icon.src} is a valid PNG`, size !== null);
  if (size) {
    check(
      `${icon.src} matches its declared size ${icon.sizes}`,
      `${size.w}x${size.h}` === icon.sizes,
      `${size.w}x${size.h}`,
    );
  }
}

// --- The service worker's routing rules -------------------------------------
// Load the real sw.js against a stub `self` so the fetch handler can be called
// directly and its cache decisions inspected.
const swSource = readFileSync(join(ROOT, "public/sw.js"), "utf8");
const listeners: Record<string, (event: unknown) => void> = {};
const precached: string[] = [];
const stored: string[] = [];

const cacheStub = {
  add: async (req: { url: string }) => {
    precached.push(typeof req === "string" ? req : req.url);
  },
  match: async () => undefined,
  put: async (req: { url: string }) => {
    stored.push(req.url);
  },
};
const cachesStub = {
  open: async () => cacheStub,
  keys: async () => [] as string[],
  delete: async () => true,
  match: async () => undefined,
};
const selfStub = {
  location: { origin: "https://narrowarrowrankings.lovable.app" },
  addEventListener: (type: string, handler: (event: unknown) => void) => {
    listeners[type] = handler;
  },
  skipWaiting: async () => undefined,
  clients: { claim: async () => undefined },
};

const sandbox = {
  self: selfStub,
  caches: cachesStub,
  fetch: async () => ({ ok: true, type: "basic", clone: () => ({}) }),
  Request: class {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  },
  Response: class {
    body: unknown;
    constructor(body: unknown) {
      this.body = body;
    }
  },
  URL,
  console,
};
vm.createContext(sandbox);
vm.runInContext(swSource, sandbox);

check("sw registers an install handler", typeof listeners.install === "function");
check("sw registers an activate handler", typeof listeners.activate === "function");
check("sw registers a fetch handler", typeof listeners.fetch === "function");

// Run install and confirm the shell assets (including the offline entry point)
// were pre-cached.
let installWork: Promise<unknown> | null = null;
listeners.install?.({ waitUntil: (p: Promise<unknown>) => (installWork = p) });
await installWork;
check(
  "sw precaches the app shell",
  precached.some((u) => u.endsWith("/")),
);
check(
  "sw precaches the manifest",
  precached.some((u) => u.includes("manifest.webmanifest")),
);
check(
  "sw precaches at least one icon",
  precached.some((u) => u.includes("/icons/")),
);

/** Drive the real fetch handler and report whether it called respondWith. */
function respondWithFor(url: string, mode = "no-cors"): unknown {
  let captured: unknown = null;
  const request = { method: "GET", url, mode };
  listeners.fetch?.({
    request,
    respondWith: (p: unknown) => (captured = p),
  });
  return captured;
}

const ORIGIN = "https://narrowarrowrankings.lovable.app";
const cases: [string, string, boolean, string][] = [
  ["navigation is handled", `${ORIGIN}/`, "navigate", true],
  ["hashed build asset is handled", `${ORIGIN}/assets/rust_bg-abc123.wasm`, "no-cors", true],
  ["_build asset is handled", `${ORIGIN}/_build/app.js`, "no-cors", true],
  ["icon is handled", `${ORIGIN}/icons/icon-192.png`, "no-cors", true],
  ["live API is NOT cached", `${ORIGIN}/api/all-leaderboards`, "no-cors", false],
  ["upstream proxy is NOT cached", `${ORIGIN}/api/leaderboard/0CFAEE35`, "no-cors", false],
  // The /api/ exclusion must take precedence over the asset rule: a route that
  // happens to look immutable (a .wasm suffix) is still live data, never cached.
  ["API path shaped like an asset is NOT cached", `${ORIGIN}/api/thing.wasm`, "no-cors", false],
  ["cross-origin is NOT handled", "https://api.narrowarrow.xyz/leaderboard", "no-cors", false],
  ["fonts are NOT handled", "https://fonts.googleapis.com/css2", "no-cors", false],
];

for (const [label, url, mode, shouldHandle] of cases) {
  const handled = respondWithFor(url, mode) !== null;
  check(label, handled === shouldHandle, handled ? "handled" : "passed through");
}

// A non-GET must never be intercepted (a cached POST would be a data bug).
let postHandled = false;
listeners.fetch?.({
  request: { method: "POST", url: `${ORIGIN}/api/tas-leaderboard/X`, mode: "cors" },
  respondWith: () => (postHandled = true),
});
check("POST is NOT intercepted", !postHandled);

console.log(`\n${failures === 0 ? "all" : `${failures} failing`} PWA checks`);
process.exit(failures === 0 ? 0 : 1);
