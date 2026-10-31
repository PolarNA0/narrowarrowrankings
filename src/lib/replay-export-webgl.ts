/**
 * WebGL frame source for the video exporter's "Game" mode.
 *
 * The interactive viewer already draws "Game" with the game's own WebGL
 * renderer; the exporter used the 2D painters instead, so an exported clip did
 * not match what the viewer showed. This steps a private replay engine one
 * *frame* at a time and draws each frame with the same `GameRenderer`, so the
 * clip uses the game's shaders (walls, finish checker, portals, thrust, the
 * animated background) exactly as the viewer does.
 *
 * The GL canvas is offscreen: the caller blits it onto the encode canvas and
 * then draws its own 2D overlays (ghosts, info card, timer, input dots) on top,
 * which keeps one code path for the HUD in both render modes.
 *
 * Time is derived from the tick (`tick * SIM_TICK_MS`) rather than the wall
 * clock, so the background animation and portals are reproducible frame for
 * frame — an offline export must not depend on how fast the machine is.
 */
import {
  GameRenderer,
  ensureSkins,
  gameArrowType,
  webgl2Available,
  type GameBackground,
} from "@/lib/game-renderer";
import { decodeInputSymbols } from "@/lib/replay";
import { SIM_TICK_MS, createReplayEngine, type RawLevelData } from "@/lib/replay-sim";
import type { CameraSettings } from "@/lib/replay-render";

export interface WebGLFrameSourceOptions {
  levelData: RawLevelData;
  inputs: string;
  inputCount?: number;
  arrowName?: string | null;
  width: number;
  height: number;
  background?: GameBackground;
  showHitbox?: boolean;
  camera?: CameraSettings;
  /** The run's path, in world units, drawn as the game's trail ribbon. */
  trail?: Array<{ x: number; y: number }>;
}

export interface WebGLFrameSource {
  /** Render the scene for `tick` into the offscreen GL canvas. */
  render(tick: number): void;
  /** The offscreen GL canvas, for the caller to blit onto the encode canvas. */
  canvas: HTMLCanvasElement;
  /** The live game camera, so 2D overlays can project to the same screen px. */
  camera: { x: number; y: number; zoom: number };
  dispose(): void;
}

/**
 * Build a frame source, or return null when WebGL2 or the engine is unavailable
 * so the caller can fall back to the 2D painters.
 */
export async function createWebGLFrameSource(
  opts: WebGLFrameSourceOptions,
): Promise<WebGLFrameSource | null> {
  if (typeof document === "undefined" || !webgl2Available()) return null;
  const symbols = opts.inputs ? decodeInputSymbols(opts.inputs, opts.inputCount) : [];
  if (symbols.length === 0) return null;

  await ensureSkins();
  const engine = await createReplayEngine(opts.levelData, opts.arrowName);
  if (!engine) return null;

  const canvas = document.createElement("canvas");
  const renderer = new GameRenderer(canvas, { preset: "normal" });
  if (opts.camera) renderer.camera.applySettings({ ...opts.camera });
  // Match the encode canvas exactly: the caller blits 1:1, and a mismatch would
  // either scale the scene or leave a black band. A pixel budget of exactly
  // width*height makes `resize` pick a scale of 1 (never the dpr), so the GL
  // backing store is the encode size in device px.
  const size = renderer.resize(opts.width, opts.height, opts.width * opts.height);

  const arrowType = gameArrowType(opts.arrowName);
  const fullTrail = opts.trail ?? [];
  let cursor = 0;
  let lastTick = -1;

  return {
    canvas,
    // Read live: the overlay projection must follow the camera the GL scene used
    // for this very frame.
    get camera() {
      return renderer.camera;
    },
    render(tick: number) {
      const target = Math.max(0, Math.min(Math.floor(tick), symbols.length));
      // Frames are monotonic, so step forward only; a rewind (never happens in
      // an export) would just clamp.
      while (cursor < target) {
        engine.stepCode(symbols[cursor]);
        cursor++;
      }
      const state = engine.readFull();
      const player = state.player;
      // `tick * SIM_TICK_MS` as the animation clock keeps the shaders' time
      // reproducible and in step with the physics.
      const nowMs = target * SIM_TICK_MS;
      const dt = lastTick < 0 ? 1 / 60 : (target - lastTick) * (SIM_TICK_MS / 1000);
      lastTick = target;

      renderer.draw(
        {
          player: {
            translation: player.translation,
            rotation: player.rotation,
            velocity: player.velocity ?? { x: 0, y: 0 },
            thrust_power: player.thrust_power,
            constants: { radius: player.constants?.radius ?? 16 },
          },
          map: state.map ?? null,
          effects: state.effects,
          trail: fullTrail.slice(0, target + 1),
          arrowType,
          background: opts.background ?? "grid",
          showHitbox: opts.showHitbox !== false,
        },
        size,
        nowMs,
      );
      // `dt` is unused because `GameRenderer.draw` derives it from `nowMs`; kept
      // local so a future caller can pace a variable-rate export if needed.
      void dt;
    },
    dispose() {
      renderer.dispose();
      engine.free();
    },
  };
}
