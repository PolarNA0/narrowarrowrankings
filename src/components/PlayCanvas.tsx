/**
 * The Play tab's canvas: draws the live game with the same painters, camera and
 * colours the replay viewer uses, so a played run looks identical to a replay of
 * it.
 *
 * The simulation runs at 240Hz and the canvas repaints every animation frame,
 * neither of which should re-render React. So the component pulls the current
 * frame from a `getFrame` callback and repaints when the caller calls the
 * imperative `redraw()` — the caller owns the RAF loop, the `PlayGame` and the
 * input state.
 */

import * as React from "react";
import {
  FollowCamera,
  DEFAULT_GAME_CAMERA,
  GAME_COLLISION_COLOR,
  type CameraSettings,
} from "@/lib/replay-render";
import {
  drawGameThrust,
  drawInputIndicator,
  paintForceFields,
  paintWalls,
  paintZones,
  strokeTrail,
  type FieldParticle,
  type RenderMode,
} from "@/lib/replay-paint";
import { drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import { SIM_TICK_MS, type SimGeometry, type SimPoint } from "@/lib/replay-sim";
import { cn } from "@/lib/utils";

export interface PlayFrame {
  /** The live path; `path[0]` is the spawn and `path[i]` the pose after i ticks. */
  path: SimPoint[];
  /** The latest input symbol, for the HUD readout. */
  input?: number;
  ghostPath?: SimPoint[] | null;
  /** Tick markers (checkpoints/splits) to flag on the trail. */
  markers?: number[];
}

export interface PlayCanvasHandle {
  /** Repaint from the current `getFrame()` result. */
  redraw(): void;
}

export interface PlayCanvasProps {
  geometry: SimGeometry;
  getFrame: () => PlayFrame;
  arrow: ArrowKind;
  arrowRadius: number;
  bodyColor: string;
  tailColor: string;
  trailColor: string;
  ghostColor?: string;
  mode?: RenderMode;
  cameraSettings?: CameraSettings;
  className?: string;
  height?: number;
  /** Fill the parent's height instead of a fixed `height` (for fullscreen play). */
  fill?: boolean;
}

export const PlayCanvas = React.forwardRef<PlayCanvasHandle, PlayCanvasProps>(function PlayCanvas(
  {
    geometry,
    getFrame,
    arrow,
    arrowRadius,
    bodyColor,
    tailColor,
    trailColor,
    ghostColor = "rgba(148,163,184,0.5)",
    mode = "game",
    cameraSettings = DEFAULT_GAME_CAMERA,
    className,
    height = 460,
    fill = false,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const cameraRef = React.useRef(new FollowCamera(cameraSettings));
  const settingsRef = React.useRef(cameraSettings);
  settingsRef.current = cameraSettings;

  // The draw routine reads these through a ref so the mounted effect never has
  // to re-run (which would reset the camera and resize the canvas).
  const propsRef = React.useRef({
    geometry,
    getFrame,
    arrow,
    arrowRadius,
    bodyColor,
    tailColor,
    trailColor,
    ghostColor,
    mode,
  });
  propsRef.current = {
    geometry,
    getFrame,
    arrow,
    arrowRadius,
    bodyColor,
    tailColor,
    trailColor,
    ghostColor,
    mode,
  };

  const drawRef = React.useRef<() => void>(() => {});

  React.useImperativeHandle(ref, () => ({ redraw: () => drawRef.current() }), []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let viewH = height;
    let dpr = 1;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let tx = (x: number) => x;
    let ty = (y: number) => y;

    // Stable particle pool for wind/suction fields (site-authored levels only).
    const fieldParticles: FieldParticle[] = Array.from({ length: 64 }, () => ({
      seed: Math.random(),
      phase: Math.random(),
    }));

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (fill) {
        // In fullscreen the wrapper is `h-full`, so the parent carries the
        // overlay's height. Fall back to the viewport if layout has not settled
        // yet, otherwise the first paint would size to 0 and show black bars.
        width = parent.clientWidth || window.innerWidth;
        viewH = Math.max(1, parent.clientHeight || window.innerHeight);
      } else {
        width = parent.clientWidth;
        viewH = height;
      }
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(viewH * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${viewH}px`;
    };

    const draw = () => {
      if (!width) resize();
      const s = propsRef.current;
      const frame = s.getFrame();
      const path = frame.path;
      const p = path[path.length - 1];
      if (!p) return;

      cameraRef.current.settings = settingsRef.current;
      const prev = path[Math.max(0, path.length - 2)] ?? p;
      const dt = SIM_TICK_MS / 1000;
      cameraRef.current.follow(p.x, p.y, (p.x - prev.x) / dt, (p.y - prev.y) / dt, dt);
      const cam = cameraRef.current;
      scale = cam.zoom;
      offX = width / 2 - cam.x * scale;
      offY = viewH / 2 - cam.y * scale;
      tx = (wx: number) => wx * scale + offX;
      ty = (wy: number) => wy * scale + offY;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07070b";
      ctx.fillRect(0, 0, width, viewH);
      paintZones(ctx, s.geometry, { tx, ty, scale, mode: s.mode });
      if (s.geometry.forceFields && s.geometry.forceFields.length > 0) {
        paintForceFields(
          ctx,
          s.geometry.forceFields,
          { tx, ty, scale, mode: s.mode },
          fieldParticles,
          performance.now() / 1000,
        );
      }
      paintWalls(ctx, s.geometry.walls, path.length - 1, { tx, ty, scale, mode: s.mode });

      if (frame.ghostPath && frame.ghostPath.length > 1) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        strokeTrail(
          ctx,
          frame.ghostPath,
          frame.ghostPath.length - 1,
          s.ghostColor,
          false,
          { tx, ty, scale, mode: s.mode },
          { w: width, h: viewH },
        );
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = 0.6;
      // Clip to the viewport: the follow camera only shows the recent tail, so
      // walking back to the last on-screen point keeps the per-frame stroke
      // bounded instead of re-tracing the whole run from spawn every frame.
      strokeTrail(
        ctx,
        path,
        path.length - 1,
        s.trailColor,
        false,
        { tx, ty, scale, mode: s.mode },
        {
          w: width,
          h: viewH,
        },
      );
      ctx.restore();

      if (frame.markers?.length) {
        ctx.fillStyle = "#facc15";
        for (const tick of frame.markers) {
          const q = path[Math.min(tick, path.length - 1)];
          if (!q) continue;
          ctx.beginPath();
          ctx.arc(tx(q.x), ty(q.y), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      drawGameThrust(
        ctx,
        s.arrow,
        p.x,
        p.y,
        p.rot,
        s.arrowRadius,
        scale,
        tx,
        ty,
        p.thrustPower ?? 0,
        path.length - 1,
      );
      // The arrow's collision circle, drawn faintly under the sprite in game
      // mode so the true hitbox is visible (matches the replay stage).
      if (s.mode === "game") {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = GAME_COLLISION_COLOR;
        ctx.beginPath();
        ctx.arc(tx(p.x), ty(p.y), Math.max(2, s.arrowRadius * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = GAME_COLLISION_COLOR;
        ctx.lineWidth = Math.max(1.2, scale * 0.9);
        ctx.stroke();
        ctx.restore();
      }

      // `drawArrowSprite` takes screen px, so map the pose through tx/ty like
      // every other painter here. Passing world coords put the sprite at its raw
      // world position (top-left of the canvas) instead of on the arrow.
      drawArrowSprite(
        ctx,
        s.arrow,
        tx(p.x),
        ty(p.y),
        p.rot,
        scale,
        s.arrowRadius,
        s.bodyColor,
        s.tailColor,
      );

      drawInputIndicator(ctx, frame.input, width, viewH, { color: s.trailColor });
    };

    drawRef.current = draw;

    const onResize = () => {
      resize();
      draw();
    };
    resize();
    const observer = new ResizeObserver(onResize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    draw();

    return () => observer.disconnect();
  }, [height, fill]);

  return (
    <div className={cn(fill && "h-full w-full", className)}>
      <canvas
        ref={canvasRef}
        className={cn(
          "block w-full bg-[#07070b]",
          fill ? "h-full" : "rounded-lg border border-border",
        )}
      />
    </div>
  );
});
