/**
 * The Play tab's stage render mode, persisted so the choice sticks across
 * reloads. Split out of the view so the storage rule is testable without a
 * running game.
 *
 * "webgl" is the game's own renderer; "game" and "lines" are the site's 2D
 * canvas (see `PlayCanvas`). WebGL is the default because it is the render the
 * game itself draws, but a browser without WebGL2 keeps working — the canvas
 * shows an unsupported message rather than breaking the tab, and the user can
 * switch back to a 2D mode.
 */

export type PlayRenderMode = "webgl" | "game" | "lines";

const STORAGE_KEY = "naPlayRenderMode";

export const DEFAULT_PLAY_RENDER_MODE: PlayRenderMode = "webgl";

const MODES: PlayRenderMode[] = ["webgl", "game", "lines"];

/** Coerce an arbitrary value to a valid mode, or null when it is not one. */
export function asPlayRenderMode(value: unknown): PlayRenderMode | null {
  return typeof value === "string" && (MODES as string[]).includes(value)
    ? (value as PlayRenderMode)
    : null;
}

export function loadPlayRenderMode(): PlayRenderMode {
  if (typeof window === "undefined") return DEFAULT_PLAY_RENDER_MODE;
  try {
    return asPlayRenderMode(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_PLAY_RENDER_MODE;
  } catch {
    return DEFAULT_PLAY_RENDER_MODE;
  }
}

export function savePlayRenderMode(mode: PlayRenderMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage disabled (private mode); the choice just does not persist */
  }
}

export { STORAGE_KEY as PLAY_RENDER_MODE_STORAGE_KEY };
