/**
 * A stale-chunk deploy must not leave a blank screen.
 *
 * Every deploy replaces the content-hashed chunk filenames, so a client holding
 * the previous HTML asks for chunks that no longer exist; the failed dynamic
 * import rejects before React mounts. `PRELOAD_RECOVERY_SCRIPT` listens for
 * Vite's `vite:preloadError` (plus the browser's own dynamic-import failures)
 * and reloads once.
 *
 * This drives the real script against a stubbed `window`, so the guard that
 * stops a broken deploy from reload-looping is exercised rather than described.
 */
import { PRELOAD_RECOVERY_SCRIPT } from "@/lib/preload-recovery";

let failures = 0;
const check = (label: string, ok: boolean, extra?: string) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures++;
};

interface FakeWindow {
  listeners: Record<string, Array<(e: unknown) => void>>;
  reloads: number;
  sessionStorage: Storage;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  location: { reload(): void };
}

/** Install the recovery script against a fresh fake window. */
function install(): FakeWindow {
  const store = new Map<string, string>();
  const win: FakeWindow = {
    listeners: {},
    reloads: 0,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage,
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    location: {
      reload() {
        win.reloads++;
      },
    },
  };
  (globalThis as { window?: unknown }).window = win;
  // eslint-disable-next-line no-new-func
  new Function(PRELOAD_RECOVERY_SCRIPT)();
  return win;
}

const fire = (win: FakeWindow, type: string, event: unknown = {}) => {
  for (const fn of win.listeners[type] ?? []) fn(event);
};

/** Rewind the cooldown without touching the attempt count. */
const clearCooldown = (win: FakeWindow) => {
  const raw = JSON.parse(win.sessionStorage.getItem("na:preload-recovery") ?? "{}");
  win.sessionStorage.setItem(
    "na:preload-recovery",
    JSON.stringify({ count: raw.count ?? 0, at: 0 }),
  );
};

// --- Vite's own signal reloads once ------------------------------------------
{
  const win = install();
  let prevented = false;
  fire(win, "vite:preloadError", {
    preventDefault() {
      prevented = true;
    },
  });
  check("a preload error triggers one reload", win.reloads === 1, `reloads=${win.reloads}`);
  check("the default (blank-page) behaviour is prevented", prevented);
}

// --- A reload loop is impossible ---------------------------------------------
{
  const win = install();
  for (let i = 0; i < 10; i++) fire(win, "vite:preloadError", { preventDefault() {} });
  check("repeated failures do not reload-loop", win.reloads === 1, `reloads=${win.reloads}`);
}

// --- A healthy load clears the counter ---------------------------------------
{
  const win = install();
  fire(win, "vite:preloadError", { preventDefault() {} });
  fire(win, "load");
  const raw = JSON.parse(win.sessionStorage.getItem("na:preload-recovery") ?? "{}");
  check("a healthy load resets the attempt count", raw.count === 0, `count=${raw.count}`);
  // The cooldown still applies, so a failure in the same instant does not
  // reload again; once it lapses the fresh budget is available.
  fire(win, "vite:preloadError", { preventDefault() {} });
  check("the cooldown still gates an immediate retry", win.reloads === 1, `reloads=${win.reloads}`);
  clearCooldown(win);
  fire(win, "vite:preloadError", { preventDefault() {} });
  check("a later failure reloads again", win.reloads === 2, `reloads=${win.reloads}`);
}

// --- The hard cap still applies within a session ------------------------------
{
  const win = install();
  for (let i = 0; i < 5; i++) {
    fire(win, "vite:preloadError", { preventDefault() {} });
    clearCooldown(win);
  }
  check("the attempt cap stops a persistent loop", win.reloads === 3, `reloads=${win.reloads}`);
}

// --- The browser's own dynamic-import failures are covered --------------------
{
  const win = install();
  fire(win, "unhandledrejection", {
    reason: new Error("Failed to fetch dynamically imported module: /assets/App-abc123.js"),
  });
  check(
    "an unhandled dynamic-import rejection reloads",
    win.reloads === 1,
    `reloads=${win.reloads}`,
  );
}
{
  const win = install();
  fire(win, "error", { message: "Importing a module script failed." });
  check("a module-script error event reloads", win.reloads === 1, `reloads=${win.reloads}`);
}

// --- An unrelated error is left alone ----------------------------------------
{
  const win = install();
  fire(win, "unhandledrejection", { reason: new Error("Network request failed") });
  fire(win, "error", { message: "Cannot read properties of undefined" });
  check("an unrelated error does not reload", win.reloads === 0, `reloads=${win.reloads}`);
}

// --- The inline script must not depend on the module graph --------------------
const codeOnly = PRELOAD_RECOVERY_SCRIPT.replace(/\/\/[^\n]*/g, "").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
check(
  "the script is self-contained (no import/require)",
  !/\bimport\s|\brequire\s*\(/.test(codeOnly),
);
check("the script guards its own failures", PRELOAD_RECOVERY_SCRIPT.includes("catch (e)"));

console.log(
  failures === 0 ? "\nall preload-recovery checks passed" : `\n${failures} check(s) FAILED`,
);
if (failures > 0) process.exit(1);
