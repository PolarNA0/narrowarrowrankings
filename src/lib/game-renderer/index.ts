/**
 * Typed facade over the ported WebGL renderer.
 *
 * `gl.js` / `render.js` are a verbatim copy of the game's own renderer
 * (recovered from the APK v2.4.8 shaders), so they are plain JS. This module is
 * the single place the app touches them, which keeps the `any`-heavy boundary
 * in one file instead of leaking into the components.
 *
 * What is actually the game's here, versus the site's old 2D canvas: the
 * fragment shaders (walls, finish checker, portals, thrust, four backgrounds),
 * the camera model, and the arrow sprites. The physics was already the real
 * engine — `physics/rust_bg.wasm` is byte-identical to the one the game ships —
 * so this closes the last fidelity gap, the drawing.
 */
import { Renderer } from "./gl.js";
import {
  Camera,
  arrowSpriteHalf,
  drawArrow,
  drawLevel,
  drawTrajectory,
  drawWallEffects,
  loadSkins,
  skinFor,
  withColorOverrides,
} from "./render.js";

// The ported modules are verbatim game code and deliberately stay untyped
// (see renderer.d.ts), so the boundary types are derived from their declarations.
type RendererInstance = InstanceType<typeof Renderer>;
type CameraInstance = InstanceType<typeof Camera>;

/** Background shader variants the game ships. */
export type GameBackground = "grid" | "dots" | "circles" | "squares" | "none";

export type GameArrowType = "narrow" | "speedy" | "energy";

export interface RendererFrame {
  /** Engine pose, in world units (y down), with rotation already in radians. */
  player: {
    translation: { x: number; y: number };
    rotation: number;
    velocity?: { x: number; y: number };
    thrust_power?: number;
    constants?: { radius?: number };
  };
  /** The engine's live map, so rotating walls animate with the physics. */
  map: { obstacles?: unknown[] } | null | undefined;
  /** This tick's effects (wall contact + thrust) for the shader overlays. */
  effects?: unknown;
  /** Trail polyline in world units; the game's own fading ribbon. */
  trail?: Array<{ x: number; y: number }>;
  /** Run's arrow kind. */
  arrowType: GameArrowType;
  /** Background shader; `none` fills black. */
  background?: GameBackground;
  /**
   * Draw the collision hitbox (translucent disc + ring at the physics radius).
   * The game itself always draws it, and the 2D "game" render does too, so this
   * defaults to on; pass `false` only for a clean capture.
   */
  showHitbox?: boolean;
  /**
   * Land the camera on the arrow this frame instead of easing to it. Set on a
   * rewind (a restart or a checkpoint restore), where the pose jumps and an
   * eased pan would look like the arrow sliding across the level.
   */
  snap?: boolean;
  /**
   * Override the arrow's own colours (the viewer's colour pickers). Each field
   * is a hex string; an omitted field keeps the run's skin value, so a caller
   * can override just the trail. Without this the renderer uses the arrow's
   * default skin, which is why the colour controls had no effect in WebGL.
   */
  colors?: { body?: string; thrust?: string; trail?: string };
}

const ARROW_KINDS: GameArrowType[] = ["narrow", "speedy", "energy"];

/** Map a run's `arrow_name` (free text from the API) to a sprite kind. */
export function gameArrowType(arrowName: string | null | undefined): GameArrowType {
  const name = (arrowName ?? "").toLowerCase();
  if (name.includes("speedy")) return "speedy";
  if (name.includes("energy")) return "energy";
  return "narrow";
}

/** True when the browser can run the WebGL2 renderer at all. */
export function webgl2Available(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

let skinsPromise: Promise<void> | null = null;

/**
 * Load the three arrow sprites once. They are the game's own SVGs, so a failure
 * is not fatal: `drawArrow` simply skips the sprite and still draws the thrust
 * and hitbox.
 */
export function ensureSkins(): Promise<void> {
  if (!skinsPromise) skinsPromise = loadSkins().catch(() => undefined);
  return skinsPromise ?? Promise.resolve();
}

export class GameRenderer {
  private renderer: RendererInstance;
  readonly camera: CameraInstance;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement, opts: { preset?: string; zoom?: number } = {}) {
    this.renderer = new Renderer(canvas);
    this.camera = new Camera({ preset: opts.preset ?? "normal", zoom: opts.zoom });
  }

  /**
   * Match the backing store to the CSS box, capped the way the game does: the
   * scene is fill-rate bound (the background shader shades every pixel), so on
   * a large high-DPI display we would otherwise shade 3-4x the pixels for no
   * visible gain.
   */
  resize(cssWidth: number, cssHeight: number, pixelBudget = 1_600_000) {
    const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
    const scale = Math.min(dpr, Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight)));
    const w = Math.max(1, Math.round(cssWidth * scale));
    const h = Math.max(1, Math.round(cssHeight * scale));
    this.renderer.setSize(w, h);
    return { width: w, height: h };
  }

  /**
   * Draw one frame. `nowMs` is a wall-clock timestamp: the game's shaders are
   * time-driven (the background scrolls, portal particles and the finish
   * checker animate), so this is animation time, not simulation time.
   */
  draw(frame: RendererFrame, size: { width: number; height: number }, nowMs: number) {
    const { width: W, height: H } = size;
    const t = nowMs / 1000;
    const dt = this.lastTime ? Math.max(0, (nowMs - this.lastTime) / 1000) : 0;
    this.lastTime = nowMs;

    const skin = withColorOverrides(skinFor(frame.arrowType, null), frame.colors);
    const player = frame.player;

    // Follow before drawing so the first frame is already framed on the arrow,
    // rather than easing in from the origin. `snap` (a rewind) lands the camera
    // at once instead of panning across the level.
    this.camera.follow({
      translation: player.translation,
      velocity: player.velocity ?? { x: 0, y: 0 },
    });
    if (frame.snap) {
      // A huge dt makes the easing factors reach 1, so the camera lands exactly
      // on the target rather than panning there.
      this.camera.update(1e6);
    } else {
      this.camera.update(dt || 1 / 60);
    }

    drawLevel(this.renderer, frame.map, this.camera, W, H, t, frame.background ?? "grid");

    const effects = frame.effects;
    drawWallEffects(this.renderer, effects, frame.map, this.camera, W, H, t);

    if (frame.trail && frame.trail.length > 1) {
      drawTrajectory(this.renderer, frame.trail, this.camera, W, H, frame.arrowType, skin);
    }

    drawArrow(
      this.renderer,
      {
        translation: player.translation,
        rotation: player.rotation,
        velocity: player.velocity,
        thrust_power: player.thrust_power,
        constants: { radius: player.constants?.radius ?? 16 },
      },
      frame.arrowType,
      this.camera,
      W,
      H,
      t,
      1,
      effects,
      skin,
      frame.showHitbox !== false,
    );
  }

  /** Sprite half-extent for the given arrow, for hit-testing overlays. */
  spriteHalf(arrowType: GameArrowType, zoom = 1) {
    return arrowSpriteHalf(arrowType, zoom);
  }

  /**
   * Drop the GL context. The game's renderer has no teardown of its own, and a
   * context per mounted viewer adds up, so ask the extension to release it.
   */
  dispose() {
    const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

export { ARROW_KINDS };
