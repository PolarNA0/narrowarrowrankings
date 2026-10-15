/**
 * The game's own render palette and camera model, recovered from the compiled
 * Dart (`bCp` colours and the `Settings → Camera` presets). `ReplayStage`'s
 * "game" mode uses these so a replay reads like the real game, while its
 * "lines" mode keeps the older schematic look.
 *
 * The important correction over the first-pass colours in `replay-visuals.ts`:
 * the engine's `boost` zone is the game's GREEN zone and `ice` is the BLUE one
 * (the editor labels are the inverse), death walls are ORANGE, and steer zones
 * are yellow.
 */
import type { ArrowKind } from "@/lib/arrow-sprites";

/** Wall stroke colours, verbatim from the game. */
export const GAME_WALL_COLORS: Record<string, string> = {
  normal: "#ffffff",
  boost: "#1188ff",
  bouncy: "#33ff33",
  death: "#ff6611",
  finish: "#ffffff",
};

/** Zone fill colours (engine `zone_type` → the game's colour). */
export const GAME_ZONE_COLORS: Record<string, string> = {
  boost: "#00ff00",
  ice: "#5599ff",
  nosteer: "#ff0000",
  steer: "#ffeb3b",
  rail: "#b06aff",
};

/** Portal band colours: the game's magenta pair, keyed by the portal's side. */
export const GAME_PORTAL_COLORS: Record<string, string> = {
  a: "#ff4fd8",
  b: "#cc33ff",
};

/**
 * The collision circle is the game's default pure green (`C(1,0,1,0)`); a run's
 * skin never tints it, so neither do we.
 */
export const GAME_COLLISION_COLOR = "#00ff00";

/** Thrust flame colours per arrow, layered like the game's fire (outer, inner). */
export const GAME_THRUST_COLORS: Record<ArrowKind, [string, string]> = {
  narrow: ["#F4643C", "#FFD447"],
  speedy: ["#4fd1ff", "#eaffff"],
  energy: ["#b06aff", "#f0d0ff"],
};

/** The game draws the finish line as a black/white chequer this many world units thick. */
export const GAME_FINISH_THICKNESS = 32;
/** Default wall thickness when the level does not specify one. */
export const GAME_WALL_THICKNESS = 8;

export function gameWallColor(type: string): string {
  return GAME_WALL_COLORS[type] ?? GAME_WALL_COLORS.normal;
}

export function gameZoneColor(type: string): string {
  return GAME_ZONE_COLORS[type] ?? GAME_ZONE_COLORS.boost;
}

/** Whether a point in a `cell`-sized chequer grid is on a white square. */
export function checkerAt(along: number, across: number, cell: number): boolean {
  return (Math.floor(along / cell) + Math.floor(across / cell)) % 2 === 0;
}

/** Camera preset names, matching the game's `Settings → Camera` options. */
export type CameraPreset = "normal" | "smooth" | "locked";

export interface CameraSettings {
  preset: CameraPreset;
  /** Base world→px scale at rest. */
  zoom: number;
  /** How much the view widens as the arrow speeds up (0 = fixed). */
  dynamicZoom: number;
  zoomSmoothness: number;
  /** Look-ahead, in seconds of the arrow's velocity. */
  moveAhead: number;
  movementSmoothness: number;
}

/** The game's three camera presets. Selecting one fills the sliders. */
export const CAMERA_PRESETS: Record<CameraPreset, Omit<CameraSettings, "preset">> = {
  normal: { zoom: 1.9, dynamicZoom: 1.2, zoomSmoothness: 4, moveAhead: 2.5, movementSmoothness: 5 },
  smooth: { zoom: 2.1, dynamicZoom: 1.2, zoomSmoothness: 7, moveAhead: 3.5, movementSmoothness: 3 },
  locked: { zoom: 2.4, dynamicZoom: 0, zoomSmoothness: 4, moveAhead: 0, movementSmoothness: 7 },
};

export function cameraPreset(preset: CameraPreset): CameraSettings {
  return { preset, ...CAMERA_PRESETS[preset] };
}

export const DEFAULT_CAMERA = cameraPreset("normal");

/**
 * Follow camera matching the game's `Settings → Camera` options. Movement
 * Smoothness is the position-follow exponent and Zoom Smoothness the zoom
 * exponent; `locked` snaps the camera to the arrow at a fixed zoom. Speed is in
 * world units per second (the caller converts the per-tick step).
 */
export class FollowCamera {
  x = 0;
  y = 0;
  zoom: number;
  private tx = 0;
  private ty = 0;
  private tz: number;
  /** Live camera settings; assigning re-applies them without a reset. */
  settings: CameraSettings;

  constructor(settings: CameraSettings) {
    this.settings = settings;
    this.zoom = settings.zoom;
    this.tz = settings.zoom;
  }

  reset(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    this.zoom = this.settings.zoom;
    this.tz = this.settings.zoom;
  }

  /** Update the follow target from the arrow's position, heading and speed. */
  follow(x: number, y: number, vx: number, vy: number, dt: number) {
    const s = this.settings;
    this.tx = x + vx * s.moveAhead;
    this.ty = y + vy * s.moveAhead;
    const speed = Math.hypot(vx, vy);
    this.tz = s.zoom / (1 + speed * 0.0025 * s.dynamicZoom);
    if (s.preset === "locked") {
      this.x = this.tx;
      this.y = this.ty;
      this.zoom = this.tz;
      return;
    }
    const posK = 1 - Math.pow(0.0005, dt * (s.movementSmoothness / 5));
    const zoomK = 1 - Math.pow(0.0005, dt * (s.zoomSmoothness / 4));
    this.x += (this.tx - this.x) * posK;
    this.y += (this.ty - this.y) * posK;
    this.zoom += (this.tz - this.zoom) * zoomK;
  }
}
