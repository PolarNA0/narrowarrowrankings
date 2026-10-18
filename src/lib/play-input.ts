/**
 * Input for the Play tab: turns keyboard, touch and gamepad state into the
 * engine's 4-symbol input model (0 coast, 1 right, 2 left, 3 brake). The engine
 * is binary — it reads `{left, right}` per 240Hz tick — so every source is
 * resolved down to those two booleans each tick, and an analog stick is
 * discretised against a deadzone rather than fed in as a magnitude.
 *
 * Symbol rules, matching the game and `replay.ts`:
 *   both steer directions held (or a dedicated brake) -> 3 (brake)
 *   left only  -> 2
 *   right only -> 1
 *   neither    -> 0
 */

export type PlayAction = "left" | "right" | "brake" | "restart" | "checkpoint";

export interface Keybinds {
  left: string;
  right: string;
  brake: string;
  restart: string;
  checkpoint: string;
}

export interface GamepadSettings {
  enabled: boolean;
  /** Analog stick whose x-axis steers; null falls back to the dpad. */
  steerAxis: number | null;
  /** |x| below this reads as neutral. */
  deadzone: number;
  /** Button index that brakes; null disables. */
  brakeButton: number | null;
  checkpointButton: number | null;
  restartButton: number | null;
}

export interface PlayInputSettings {
  keybinds: Keybinds;
  gamepad: GamepadSettings;
}

export const DEFAULT_INPUT_SETTINGS: PlayInputSettings = {
  keybinds: {
    left: "ArrowLeft",
    right: "ArrowRight",
    brake: "Space",
    restart: "KeyR",
    checkpoint: "KeyC",
  },
  gamepad: {
    enabled: true,
    steerAxis: 0,
    deadzone: 0.25,
    brakeButton: 0,
    checkpointButton: 3,
    restartButton: 1,
  },
};

const STORAGE_KEY = "naPlayInputSettings";

export function loadInputSettings(): PlayInputSettings {
  if (typeof window === "undefined") return DEFAULT_INPUT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INPUT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlayInputSettings>;
    return {
      keybinds: { ...DEFAULT_INPUT_SETTINGS.keybinds, ...(parsed.keybinds ?? {}) },
      gamepad: { ...DEFAULT_INPUT_SETTINGS.gamepad, ...(parsed.gamepad ?? {}) },
    };
  } catch {
    return DEFAULT_INPUT_SETTINGS;
  }
}

export function saveInputSettings(settings: PlayInputSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked — settings simply don't persist */
  }
}

/** Collapse the three held flags into the engine's symbol. Brake wins ties. */
export function symbolFromHeld(left: boolean, right: boolean, brake: boolean): number {
  if (brake || (left && right)) return 3;
  if (left) return 2;
  if (right) return 1;
  return 0;
}

export function resolveKeyboard(settings: PlayInputSettings, held: ReadonlySet<string>): number {
  const k = settings.keybinds;
  return symbolFromHeld(held.has(k.left), held.has(k.right), held.has(k.brake));
}

/** The action a key triggers, or null when it isn't bound to anything. */
export function actionForKey(settings: PlayInputSettings, code: string): PlayAction | null {
  const k = settings.keybinds;
  if (code === k.left) return "left";
  if (code === k.right) return "right";
  if (code === k.brake) return "brake";
  if (code === k.restart) return "restart";
  if (code === k.checkpoint) return "checkpoint";
  return null;
}

/**
 * Resolve the first connected pad to a symbol. The stick is compared against
 * the deadzone on its x-axis; a pad with no stick configured falls back to the
 * dpad (buttons 14/15) so a bare controller still works.
 */
export function resolveGamepad(
  settings: PlayInputSettings,
  pad: Gamepad | null | undefined,
): { symbol: number; brake: boolean; checkpoint: boolean; restart: boolean } {
  const g = settings.gamepad;
  if (!g.enabled || !pad) return { symbol: 0, brake: false, checkpoint: false, restart: false };

  let left = false;
  let right = false;
  if (g.steerAxis != null && pad.axes.length > g.steerAxis) {
    const x = pad.axes[g.steerAxis] ?? 0;
    if (x < -g.deadzone) left = true;
    else if (x > g.deadzone) right = true;
  } else {
    left = !!pad.buttons[14]?.pressed;
    right = !!pad.buttons[15]?.pressed;
  }

  const brake = g.brakeButton != null && !!pad.buttons[g.brakeButton]?.pressed;
  const checkpoint = g.checkpointButton != null && !!pad.buttons[g.checkpointButton]?.pressed;
  const restart = g.restartButton != null && !!pad.buttons[g.restartButton]?.pressed;
  return { symbol: symbolFromHeld(left, right, brake), brake, checkpoint, restart };
}

export function firstConnectedGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) {
    if (pad && pad.connected) return pad;
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Space: "Space",
  ShiftLeft: "L-Shift",
  ShiftRight: "R-Shift",
  ControlLeft: "L-Ctrl",
  ControlRight: "R-Ctrl",
};

/** Human-readable label for a `KeyboardEvent.code`, for the settings UI. */
export function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
