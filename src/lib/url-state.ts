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
}

const PARAM = { view: "v", level: "level", player: "player" } as const;

/**
 * Read the shared state from the current URL. Called once to seed initial React
 * state, so a pasted link opens on the right view instead of the default.
 */
export function readUrlState(): UrlState {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: UrlState = {};
  const view = params.get(PARAM.view);
  const level = params.get(PARAM.level);
  const player = params.get(PARAM.player);
  if (view) out.view = view;
  if (level) out.level = level;
  if (player) out.player = player;
  return out;
}

/**
 * Mirror the current state into the URL without adding a history entry. Values
 * that are absent are removed, so the URL stays clean rather than accumulating
 * empty parameters as the user navigates.
 */
export function writeUrlState(state: UrlState): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const key of ["view", "level", "player"] as const) {
    const value = state[key];
    if (value) params.set(PARAM[key], value);
    else params.delete(PARAM[key]);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, "", next);
}

/** The absolute URL for the current state, for a "Copy link" button. */
export function shareUrl(state: UrlState): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams();
  for (const key of ["view", "level", "player"] as const) {
    const value = state[key];
    if (value) params.set(PARAM[key], value);
  }
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
}
