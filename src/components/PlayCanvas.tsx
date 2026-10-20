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
  paintSiteMechanics,
  paintTriggers,
  paintWalls,
  paintZones,
  strokeTrail,
  type FieldParticle,
  type RenderMode,
} from "@/lib/replay-paint";
import { drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import {
  SIM_TICK_MS,
  hasSiteMechanics,
  type SimGeometry,
  type SimPoint,
  type SiteTimeline,
} from "@/lib/replay-sim";
import { cn } from "@/lib/utils";

export interface PlayFrame {
  /** The live path; `path[0]` is the spawn and `path[i]` the pose after i ticks. */
  path: SimPoint[];
  /**
   * Tick each `path` point was sampled at (parallel to `path`). `path` is
   * frame-sampled, so this is not `0..path.length-1`; markers and any
   * per-tick geometry need it to place a path point on the right tick.
   */
  pathTicks?: number[];
  /**
   * The current physics tick. The render pose is `path[path.length-1]`, but a
   * frame may cover several ticks, so spinner angle and moving-block offsets
   * must use this, not `path.length - 1`.
   */
  tick?: number;
  /** The latest input symbol, for the HUD readout. */
  input?: number;
  ghostPath?: SimPoint[] | null;
  /** Tick markers (checkpoints/splits) to flag on the trail. */
  markers?: number[];
  /**
   * The site-only run timeline (switch fires, broken walls) so far, so the
   * canvas draws a door's open state or a broken wall live.
   */
  timeline?: SiteTimeline;
}

export interface PlayCanvasHandle {
  /** Repaint from the current `getFrame()` result. */
  redraw(): void;
  /** Multiply the live zoom by `factor`, clamped to a sane range. */
  zoomBy(factor: number): void;
  /** Zoom so the whole level fits the viewport, centred on its bounds. */
  fit(): void;
}

/** Axis-aligned world bounds of a level's obstacles, padded a little. */
function geometryBounds(geometry: SimGeometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const w of geometry.walls) {
    const half = w.thickness / 2;
    if (w.pivot && w.rotationSpeed) {
      const r = Math.max(
        Math.hypot(w.ax - w.pivot.x, w.ay - w.pivot.y),
        Math.hypot(w.bx - w.pivot.x, w.by - w.pivot.y),
      );
      add(w.pivot.x - r, w.pivot.y - r);
      add(w.pivot.x + r, w.pivot.y + r);
    } else {
      add(w.ax - half, w.ay - half);
      add(w.bx + half, w.by + half);
    }
  }
  for (const z of geometry.zones) {
    add(z.x0, z.y0);
    add(z.x1, z.y1);
  }
  for (const p of geometry.portals) {
    add(p.ax, p.ay);
    add(p.bx, p.by);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = 40;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
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
  // User zoom on top of the follow camera's speed-based zoom (1 = the camera's
  // own zoom). The follow camera owns `zoom`; this is a separate multiplier so
  // zooming in does not fight the dynamic-zoom easing.
  const zoomFactorRef = React.useRef(1);

  React.useImperativeHandle(
    ref,
    () => ({
      redraw: () => drawRef.current(),
      zoomBy: (factor: number) => {
        zoomFactorRef.current = Math.max(0.1, Math.min(20, zoomFactorRef.current * factor));
        drawRef.current();
      },
      fit: () => {
        const b = geometryBounds(propsRef.current.geometry);
        const parent = canvasRef.current?.parentElement;
        if (!b || !parent) return;
        const w = parent.clientWidth || window.innerWidth;
        const h = (fill ? parent.clientHeight : height) || window.innerHeight;
        const spanX = Math.max(1, b.maxX - b.minX);
        const spanY = Math.max(1, b.maxY - b.minY);
        // Express the fit as a multiple of the camera's base zoom so it holds
        // whether or not the follow camera is easing with speed.
        const base = settingsRef.current.zoom || 1;
        const desired = Math.min(w / spanX, h / spanY);
        zoomFactorRef.current = Math.max(0.1, Math.min(20, desired / base));
        drawRef.current();
      },
    }),
    [fill, height],
  );

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
      // The pose is the newest sample, but `path` is frame-sampled: a frame can
      // cover several physics ticks. Use the true tick for per-tick geometry
      // (spinner angle, moving blocks) or the drawn spinner lags the hitbox.
      const tick = frame.tick ?? path.length - 1;
      const pathTicks = frame.pathTicks;

      cameraRef.current.settings = settingsRef.current;
      const prev = path[Math.max(0, path.length - 2)] ?? p;
      const dt = SIM_TICK_MS / 1000;
      cameraRef.current.follow(p.x, p.y, (p.x - prev.x) / dt, (p.y - prev.y) / dt, dt);
      const cam = cameraRef.current;
      // The user's zoom multiplier scales the follow camera's own zoom, so a
      // manual zoom-in stays put while the camera eases with speed.
      scale = cam.zoom * zoomFactorRef.current;
      offX = width / 2 - cam.x * scale;
      offY = viewH / 2 - cam.y * scale;
      tx = (wx: number) => wx * scale + offX;
      ty = (wy: number) => wy * scale + offY;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07070b";
      ctx.fillRect(0, 0, width, viewH);
      // The visible world rect, padded so a wall just off screen (or its thick
      // stroke) does not pop. The painters cull against it: an endless course
      // has ~1400 walls but only a handful are ever on screen.
      const pad = 40;
      const view = {
        minX: (-offX) / scale - pad,
        maxX: (width - offX) / scale + pad,
        minY: (-offY) / scale - pad,
        maxY: (viewH - offY) / scale + pad,
      };
      paintZones(ctx, s.geometry, { tx, ty, scale, mode: s.mode, view });
      if (s.geometry.forceFields && s.geometry.forceFields.length > 0) {
        paintForceFields(
          ctx,
          s.geometry.forceFields,
          { tx, ty, scale, mode: s.mode, view },
          fieldParticles,
          performance.now() / 1000,
        );
      }
      if (s.geometry.triggers && s.geometry.triggers.length > 0) {
        paintTriggers(ctx, s.geometry.triggers, { tx, ty, scale, mode: s.mode, view });
      }
      paintWalls(ctx, s.geometry.walls, tick, {
        tx,
        ty,
        scale,
        mode: s.mode,
        motions: s.geometry.movingBlocks,
        view,
      });
      // Site-only puzzle mechanics, at the live tick and arrow position.
      if (hasSiteMechanics(s.geometry)) {
        paintSiteMechanics(
          ctx,
          s.geometry,
          tick,
          { tx, ty, scale, mode: s.mode, view },
          frame.timeline,
          p,
        );
      }

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
        for (const tickAt of frame.markers) {
          // Resolve the tick to its stamped path point: path is frame-sampled,
          // so index-by-tick would flag the wrong spot (or nothing) mid-run.
          const idx = pathTicks ? pathTicks.findIndex((t) => t >= tickAt) : tickAt;
          if (idx < 0) continue;
          const q = path[Math.min(idx, path.length - 1)];
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
        tick,
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
