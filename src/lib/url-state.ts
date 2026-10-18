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

const KEYS = ["view", "level", "player"] as const;

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
  const view = params.get(PARAM.view);
  const level = params.get(PARAM.level);
  const player = params.get(PARAM.player);
  if (view) out.view = view;
  if (level) out.level = level;
  if (player) out.player = player;
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

/** The absolute URL for the current state, for a "Copy link" button. */
export function shareUrl(state: UrlState): string {
  if (typeof window === "undefined") return "";
  const query = toQuery(state);
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
}
