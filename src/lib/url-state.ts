/**
 * Shareable URL state.
 *
 * The app keeps its selection in React state only, so a link to "the Energy
 * board on Blue Slides" or a player's profile could not be sent to anyone —
 * every visit landed on the default level. These helpers mirror a small,
 * whitelisted set of parameters into the query string (via `replaceState`, so
 * they never push a history entry) and read them back on first render.
 *
 * Only three things are shared, because they are what a link is *about*: which
 * view is open, which level it is on, and which player. Everything else (filters,
 * sort order, dialogs) is deliberately left out — those are session preferences,
 * not part of the thing being linked to.
 */

/** The subset of app state that is worth putting in a URL. */
export interface UrlState {
  view?: string;
  level?: string;
  player?: string;
  /** A site-hosted level's raw id, so a link can open it directly. */
  site?: string;
  /** The arrow a site level link should be played with. */
  arrow?: string;
}

const PARAM = {
  view: "v",
  level: "level",
  player: "player",
  site: "site",
  arrow: "arrow",
} as const;
const KEYS = ["view", "level", "player", "site", "arrow"] as const;

/** Build the query string for a state, omitting anything absent. */
function toQuery(state: UrlState): string {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = state[key];
    if (value) params.set(PARAM[key], value);
  }
  return params.toString();
}

/**
 * Read the shared state from the current URL. Called once to seed initial React
 * state, so a pasted link opens on the right view instead of the default.
 */
export function readUrlState(): UrlState {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: UrlState = {};
  for (const key of KEYS) {
    const value = params.get(PARAM[key]);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Mirror the current state into the URL.
 *
 * Navigating inside the app is a real navigation, so by default this pushes a
 * history entry — that is what makes the browser Back button walk back through
 * the views you visited instead of leaving the site. Pass `replace` for changes
 * that are not navigations (e.g. re-selecting a level within the same view),
 * so the back stack stays meaningful rather than one entry per click.
 *
 * `pushState` with the same URL would still add an entry, so a no-op change is
 * skipped entirely.
 */
export function writeUrlState(state: UrlState, options: { replace?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const query = toQuery(state);
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (options.replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
}

/**
 * The origin a *shared* link should use.
 *
 * A share link must point at a host anyone can open. The published site is
 * public, but a Lovable preview surface — the editor's iframe, an
 * `id-preview--…lovable.app` host, or a `*.lovableproject.com` sandbox — sits
 * behind a sign-in gate and answers everyone else with a 401. Copying a link
 * while the app is open in the editor would therefore bake that gated host into
 * the URL and send readers to a login wall instead of the level.
 *
 * So: on a preview/sandbox host, share the published site's origin instead of
 * the one we happen to be rendered on. A real deployment keeps its own origin,
 * and `VITE_PUBLIC_APP_URL` overrides both (e.g. a custom domain).
 */
const PUBLISHED_APP_ORIGIN = "https://narrowarrowrankings.lovable.app";

/** Hosts that serve the app only to a signed-in previewer. */
const PREVIEW_HOST_ZONES = [
  "lovableproject.com",
  "lovableproject-dev.com",
  "gpt-eng.com",
  "gptengineer.run",
];

function isGatedPreviewHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "lovable.app" ||
    host.startsWith("id-preview--") ||
    host.startsWith("project--") ||
    PREVIEW_HOST_ZONES.some((zone) => host === zone || host.endsWith(`.${zone}`))
  );
}

/** The origin a copied link should use — never a gated preview host. */
export function shareOrigin(): string {
  if (typeof window === "undefined") return "";
  const override = import.meta.env?.VITE_PUBLIC_APP_URL;
  if (override) return String(override).replace(/\/+$/, "");
  const host = window.location.hostname ?? "";
  return isGatedPreviewHost(host) ? PUBLISHED_APP_ORIGIN : window.location.origin;
}

/** The absolute URL for the current state, for a "Copy link" button. */
export function shareUrl(state: UrlState): string {
  if (typeof window === "undefined") return "";
  const query = toQuery(state);
  return `${shareOrigin()}${window.location.pathname}${query ? `?${query}` : ""}`;
}

/**
 * A link that opens a site-hosted level straight in Play. This is what the
 * "Copy link" button on a site level hands out, so pasting it into Discord or a
 * chat drops the reader into the level rather than the default board.
 */
export function siteLevelShareUrl(siteId: string, arrowName?: string): string {
  // No `level` param: a site level is not in the upstream level list, and
  // `site` alone is what Play resolves.
  return shareUrl({ view: "play", site: siteId, arrow: arrowName || undefined });
}
