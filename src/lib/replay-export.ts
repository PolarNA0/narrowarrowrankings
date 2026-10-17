/**
 * Offline replay → video export.
 *
 * Renders a replay frame by frame onto an offscreen canvas and records it with
 * `MediaRecorder`, so a run can be saved as a shareable clip. Everything the
 * interactive stage can show is available here too: the schematic "lines" look
 * or the game render, the follow camera (with the game's own presets and
 * sliders) or a fixed whole-level fit, a custom arrow colour, and optional
 * side-by-side ghosts.
 *
 * The recorder samples the canvas at `fps` in real time, so the clip's length
 * matches the run's. Frames are paced off wall-clock time rather than a fixed
 * counter, which keeps the duration honest even if a frame renders slowly.
 */
import {
  FollowCamera,
  cameraPreset,
  type CameraPreset,
  type CameraSettings,
} from "@/lib/replay-render";
import {
  drawCollisionCircle,
  drawGameThrust,
  drawInputIndicator,
  drawSprite,
  paintWalls,
  paintZones,
  strokeTrail,
  type PaintCtx,
  type RenderMode,
} from "@/lib/replay-paint";
import { SIM_TICK_MS, type SimGeometry, type SimResult } from "@/lib/replay-sim";
import { lighten, withAlpha } from "@/lib/replay-visuals";
import type { ArrowKind } from "@/lib/arrow-sprites";

/** How the camera frames the run. */
export type ExportCameraMode = "follow" | "fit";

export interface ExportGhost {
  sim: SimResult;
  color: string;
  arrow: ArrowKind;
  arrowRadius: number;
  label?: string;
}

export interface ExportOptions {
  sim: SimResult;
  geometry: SimGeometry;
  mode: RenderMode;
  /** Output size in CSS px; the canvas is scaled by `dpr` for crisp text. */
  width: number;
  height: number;
  fps: number;
  /** Follow the arrow with the game camera, or fit the whole level. */
  cameraMode: ExportCameraMode;
  camera: CameraSettings;
  arrow: ArrowKind;
  arrowRadius: number;
  bodyColor: string;
  trail: string;
  thrust: string;
  /** Page background; the game render uses near-black, the lines look too. */
  background: string;
  /**
   * Draw the in-game steer-dot readout (two dots that light as the run steers)
   * in the corner of the frame.
   */
  showInputs?: boolean;
  ghosts?: ExportGhost[];
  dpr?: number;
  /** Reports 0..1 as the clip records. */
  onProgress?: (fraction: number) => void;
}

/** The first recorder MIME type the browser will accept. */
export function pickVideoMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Whether this browser can record a canvas at all. */
export function canExportVideo(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickVideoMimeType() !== null
  );
}

/** `#rrggbb` for a hue/saturation/lightness triple, for the colour pickers. */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Renders one replay frame onto `ctx`, given the level, the current camera pose
 * and the render mode. Shared by every exported frame so the whole clip is
 * consistent, and it mirrors the interactive stage's own draw order.
 */
function renderScene(
  ctx: CanvasRenderingContext2D,
  frame: number,
  opts: ExportOptions,
  camera: FollowCamera | null,
  dpr: number,
) {
  const { sim, geometry, mode, width, height } = opts;
  const upto = Math.max(0, Math.min(Math.floor(frame), sim.path.length - 1));

  // World bounds come from the level, the run and any ghosts, so a fixed "fit"
  // camera always frames everything.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of geometry.walls) {
    const half = (w.thickness || 8) / 2;
    minX = Math.min(minX, Math.min(w.ax, w.bx) - half);
    maxX = Math.max(maxX, Math.max(w.ax, w.bx) + half);
    minY = Math.min(minY, Math.min(w.ay, w.by) - half);
    maxY = Math.max(maxY, Math.max(w.ay, w.by) + half);
  }
  for (const z of geometry.zones) {
    minX = Math.min(minX, z.x0);
    minY = Math.min(minY, z.y0);
    maxX = Math.max(maxX, z.x1);
    maxY = Math.max(maxY, z.y1);
  }
  for (const p of sim.path) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  for (const g of opts.ghosts ?? []) {
    for (const p of g.sim.path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 40;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  let scale: number;
  let offX: number;
  let offY: number;
  if (opts.cameraMode === "follow" && camera) {
    scale = camera.zoom;
    offX = width / 2 - camera.x * scale;
    offY = height / 2 - camera.y * scale;
  } else {
    scale = Math.min(width / spanX, height / spanY);
    offX = (width - spanX * scale) / 2 - minX * scale;
    offY = (height - spanY * scale) / 2 - minY * scale;
  }
  const tx = (x: number) => x * scale + offX;
  const ty = (y: number) => y * scale + offY;
  const pc: PaintCtx = { tx, ty, scale, mode };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, width, height);

  paintZones(ctx, geometry, pc);
  paintWalls(ctx, geometry.walls, upto, pc);

  for (const g of opts.ghosts ?? []) {
    const gp = g.sim.path;
    if (gp.length < 2) continue;
    const gUpto = Math.max(0, Math.min(upto, gp.length - 1));
    ctx.save();
    ctx.globalAlpha = 0.5;
    strokeTrail(ctx, gp, gUpto, g.color, false, pc);
    ctx.restore();
    const p = gp[gUpto];
    ctx.save();
    ctx.globalAlpha = 0.6;
    drawSprite(ctx, g.arrow, tx(p.x), ty(p.y), p.rot, scale, g.arrowRadius, g.color, g.color);
    ctx.restore();
    if (g.label) {
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillStyle = g.color;
      ctx.fillText(g.label, tx(p.x) + 9, ty(p.y) - 9);
    }
  }

  strokeTrail(ctx, sim.path, upto, opts.trail, mode === "game", pc);
  const point = sim.path[upto];
  if (point) {
    if ((point.thrustPower ?? 0) > 0.05) {
      drawGameThrust(ctx, opts.arrow, point.x, point.y, point.rot, opts.arrowRadius, scale, tx, ty);
    }
    if (mode === "game") {
      drawCollisionCircle(ctx, point.x, point.y, opts.arrowRadius, scale, tx, ty);
    }
    drawSprite(
      ctx,
      opts.arrow,
      tx(point.x),
      ty(point.y),
      point.rot,
      scale,
      opts.arrowRadius,
      opts.bodyColor,
      opts.thrust,
    );
  }

  if (sim.finishTick !== null && upto >= sim.finishTick) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillText("FINISH", 10, 18);
  }

  if (opts.showInputs) {
    // The indicator is drawn in CSS px like the rest of the scene (the base
    // transform already carries `dpr`), so its size is resolution-independent.
    drawInputIndicator(ctx, point?.input, width, height);
  }
}

