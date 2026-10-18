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
import { FollowCamera, DEFAULT_GAME_CAMERA, type CameraSettings } from "@/lib/replay-render";
import {
  drawGameThrust,
  drawInputIndicator,
  paintWalls,
  paintZones,
  strokeTrail,
  type RenderMode,
} from "@/lib/replay-paint";
import { drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import { SIM_TICK_MS, type SimGeometry, type SimPoint } from "@/lib/replay-sim";

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
    let dpr = 1;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let tx = (x: number) => x;
    let ty = (y: number) => y;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
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
      offY = height / 2 - cam.y * scale;
      tx = (wx: number) => wx * scale + offX;
      ty = (wy: number) => wy * scale + offY;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07070b";
      ctx.fillRect(0, 0, width, height);
      paintZones(ctx, s.geometry, { tx, ty, scale, mode: s.mode });
      paintWalls(ctx, s.geometry.walls, path.length - 1, { tx, ty, scale, mode: s.mode });

      if (frame.ghostPath && frame.ghostPath.length > 1) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        strokeTrail(ctx, frame.ghostPath, frame.ghostPath.length - 1, s.ghostColor, false, {
          tx,
          ty,
          scale,
          mode: s.mode,
        });
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = 0.6;
      strokeTrail(ctx, path, path.length - 1, s.trailColor, false, { tx, ty, scale, mode: s.mode });
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

      drawInputIndicator(ctx, frame.input, width, height, { color: s.trailColor });
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
  }, [height]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-lg border border-border bg-[#07070b]"
      />
    </div>
  );
});
