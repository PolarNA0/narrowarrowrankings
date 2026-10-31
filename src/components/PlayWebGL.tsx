/**
 * Live WebGL stage for the Play tab.
 *
 * The replay viewer can step its own engine because it owns the run's input
 * string; the Play tab cannot, because the player's input arrives frame by
 * frame. So rather than re-simulate, this reads the *already-running* engine's
 * full state once per rendered frame and hands it to the game's own WebGL
 * renderer — the one difference from `GameCanvas`, which replays a run.
 *
 * `readFull()` parses the whole state string, so it is read once per frame
 * here, never per tick: the same budget the replay viewer spends.
 */
import * as React from "react";

import {
  GameRenderer,
  type GameArrowType,
  type GameBackground,
  ensureSkins,
  webgl2Available,
} from "@/lib/game-renderer";
import type { ArrowKind } from "@/lib/arrow-sprites";
import type { CameraSettings } from "@/lib/replay-render";
import type { EnginePlayerState } from "@/lib/replay-sim";
import type { PlayCanvasHandle } from "@/components/PlayCanvas";
import { cn } from "@/lib/utils";

export interface PlayWebGLProps {
  /** Reads the live engine state; called once per rendered frame. */
  getState: () => EnginePlayerState | null;
  /** The run's arrow: sprite, thrust palette and hitbox radius follow it. */
  arrow: ArrowKind;
  /** The trail so far, in world units, drawn as the game's ribbon. */
  getTrail: () => Array<{ x: number; y: number }>;
  background?: GameBackground;
  /** Show the collision hitbox, as the game and the 2D game render both do. */
  showHitbox?: boolean;
  /** The game camera model (preset + sliders), applied live. */
  cameraSettings?: CameraSettings;
  className?: string;
  height?: number;
  /** Fill the parent's height instead of a fixed `height` (fullscreen play). */
  fill?: boolean;
}

/** The arrow kind the game renderer wants, from the site's own kind. */
function toGameArrow(kind: ArrowKind): GameArrowType {
  if (kind === "speedy") return "speedy";
  if (kind === "energy") return "energy";
  return "narrow";
}

/**
 * A WebGL canvas that repaints from `getState()` every animation frame. It owns
 * its own RAF loop: the caller's loop drives the physics, this only draws.
 *
 * Exposes the same imperative handle the 2D `PlayCanvas` does, so the caller can
 * ask for a snapped repaint after a rewind in either render mode.
 */
export const PlayWebGL = React.forwardRef<PlayCanvasHandle, PlayWebGLProps>(function PlayWebGL(
  {
    getState,
    arrow,
    getTrail,
    background = "grid",
    showHitbox = true,
    cameraSettings,
    className,
    height = 440,
    fill = false,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rendererRef = React.useRef<GameRenderer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Set for one frame so the camera lands on the pose instead of easing. */
  const snapRef = React.useRef(false);

  React.useImperativeHandle(
    ref,
    () => ({
      redraw: () => {
        snapRef.current = false;
      },
      redrawSnapped: () => {
        snapRef.current = true;
      },
      // The WebGL camera owns its own zoom/preset model, so the 2D canvas's
      // manual zoom/fit have no equivalent here; they are inert no-ops.
      zoomBy: () => {},
      fit: () => {},
    }),
    [],
  );

  // Read through a ref so a prop change never tears down the GL context (which
  // would drop the skins and reset the camera).
  const propsRef = React.useRef({ getState, getTrail, arrow, background, showHitbox });
  propsRef.current = { getState, getTrail, arrow, background, showHitbox };
  const cameraSettingsRef = React.useRef(cameraSettings);
  cameraSettingsRef.current = cameraSettings;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!webgl2Available()) {
      setError("This browser does not support WebGL2, which the game renderer needs.");
      return;
    }

    let cancelled = false;
    let raf = 0;
    let renderer: GameRenderer | null = null;

    const frame = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(frame);
      if (!renderer) return;
      const p = propsRef.current;

      const parent = canvas.parentElement;
      const cssW = parent?.clientWidth || canvas.clientWidth || 640;
      const cssH = fill ? parent?.clientHeight || canvas.clientHeight || 360 : height;
      const size = renderer.resize(cssW, cssH);

      const state = p.getState();
      if (!state) return;
      const player = state.player;

      // A rewind asks for a snapped frame: land the camera on the arrow at once
      // instead of panning across the level.
      const snap = snapRef.current;
      snapRef.current = false;

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
          trail: p.getTrail(),
          arrowType: toGameArrow(p.arrow),
          background: p.background,
          showHitbox: p.showHitbox,
          snap,
        },
        size,
        now,
      );
    };

    (async () => {
      await ensureSkins();
      if (cancelled) return;
      renderer = new GameRenderer(canvas, { preset: "normal" });
      rendererRef.current = renderer;
      if (cameraSettingsRef.current) renderer.camera.applySettings({ ...cameraSettingsRef.current });
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
      renderer = null;
      rendererRef.current = null;
    };
  }, [fill, height]);

  // Apply the camera preset/sliders live, without rebuilding the GL context.
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer && cameraSettings) renderer.camera.applySettings({ ...cameraSettings });
  }, [cameraSettings]);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-white/10 bg-[#07070b] p-6 text-sm text-slate-400",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={cn("w-full block rounded-lg border border-white/10 bg-[#07070b]", className)}
      style={{ height: fill ? "100%" : height }}
    />
  );
});
