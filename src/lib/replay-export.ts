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
import {
  DEFAULT_BACKGROUND,
  backgroundBase,
  getBackgroundCanvas,
  type BackgroundTheme,
} from "@/lib/replay-background";
import { muxWebM, type WebMFrame } from "@/lib/webm-muxer";
import { muxMp4 } from "@/lib/mp4-muxer";
import type { ArrowKind } from "@/lib/arrow-sprites";

/** How the camera frames the run. */
export type ExportCameraMode = "follow" | "fit";

/**
 * The run-info card drawn above the input dots: who ran it, the time, the level
 * and arrow, the rank, the input count and how far off the record it is.
 */
export interface ExportInfoCard {
  player: string;
  /** The run's completion time in seconds. */
  seconds: number;
  /** ISO date (or anything `new Date` parses) shown under the time. */
  date?: string;
  /** Signed gap to the reference, e.g. `-0.031` for 31 ms faster. */
  delta?: number;
  /** Label for the reference, e.g. `WR` or `TAS`. */
  deltaLabel?: string;
  /** Arrow name, e.g. `Narrow Arrow`. */
  arrow?: string;
  /** Level name, e.g. `Moon Rock Rally`. */
  levelName?: string;
  /** Rank on the board, and how many entries it sits among. */
  rank?: number;
  rankTotal?: number;
  /** Number of recorded inputs (ticks) and the sample rate they were taken at. */
  inputs?: number;
  hz?: number;
  /** A short pill shown beside the player, e.g. `TAS`, `WR` or `VERIFIED`. */
  badge?: string;
}

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
  /** Themed backdrop drawn behind the scene, in place of the flat fill. */
  backgroundTheme?: BackgroundTheme;
  /** A run info card (name, time, date, delta) drawn above the input dots. */
  infoCard?: ExportInfoCard;
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
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
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
 * The run-info card, bottom-right above the steer dots: a player line with an
 * optional badge, the big time, the level and arrow, and a bottom row of the
 * date, rank, input count and gap to the reference. Left-aligned like the
 * readouts the game itself shows, so it sits naturally in the corner.
 */
