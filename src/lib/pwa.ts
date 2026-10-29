/**
 * PWA plumbing: service-worker registration and install-prompt detection.
 *
 * Registration is production-only. In dev Vite rewrites modules on every edit,
 * so a cache-first worker would serve stale code and make edits look like they
 * did nothing.
 */

/** True when the app is already running as an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS and iPadOS Safari never fire `beforeinstallprompt`, so the only way in is
 * the Share sheet's "Add to Home Screen". Detect it to show those instructions
 * instead of a button that would never appear.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Register the service worker, in production only. Safe to call repeatedly. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  const register = () => {
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  };
  // Hydration can finish *after* the load event (the boards keep the page busy),
  // so waiting on `load` unconditionally would attach a listener that never
  // fires and the worker would never register. Register now if we are already
  // loaded, and otherwise wait for it.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
