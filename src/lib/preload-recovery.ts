/**
 * Stale-chunk recovery.
 *
 * Every deploy replaces the build's content-hashed chunk filenames. A client
 * that loaded the previous HTML — from a tab left open across a deploy, or from
 * the service worker's cached shell — still asks for the old names, which now
 * 404. A failed dynamic import (`React.lazy`, TanStack route splitting) rejects
 * before React ever mounts, so the page goes blank with no error boundary to
 * catch it.
 *
 * Vite fires a `vite:preloadError` event for exactly this case. Reloading once
 * fetches the current HTML (and therefore the current chunk names) and the page
 * recovers. The handler must be installed before the module graph starts
 * loading, so this ships as an inline script in the document head rather than
 * in a React effect — on a blank screen React never runs.
 *
 * The reload is guarded three ways so a genuinely broken deploy cannot put the
 * browser in a refresh loop: at most {@link MAX_RELOADS} attempts, and never
 * more than one per {@link COOLDOWN_MS}. The counter clears on a load that got
 * far enough to be considered healthy.
 */

/** Reloads allowed before we stop trying and let the error surface. */
const MAX_RELOADS = 3;

/** Minimum gap between recovery reloads, so a loop cannot spin the tab. */
const COOLDOWN_MS = 10_000;

const STORAGE_KEY = "na:preload-recovery";

/**
 * The inline script for the document head. Kept as a string because it must run
 * before any bundled module, and it is deliberately ES5-ish: it executes ahead
 * of the app's own polyfills and in whatever browser the visitor has.
 */
export const PRELOAD_RECOVERY_SCRIPT = `(function () {
  try {
    var KEY = ${JSON.stringify(STORAGE_KEY)};
    var MAX = ${MAX_RELOADS};
    var COOLDOWN = ${COOLDOWN_MS};
    var read = function () {
      try { return JSON.parse(window.sessionStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; }
    };
    var write = function (v) {
      try { window.sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    };
    var recover = function (event) {
      var state = read();
      var now = Date.now();
      var last = typeof state.at === "number" ? state.at : 0;
      var count = typeof state.count === "number" ? state.count : 0;
      if (count >= MAX || now - last < COOLDOWN) return false;
      if (event && event.preventDefault) event.preventDefault();
      write({ count: count + 1, at: now });
      window.location.reload();
      return true;
    };
    // Vite's own signal: a <link rel=modulepreload> or dynamic import failed.
    window.addEventListener("vite:preloadError", function (event) {
      // Prevent Vite's default behaviour (rethrow, which leaves the blank page).
      recover(event);
    });
    // Fallback for a chunk that fails outside Vite's helper — TanStack's route
    // loaders and any import() the bundler rewrote report the same way.
    var isStaleChunk = function (message) {
      return typeof message === "string" && (
        message.indexOf("Failed to fetch dynamically imported module") !== -1 ||
        message.indexOf("error loading dynamically imported module") !== -1 ||
        message.indexOf("Importing a module script failed") !== -1
      );
    };
    window.addEventListener("unhandledrejection", function (event) {
      var reason = event && event.reason;
      var message = reason && (reason.message || reason);
      if (isStaleChunk(message)) recover(event);
    });
    window.addEventListener("error", function (event) {
      if (isStaleChunk(event && event.message)) recover(event);
    });
    // A load that reaches this point is serving current chunks; forget past
    // failures so a later deploy gets its own fresh attempts.
    window.addEventListener("load", function () {
      var state = read();
      if (state.count) write({ count: 0, at: state.at || Date.now() });
    });
  } catch (e) {}
})();`;