function drawInfoCard(
  ctx: CanvasRenderingContext2D,
  info: ExportInfoCard,
  width: number,
  height: number,
  bottomPad: number,
) {
  const pad = 16;
  const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
  const SANS = "ui-sans-serif, system-ui, sans-serif";
  const GREEN = "#4ade80";
  const RED = "#f87171";
  const DIM = "#94a3b8";

  const fmtDate = (v: string) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  };

  // --- row 1: player (+ badge) -------------------------------------------------
  ctx.font = `bold 15px ${SANS}`;
  const playerW = ctx.measureText(info.player).width;
  const badge = info.badge?.trim();
  ctx.font = `bold 10px ${MONO}`;
  const badgeW = badge ? ctx.measureText(badge).width + 14 : 0;

  // --- row 2: the big time -----------------------------------------------------
  ctx.font = `bold 26px ${MONO}`;
  const timeStr = `${info.seconds.toFixed(3)}s`;
  const timeW = ctx.measureText(timeStr).width;

  // --- row 3: level · arrow ----------------------------------------------------
  ctx.font = `11px ${SANS}`;
  const sub = [info.levelName, info.arrow].filter(Boolean).join("  ·  ");
  const subW = sub ? ctx.measureText(sub).width : 0;

  // --- row 4: date · rank · inputs · delta -------------------------------------
  ctx.font = `11px ${MONO}`;
  const metaParts: string[] = [];
  if (info.date) metaParts.push(fmtDate(info.date));
  if (info.rank != null)
    metaParts.push(`#${info.rank}${info.rankTotal ? `/${info.rankTotal}` : ""}`);
  if (info.inputs != null) metaParts.push(`${info.inputs} in${info.hz ? ` @${info.hz}Hz` : ""}`);
  if (info.delta !== undefined) {
    const sign = info.delta <= 0 ? "-" : "+";
    metaParts.push(`[${info.deltaLabel ?? "WR"} ${sign}${Math.abs(info.delta).toFixed(3)}]`);
  }
  const metaStr = metaParts.join("   ");
  const metaW = metaStr ? ctx.measureText(metaStr).width : 0;

  const innerW = Math.max(playerW + badgeW + 6, timeW, subW, metaW);
  const boxW = innerW + pad * 2;
  const boxH =
    pad * 2 + 18 /* player */ + 6 + 30 /* time */ + (sub ? 4 + 14 : 0) + (metaStr ? 8 + 14 : 0);
  const x = width - 16 - boxW;
  const y = height - bottomPad - boxH;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "left";

  let cy = y + pad;
  // Player
  ctx.font = `bold 15px ${SANS}`;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText(info.player, x + pad, cy + 13);
  // Badge pill
  if (badge) {
    const bx = x + pad + playerW + 8;
    const by = cy + 1;
    ctx.fillStyle = "rgba(74,222,128,0.16)";
    ctx.beginPath();
    ctx.roundRect(bx, by, badgeW, 15, 7);
    ctx.fill();
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = GREEN;
    ctx.fillText(badge, bx + 7, by + 11);
  }
  cy += 18 + 6;

  // Time
  ctx.font = `bold 26px ${MONO}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(timeStr, x + pad, cy + 24);
  cy += 30;

  // Level · arrow
  if (sub) {
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(sub, x + pad, cy + 11);
    cy += 4 + 14;
  }

  // Meta row: date · rank · inputs in white-ish, then the delta in its colour.
  if (metaParts.length) {
    cy += 8;
    ctx.font = `11px ${MONO}`;
    const headParts = metaParts.slice(0, info.delta !== undefined ? -1 : metaParts.length);
    const headStr = headParts.join("   ");
    ctx.fillStyle = DIM;
    ctx.fillText(headStr, x + pad, cy + 11);
    if (info.delta !== undefined) {
      const hw = headStr ? ctx.measureText(headStr).width + 18 : 0;
      ctx.fillStyle = info.delta <= 0 ? GREEN : RED;
      ctx.fillText(metaParts[metaParts.length - 1], x + pad + hw, cy + 11);
    }
  }

  ctx.restore();
}

/**
 * The world-space bounds of the level, the run and any ghosts. Computed once
 * per export rather than per frame: iterating every path point of every run on
 * each of hundreds of frames is a real cost, and none of it changes mid-clip.
 */
function computeBounds(opts: ExportOptions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of opts.geometry.walls) {
    const half = (w.thickness || 8) / 2;
    minX = Math.min(minX, Math.min(w.ax, w.bx) - half);
    maxX = Math.max(maxX, Math.max(w.ax, w.bx) + half);
    minY = Math.min(minY, Math.min(w.ay, w.by) - half);
    maxY = Math.max(maxY, Math.max(w.ay, w.by) + half);
  }
  for (const z of opts.geometry.zones) {
    minX = Math.min(minX, z.x0);
    minY = Math.min(minY, z.y0);
    maxX = Math.max(maxX, z.x1);
    maxY = Math.max(maxY, z.y1);
  }
  const paths = [opts.sim.path, ...(opts.ghosts ?? []).map((g) => g.sim.path)];
  for (const path of paths) {
    for (const p of path) {
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
  return { minX, minY, spanX: Math.max(1, maxX - minX), spanY: Math.max(1, maxY - minY) };
}

type SceneBounds = ReturnType<typeof computeBounds>;

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
  bounds: SceneBounds,
) {
  const { sim, geometry, mode, width, height } = opts;
  const upto = Math.max(0, Math.min(Math.floor(frame), sim.path.length - 1));

  const { minX, minY, spanX, spanY } = bounds;

  let scale: number;
  let offX: number;
  let offY: number;
  const following = opts.cameraMode === "follow" && camera != null;
  if (following) {
    scale = camera!.zoom;
    offX = width / 2 - camera!.x * scale;
    offY = height / 2 - camera!.y * scale;
  } else {
    scale = Math.min(width / spanX, height / spanY);
    offX = (width - spanX * scale) / 2 - minX * scale;
    offY = (height - spanY * scale) / 2 - minY * scale;
  }
  const tx = (x: number) => x * scale + offX;
  const ty = (y: number) => y * scale + offY;
  const pc: PaintCtx = { tx, ty, scale, mode };

  // In follow mode the viewport is a small window that moves with the arrow, so
  // the trail (and each ghost's trail) is only stroked where it can be seen —
  // otherwise every frame re-walks the whole path from the spawn. In the fixed
  // "fit" view the whole level is on screen, so no clipping is needed.
  const clip = following ? { w: width, h: height } : undefined;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const theme = opts.backgroundTheme ?? DEFAULT_BACKGROUND;
  const bg = getBackgroundCanvas(theme, width, height, dpr);
  if (bg) {
    // One blit per frame from the cached backdrop - never repaint it here.
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = opts.background || backgroundBase(theme);
    ctx.fillRect(0, 0, width, height);
  }

  paintZones(ctx, geometry, pc);
  paintWalls(ctx, geometry.walls, upto, pc);

  for (const g of opts.ghosts ?? []) {
    const gp = g.sim.path;
    if (gp.length < 2) continue;
    const gUpto = Math.max(0, Math.min(upto, gp.length - 1));
    const p = gp[gUpto];
    const gx = tx(p.x);
    const gy = ty(p.y);
    // Skip a ghost that is entirely off-screen in follow mode; its arrow would
    // never be visible anyway, and skipping saves a full trail stroke.
    if (clip && (gx < -clip.w || gx > clip.w * 2 || gy < -clip.h || gy > clip.h * 2)) continue;
    ctx.save();
    ctx.globalAlpha = 0.5;
    strokeTrail(ctx, gp, gUpto, g.color, false, pc, clip);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.6;
    drawSprite(ctx, g.arrow, gx, gy, p.rot, scale, g.arrowRadius, g.color, g.color);
    ctx.restore();
    if (g.label) {
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillStyle = g.color;
      ctx.fillText(g.label, gx + 9, gy - 9);
    }
  }

  strokeTrail(ctx, sim.path, upto, opts.trail, mode === "game", pc, clip);
  const point = sim.path[upto];
  if (point) {
    if ((point.thrustPower ?? 0) > 0.05) {
      drawGameThrust(
        ctx,
        opts.arrow,
        point.x,
        point.y,
        point.rot,
        opts.arrowRadius,
        scale,
        tx,
        ty,
        point.thrustPower ?? 1,
        upto,
      );
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

  if (opts.infoCard) drawInfoCard(ctx, opts.infoCard, width, height, opts.showInputs ? 52 : 18);

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
 * Whether this browser can encode offline with WebCodecs (fast, frame-exact).
 * Falls back to `MediaRecorder` capture when false.
 */
export function canExportOffline(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/** H.264 codec strings whose level actually covers this pixel count, best first. */
function avcCodecs(pixels: number): string[] {
  if (pixels <= 921_600) return ["avc1.420028", "avc1.42001f"]; // ≤720p: level 4.0, then 3.1
  if (pixels <= 2_073_600) return ["avc1.42002A", "avc1.420028"]; // ≤1080p: level 4.2, then 4.0
  return ["avc1.420033", "avc1.42002A"]; // larger: level 5.1, then 4.2
}

/** The first WebCodecs codec string the browser will encode, or null. */
async function pickEncoderCodec(
  width: number,
  height: number,
): Promise<{ codec: string; webmCodec: "V_VP8" | "V_VP9"; mp4: boolean } | null> {
  // H.264/MP4 first: WebM is not playable in QuickTime, Windows Media Player or
  // older Safari, which show a media-error placeholder instead. VP9 is the
  // fallback for browsers whose encoder cannot do H.264.
  const candidates: Array<{ codec: string; webmCodec: "V_VP8" | "V_VP9"; mp4: boolean }> = [
    ...avcCodecs(width * height).map((codec) => ({
      codec,
      webmCodec: "V_VP8" as const,
      mp4: true,
    })),
    { codec: "vp09.00.10.08", webmCodec: "V_VP9", mp4: false },
    { codec: "vp8", webmCodec: "V_VP8", mp4: false },
  ];
  for (const c of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width,
        height,
        bitrate: 6_000_000,
      });
      if (support.supported) return c;
    } catch {
      /* try the next codec */
    }
  }
  return null;
}

/**
 * Record the replay and resolve with the encoded clip.
 *
 * Encoding is offline: each frame is drawn and handed to the WebCodecs
 * `VideoEncoder` at its exact timestamp, so the clip is deterministic and runs
 * as fast as the CPU allows instead of in real time. `MediaRecorder` (realtime
 * canvas capture) is only used when WebCodecs is unavailable. Rejects when the
 * browser can do neither, so the caller can show a clear message.
 */
export async function exportReplayVideo(opts: ExportOptions): Promise<Blob> {
  if (canExportOffline()) {
    const offline = await tryExportOffline(opts);
    if (offline) return offline;
  }
  return exportWithMediaRecorder(opts);
}

/** Offline path: render every frame, encode with WebCodecs, mux to WebM. */
async function tryExportOffline(opts: ExportOptions): Promise<Blob | null> {
  const dpr =
    opts.dpr ?? Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(opts.width * dpr);
  canvas.height = Math.round(opts.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const picked = await pickEncoderCodec(canvas.width, canvas.height);
  if (!picked) return null;

  const camera = opts.cameraMode === "follow" ? new FollowCamera(opts.camera) : null;
  if (camera) {
    const p0 = opts.sim.path[0];
    camera.reset(p0?.x ?? 0, p0?.y ?? 0);
  }

  const totalTicks = Math.max(1, opts.sim.path.length - 1);
  const durationMs = totalTicks * SIM_TICK_MS;
  // Frames are spread uniformly across the exact clip duration, so the last
  // frame lands precisely on the finish tick and the clip is neither short nor
  // padded. (`frameInterval` is the nominal 1/fps; the spacing below is within a
  // fraction of a millisecond of it.)
  const frameCount = Math.max(2, Math.round(durationMs / (1000 / opts.fps)) + 1);
  const lastFrame = frameCount - 1;
  const frameToTick = (f: number) => (f / lastFrame) * totalTicks;
  const frameToMs = (f: number) => (f / lastFrame) * durationMs;
  const tickStep = 240 / opts.fps;
  const dt = (tickStep * SIM_TICK_MS) / 1000;
  const bounds = computeBounds(opts);

  const stepCamera = (frame: number) => {
    if (!camera) return;
    const upto = Math.max(0, Math.min(Math.floor(frame), opts.sim.path.length - 1));
    const p = opts.sim.path[upto];
    const prev = opts.sim.path[Math.max(0, upto - 1)];
    const vx = (p.x - prev.x) / (SIM_TICK_MS / 1000);
    const vy = (p.y - prev.y) / (SIM_TICK_MS / 1000);
    camera.follow(p.x, p.y, vx, vy, upto === 0 ? 1 : dt);
  };

  const frames: WebMFrame[] = [];
  let encodeError: unknown = null;
  let description: Uint8Array | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({
        data,
        timestamp: chunk.timestamp / 1000,
        keyframe: chunk.type === "key",
      });
      // The `avcC` decoder config only arrives with the first (key) chunk.
      if (!description && meta?.decoderConfig?.description) {
        const d = meta.decoderConfig.description;
        description =
          d instanceof Uint8Array ? new Uint8Array(d) : new Uint8Array(d as ArrayBuffer);
      }
    },
    error: (e) => {
      encodeError = e;
    },
  });
  const bitrate = Math.round(opts.width * opts.height * opts.fps * 0.12);
  const defaultDurationNs = Math.round(1e9 / opts.fps);
  const keyEvery = Math.max(1, Math.round(opts.fps * 2));

  try {
    encoder.configure({
      codec: picked.codec,
      width: canvas.width,
      height: canvas.height,
      bitrate,
      framerate: opts.fps,
    });
    for (let f = 0; f < frameCount; f++) {
      const tick = frameToTick(f);
      stepCamera(tick);
      renderScene(ctx, tick, opts, camera, dpr, bounds);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(frameToMs(f) * 1000),
        duration: Math.round(1e6 / opts.fps),
      });
      encoder.encode(frame, { keyFrame: f % keyEvery === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      // Back-pressure: keep the queue shallow so the encoder's output callbacks
      // (and the UI) get a turn between frames instead of starving behind a
      // thousand queued frames.
      if (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            if (encoder.encodeQueueSize <= 4) {
              encoder.removeEventListener("dequeue", onDequeue);
              resolve();
            }
          };
          encoder.addEventListener("dequeue", onDequeue);
          setTimeout(() => {
            encoder.removeEventListener("dequeue", onDequeue);
            resolve();
          }, 0);
        });
      }
      if (f % 8 === 0) opts.onProgress?.(f / lastFrame);
    }
    await encoder.flush();
  } catch {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    return null;
  }
  encoder.close();
  if (encodeError || frames.length === 0) return null;

  opts.onProgress?.(1);
  // H.264 → MP4 (universally playable). Anything else → WebM.
  if (picked.mp4 && description) {
    return muxMp4(
      frames.map((f) => ({ data: f.data, timestampMs: f.timestamp, keyframe: f.keyframe })),
      {
        width: canvas.width,
        height: canvas.height,
        fps: opts.fps,
        durationMs,
        description,
      },
    );
  }
  return muxWebM(frames, {
    width: canvas.width,
    height: canvas.height,
    codec: picked.webmCodec,
    durationMs,
    defaultDurationNs,
  });
}

/**
 * Realtime fallback: capture the canvas with `MediaRecorder`. Used only when
 * WebCodecs is unavailable; it is tied to wall-clock time and can drop the tail
 * of a run under load, so the offline path is strongly preferred.
 */
async function exportWithMediaRecorder(opts: ExportOptions): Promise<Blob> {
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
  const durationMs = totalTicks * SIM_TICK_MS;
  const frameInterval = 1000 / opts.fps;
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

  /** Draw one frame at tick `frame` (may be fractional between 240Hz samples). */
  const renderFrame = (frame: number) => {
    stepCamera(frame);
    renderScene(ctx, frame, opts, camera, dpr, bounds);
  };

  // Progress is throttled to whole percents: calling back on every animation
  // frame re-renders the dialog ~60x a second during the export, which competes
  // with the recording itself.
  let lastPct = -1;
  const reportProgress = (fraction: number) => {
    const pct = Math.min(100, Math.round(fraction * 100));
    if (pct !== lastPct) {
      lastPct = pct;
      opts.onProgress?.(Math.min(1, fraction));
    }
  };

  const bounds = computeBounds(opts);
  recorder.start();
  // Paint the first frame before the stream is sampled so the clip never opens
  // on a blank canvas.
  renderFrame(0);

  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    let lastRender = -Infinity;
    const loop = () => {
      const elapsed = performance.now() - t0;
      // `requestAnimationFrame` fires at the display's refresh rate, which is
      // 120Hz+ on many monitors, but the recorder only samples the canvas at
      // `fps`. Repainting the whole scene on every vsync is wasted work, so a
      // frame is only drawn once the target interval has passed. The frame index
      // is derived from wall-clock time so the clip always plays at real speed.
      if (elapsed - lastRender >= frameInterval - 1) {
        lastRender = elapsed;
        const frame = Math.min(totalTicks, (elapsed / durationMs) * totalTicks);
        renderFrame(frame);
        reportProgress(elapsed / durationMs);
      }
      if (elapsed >= durationMs) {
        // The last drawn frame can sit well before the end when a frame renders
        // slowly (the loop can jump from mid-run to past `durationMs` in one
        // tick). Draw the final frame explicitly and hold it a beat so the
        // recorder writes it — without this the clip ends 1-2s early and the
        // run's finish is missing.
        renderFrame(totalTicks);
        reportProgress(1);
        window.setTimeout(resolve, frameInterval + 60);
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