/** A readable filename stem for the download, e.g. `Red-Velocity-speedy`. */
export function exportFileName(levelName: string | undefined, arrow: string): string {
  const base = (levelName || "replay")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base || "replay"}-${arrow.replace(/\s+/g, "-").toLowerCase()}`;
}

/**
 * Record the replay and resolve with the encoded clip. Rejects when the browser
 * cannot record a canvas, so the caller can show a clear message instead of a
 * silent no-op.
 */
export async function exportReplayVideo(opts: ExportOptions): Promise<Blob> {
  const mimeType = pickVideoMimeType();
  if (!mimeType) throw new Error("This browser cannot record video from a canvas.");

  const dpr =
    opts.dpr ?? Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(opts.width * dpr);
  canvas.height = Math.round(opts.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the export canvas.");

  // The camera is stepped once per output frame; for a follow camera that gives
  // the same smoothed motion the interactive stage shows.
  const camera = opts.cameraMode === "follow" ? new FollowCamera(opts.camera) : null;
  if (camera) {
    const p0 = opts.sim.path[0];
    camera.reset(p0?.x ?? 0, p0?.y ?? 0);
  }

  const stream = canvas.captureStream(opts.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(opts.width * opts.height * opts.fps * 0.12),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const totalTicks = Math.max(1, opts.sim.path.length - 1);
  const durationMs = (totalTicks * SIM_TICK_MS) / 1;
  const tickStep = 240 / opts.fps;
  const dt = (tickStep * SIM_TICK_MS) / 1000;

  const stepCamera = (frame: number) => {
    if (!camera) return;
    const upto = Math.max(0, Math.min(Math.floor(frame), opts.sim.path.length - 1));
    const p = opts.sim.path[upto];
    const prev = opts.sim.path[Math.max(0, upto - 1)];
    const vx = (p.x - prev.x) / (SIM_TICK_MS / 1000);
    const vy = (p.y - prev.y) / (SIM_TICK_MS / 1000);
    camera.follow(p.x, p.y, vx, vy, upto === 0 ? 1 : dt);
  };

  recorder.start();
  // Paint the first frame before the stream is sampled so the clip never opens
  // on a blank canvas.
  stepCamera(0);
  renderScene(ctx, 0, opts, camera, dpr);

  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const loop = () => {
      const elapsed = performance.now() - t0;
      const frame = Math.min(totalTicks, (elapsed / durationMs) * totalTicks);
      stepCamera(frame);
      renderScene(ctx, frame, opts, camera, dpr);
      opts.onProgress?.(Math.min(1, elapsed / durationMs));
      if (elapsed >= durationMs) {
        resolve();
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  opts.onProgress?.(1);
  return new Blob(chunks, { type: mimeType });
}

/** Trigger a browser download for a finished clip. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Derive a matching trail/thrust pair from a single chosen arrow colour. */
export function deriveArrowColors(body: string) {
  return { trail: body, thrust: lighten(body, 0.45) };
}

export { withAlpha, cameraPreset };
export type { CameraPreset, CameraSettings };
