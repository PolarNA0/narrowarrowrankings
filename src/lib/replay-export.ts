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
  paintForceFields,
  paintGripZones,
  paintSiteMechanics,
  paintWalls,
  paintTriggers,
  paintZones,
  strokeTrail,
  type FieldParticle,
  type PaintCtx,
  type RenderMode,
} from "@/lib/replay-paint";
import { SIM_TICK_MS, hasSiteMechanics, type SimGeometry, type SimResult } from "@/lib/replay-sim";
import { darken, withAlpha } from "@/lib/replay-visuals";
import {
  DEFAULT_BACKGROUND,
  backgroundBase,
  getBackgroundCanvas,
  type BackgroundTheme,
} from "@/lib/replay-background";
import { WebMWriter } from "@/lib/webm-muxer";
import { Mp4Writer } from "@/lib/mp4-muxer";
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
  /** Output size in CSS px; the encode canvas is exactly this, never dpr-scaled. */
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
  /** Draw the elapsed-time pill at the top centre of the frame. */
  showTimer?: boolean;
  ghosts?: ExportGhost[];
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

/**
 * Hard ceiling on the encode canvas, in pixels (1080p). A frame buffer at this
 * size is ~8MB RGBA and the H.264 encoder holds several as references; going
 * beyond it is what exhausted memory and took the host tab down. Every preset
 * fits inside this, so the cap only ever engages as a safety net.
 */
export const MAX_EXPORT_PIXELS = 2_073_600;

/**
 * The actual encode resolution for a requested output size. The preset is the
 * target, so the canvas is NOT multiplied by `devicePixelRatio` — on a Retina
 * display that turned a "1080p" request into a 4K encode (4x the memory). The
 * result is still clamped to `MAX_EXPORT_PIXELS` for defence in depth, and on a
 * low-memory device to a smaller cap: the H.264 encoder keeps several full frame
 * buffers live, which is what pushes a phone's tab over its budget and crashes it
 * ("Aw, Snap") part-way through the export.
 */
export function resolveEncodeSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const pixels = w * h;
  const cap = Math.min(MAX_EXPORT_PIXELS, deviceEncodePixelCap());
  if (pixels <= cap) return { width: w, height: h };
  const scale = Math.sqrt(cap / pixels);
  return { width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)) };
}

/**
 * A resolution cap for devices that report little memory. `navigator.deviceMemory`
 * (GB, Chrome-only) is a coarse signal: at 4GB or less the tab's budget is tight
 * enough that a 1080p encode is a real crash risk, so cap at 720p; at 2GB, 540p.
 * Devices that do not report it keep the full 1080p cap.
 */
function deviceEncodePixelCap(): number {
  const gb =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;
  if (!gb) return MAX_EXPORT_PIXELS;
  if (gb <= 2) return 921_600 / 2;
  if (gb <= 4) return 921_600;
  return MAX_EXPORT_PIXELS;
}

/**
 * Budget for the encoded clip held in memory while muxing, in bytes. The muxer
 * keeps every encoded frame until the container is finished and the final Blob
 * copies that payload once more, so the encoder is tuned to keep the clip well
 * under this. A long or high-bitrate run otherwise peaks at hundreds of MB and
 * the browser kills the tab ("Aw, Snap") near the end of the export — the
 * reported crash. Kept low because it fails on phones, where the tab's memory
 * budget is a few hundred MB shared with the rest of the page.
 */
export const EXPORT_CLIP_BUDGET_BYTES = 32 * 1024 * 1024;

/** Default per-frame bitrate as a fraction of the raw frame size (≈12%). */
const EXPORT_BPP = 0.12;

/**
 * Pick the encode bitrate and frame rate that keep a clip of `durationMs` inside
 * `EXPORT_CLIP_BUDGET_BYTES`. The bitrate is lowered first (a small, safe step);
 * only a run so long that even a floor bitrate would overflow also drops the
 * frame rate, the bigger lever but a visible change to the clip. Returns the
 * requested settings untouched when the clip already fits.
 */
export function planEncode(
  width: number,
  height: number,
  fps: number,
  durationMs: number,
): { bitrate: number; fps: number } {
  const seconds = Math.max(0.1, durationMs / 1000);
  const natural = Math.round(width * height * fps * EXPORT_BPP);
  // A floor so an unusually long run stays watchable instead of turning to mush.
  const minBitrate = Math.max(2_000_000, Math.round(width * height * 0.35));
  const budgetBitrate = (EXPORT_CLIP_BUDGET_BYTES * 8) / seconds;
  let bitrate = natural;
  let outFps = fps;
  if (natural > budgetBitrate) {
    if (budgetBitrate >= minBitrate) {
      bitrate = Math.floor(budgetBitrate);
    } else {
      bitrate = minBitrate;
      const overflow = (minBitrate * seconds) / 8 / EXPORT_CLIP_BUDGET_BYTES;
      outFps = Math.max(15, Math.round(fps / Math.max(1, overflow)));
      if (outFps >= fps) outFps = Math.max(15, Math.floor(fps / 2));
    }
  }
  return { bitrate: Math.min(natural, bitrate), fps: outFps };
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
 * Elapsed-time pill at the top centre of the frame, so an exported clip carries
 * the same running clock the player sees in fullscreen. `seconds` is the run
 * time at the frame's tick, so it counts up as the clip plays.
 */
function drawTimer(ctx: CanvasRenderingContext2D, seconds: number, width: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const label = `${m}:${s.toFixed(3).padStart(6, "0")}`;
  const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.save();
  ctx.font = `bold 20px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = 16;
  const h = 34;
  const w = ctx.measureText(label).width + padX * 2;
  const x = (width - w) / 2;
  const y = 12;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, width / 2, y + h / 2 + 1);
  ctx.restore();
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
 * Stable particle pool for the wind/suction field previews, seeded
 * deterministically (unlike the interactive viewer's `Math.random`) so the same
 * run always exports the same clip. Created once and reused for every frame.
 */
const EXPORT_FIELD_PARTICLES: FieldParticle[] = (() => {
  const out: FieldParticle[] = [];
  let s = 0x9e3779b9;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 40; i++) out.push({ seed: rand(), phase: rand() });
  return out;
})();

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
  const pc: PaintCtx = { tx, ty, scale, mode, motions: geometry.movingBlocks };

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
  // Wind/suction fields sit above the zones and under the walls, exactly as in
  // the interactive stage. The particle drift is a function of the clip's own
  // time (`frame` ticks → seconds), so the field animates and the export is
  // reproducible frame for frame.
  if (geometry.gripZones && geometry.gripZones.length > 0) {
    paintGripZones(ctx, geometry.gripZones, pc);
  }
  if (geometry.forceFields && geometry.forceFields.length > 0) {
    paintForceFields(ctx, geometry.forceFields, pc, EXPORT_FIELD_PARTICLES, frame / 240);
  }
  if (geometry.triggers && geometry.triggers.length > 0) paintTriggers(ctx, geometry.triggers, pc);
  paintWalls(ctx, geometry.walls, upto, pc);
  // The site-only puzzle mechanics are drawn live, at the frame's tick, so an
  // exported clip shows a door opening or a wall breaking exactly as the sim did.
  if (hasSiteMechanics(geometry)) {
    paintSiteMechanics(ctx, geometry, upto, pc, opts.sim.timeline, sim.path[upto]);
  }

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

  // The elapsed clock sits on top of everything so it stays legible as the
  // scene scrolls beneath it.
  if (opts.showTimer) drawTimer(ctx, upto * (SIM_TICK_MS / 1000), width);

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

/**
 * Whether to prefer the realtime `MediaRecorder` capture over the offline
 * WebCodecs encoder.
 *
 * The offline path renders and encodes as fast as the CPU allows. That is ideal
 * on a desktop, but on a phone it piles full-resolution frames into the hardware
 * encoder's input queue and its driver buffers far faster than the encoder
 * drains them. The tab's memory budget there is only a few hundred MB, so the
 * renderer is killed part-way through the clip — the reported crash at ~40%.
 * The realtime path paces frames to the wall clock, so the queue never builds
 * and the peak stays bounded, which is why the original `MediaRecorder`
 * implementation completed on those devices.
 *
 * So the realtime capture is the preferred path on mobile (and on any device
 * that reports little memory); the offline path stays for desktop, where it is
 * frame-exact and several times faster than real time.
 */
export function preferRealtimeCapture(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)) return true;
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof gb === "number" && gb <= 4;
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
  forceWebm = false,
): Promise<{ codec: string; webmCodec: "V_VP8" | "V_VP9"; mp4: boolean } | null> {
  // H.264/MP4 first: WebM is not playable in QuickTime, Windows Media Player or
  // older Safari, which show a media-error placeholder instead. VP9 is the
  // fallback for browsers whose encoder cannot do H.264, and the only option
  // when the caller has explicitly asked for a WebM (`forceWebm`).
  const all: Array<{ codec: string; webmCodec: "V_VP8" | "V_VP9"; mp4: boolean }> = [
    ...avcCodecs(width * height).map((codec) => ({
      codec,
      webmCodec: "V_VP8" as const,
      mp4: true,
    })),
    { codec: "vp09.00.10.08", webmCodec: "V_VP9", mp4: false },
    { codec: "vp8", webmCodec: "V_VP8", mp4: false },
  ];
  const candidates = forceWebm ? all.filter((c) => !c.mp4) : all;
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
 * Two paths exist:
 *
 *  - Offline (WebCodecs): every frame is drawn and handed to the encoder at its
 *    exact timestamp, so the clip is deterministic and runs as fast as the CPU
 *    allows. Preferred on desktop.
 *  - Realtime (`MediaRecorder`): the canvas is captured live and frames are paced
 *    to the wall clock. Preferred on mobile, where the offline encoder's input
 *    queue outruns the hardware encoder and its driver buffers and the tab is
 *    killed part-way through the clip (see `preferRealtimeCapture`).
 *
 * If the preferred path fails, the other is tried before giving up, so a device
 * that cannot do one can still export.
 */
export async function exportReplayVideo(opts: ExportOptions): Promise<Blob> {
  const offline = canExportOffline();
  const realtime = canExportVideo();
  const preferRealtime = preferRealtimeCapture();

  const runOffline = async (): Promise<Blob | null> => {
    if (!offline) return null;
    // A device can run out of memory or hit an encoder limit part-way through a
    // long or high-resolution clip. Rather than surface that as a hard failure —
    // or a half-written file — retry the whole export at a smaller canvas, which
    // shrinks the frame buffer quadratically. H.264/MP4 is preferred; a browser
    // can pick the avc1 codec string and still fail to hand back a decoder
    // description, so WebM is retried at each scale before moving on.
    for (const scale of [1, 0.7, 0.5]) {
      const attempt: ExportOptions =
        scale === 1
          ? opts
          : {
              ...opts,
              width: Math.max(2, Math.round(opts.width * scale)),
              height: Math.max(2, Math.round(opts.height * scale)),
            };
      const mp4 = await tryExportOffline(attempt);
      if (mp4) return mp4;
      const webm = await tryExportOffline(attempt, true);
      if (webm) return webm;
    }
    return null;
  };

  const runRealtime = async (): Promise<Blob | null> => {
    if (!realtime) return null;
    try {
      return await exportWithMediaRecorder(opts);
    } catch {
      return null;
    }
  };

  const first = preferRealtime ? runRealtime : runOffline;
  const second = preferRealtime ? runOffline : runRealtime;
  const blob = (await first()) ?? (await second());
  if (blob) return blob;
  throw new Error(
    "Video encoding failed — the clip may be too large for this device. Try a smaller size or lower frame rate.",
  );
}

/** Explicit realtime capture, for browsers without WebCodecs. */
export async function exportReplayVideoRealtime(opts: ExportOptions): Promise<Blob> {
  return exportWithMediaRecorder(opts);
}

/** Offline path: render every frame, encode with WebCodecs, mux to MP4/WebM. */
async function tryExportOffline(opts: ExportOptions, forceWebm = false): Promise<Blob | null> {
  const { width, height } = resolveEncodeSize(opts.width, opts.height);
  // The canvas is exactly the output resolution. It is deliberately not scaled
  // by devicePixelRatio: that multiplied the frame buffer by 4x on Retina
  // displays (a "1080p" request became a 4K encode) and is what drove the
  // memory exhaustion.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // `renderScene` lays out in CSS px (`opts.width`) and applies this ratio to
  // reach device px. It is 1 unless the size cap shrank the canvas.
  const dpr = width / opts.width;

  const picked = await pickEncoderCodec(canvas.width, canvas.height, forceWebm);
  if (!picked) return null;

  const camera = opts.cameraMode === "follow" ? new FollowCamera(opts.camera) : null;
  if (camera) {
    const p0 = opts.sim.path[0];
    camera.reset(p0?.x ?? 0, p0?.y ?? 0);
  }

  // Trim to the tick the run actually finished on. A TAS/optimizer input string
  // often carries ticks past the finish (the arrow is already stopped, so they
  // are dead weight); exporting the full input length plays that dead tail as a
  // frozen last second or two. The player's clock stops at the finish, so the
  // clip should too.
  const totalTicks = Math.max(1, opts.sim.finishTick ?? opts.sim.path.length - 1);
  const durationMs = totalTicks * SIM_TICK_MS;
  // Tune the bitrate/frame rate so the encoded clip stays inside the memory
  // budget instead of ballooning on a long or high-resolution run and crashing
  // the tab. Short clips are untouched; only ones that would overflow change.
  const plan = planEncode(canvas.width, canvas.height, opts.fps, durationMs);
  const fps = plan.fps;
  // Frames are spread uniformly across the exact clip duration, so the last
  // frame lands precisely on the finish tick and the clip is neither short nor
  // padded. (`frameInterval` is the nominal 1/fps; the spacing below is within a
  // fraction of a millisecond of it.)
  const frameCount = Math.max(2, Math.round(durationMs / (1000 / fps)) + 1);
  const lastFrame = frameCount - 1;
  const frameToTick = (f: number) => (f / lastFrame) * totalTicks;
  const frameToMs = (f: number) => (f / lastFrame) * durationMs;
  const tickStep = 240 / fps;
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

  // Frames stream straight into the container writer as the encoder emits them
  // (see the `output` callback below), so the clip is never buffered whole and
  // then copied again at the end — the peak that used to take the tab down on a
  // long export. Only the tiny header tables are built at `finish()`.
  const defaultDurationNs = Math.round(1e9 / fps);
  let writer: Mp4Writer | WebMWriter | null = null;
  let encodeError: unknown = null;

  // MP4 needs its `avcC` decoder description before the first frame can be
  // muxed; it arrives with the encoder's first key chunk. WebM needs nothing up
  // front, so its writer is created on the first frame.
  const ensureWriter = (meta?: EncodedVideoChunkMetadata): boolean => {
    if (writer) return true;
    if (picked.mp4) {
      const d = meta?.decoderConfig?.description;
      if (!d) return false;
      const description =
        d instanceof Uint8Array ? new Uint8Array(d) : new Uint8Array(d as ArrayBuffer);
      writer = new Mp4Writer({
        width: canvas.width,
        height: canvas.height,
        fps,
        durationMs,
        description,
      });
    } else {
      writer = new WebMWriter({
        width: canvas.width,
        height: canvas.height,
        codec: picked.webmCodec,
        durationMs,
        defaultDurationNs,
      });
    }
    return true;
  };

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const keyframe = chunk.type === "key";
      if (!ensureWriter(meta)) {
        encodeError = new Error("The H.264 encoder produced no decoder description.");
        return;
      }
      if (writer instanceof Mp4Writer) writer.addFrame(data, keyframe);
      else writer?.addFrame(data, chunk.timestamp / 1000, keyframe);
    },
    error: (e) => {
      encodeError = e;
    },
  });
  const bitrate = plan.bitrate;
  const keyEvery = Math.max(1, Math.round(fps * 2));

  /** Yield to the event loop so the host page can paint and stay responsive. */
  const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  try {
    encoder.configure({
      codec: picked.codec,
      width: canvas.width,
      height: canvas.height,
      bitrate,
      framerate: fps,
      // "realtime" keeps the encoder from buffering frames for lookahead. The
      // quality mode is marginally smaller for the same bitrate, but it lets the
      // hardware encoder hold several input frames live, which is what piles up
      // in the driver on a phone and takes the tab down. Realtime keeps only the
      // in-flight frame, so the peak stays flat and the clip still looks the same.
      latencyMode: "realtime",
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
      // get a turn between frames instead of starving behind a thousand queued
      // frames, and yield to the event loop every few frames so the page keeps
      // painting (a tight synchronous loop here is what froze the editor). The
      // thresholds are deliberately low: on a phone the hardware encoder drains
      // slowly, and a deeper queue is what builds the driver-side buffer that
      // kills the tab.
      if (encoder.encodeQueueSize > 4) {
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            if (encoder.encodeQueueSize <= 2) {
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
      } else if (f % 8 === 0) {
        await yieldToHost();
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
  // `writer` is assigned inside the encoder's output callback, which TypeScript's
  // flow analysis cannot see, so widen it before the null check.
  const muxed = writer as Mp4Writer | WebMWriter | null;
  if (encodeError || !muxed) return null;

  opts.onProgress?.(1);
  // The writer already holds the muxed clip; `finish()` only appends the header
  // tables (MP4) or the last cluster (WebM).
  const blob = muxed.finish();

  // Last line of defence: confirm the file is actually a decodable video before
  // handing it to the user. A wrong container or a bad mux would otherwise only
  // surface as the player's error placeholder (a grey frame) after the download.
  if (await isPlayableVideo(blob)) return blob;
  return null;
}

/**
 * Whether a `<video>` can decode this blob at all. Resolves false on error or if
 * the browser never reaches a decodable state, so the caller can retry rather
 * than present an unplayable clip.
 */
function isPlayableVideo(blob: Blob, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth > 0 && video.videoHeight > 0);
    video.onerror = () => finish(false);
    window.setTimeout(() => finish(false), timeoutMs);
    video.src = url;
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

  const { width, height } = resolveEncodeSize(opts.width, opts.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the export canvas.");
  const dpr = width / opts.width;

  // The camera is stepped once per output frame; for a follow camera that gives
  // the same smoothed motion the interactive stage shows.
  const camera = opts.cameraMode === "follow" ? new FollowCamera(opts.camera) : null;
  if (camera) {
    const p0 = opts.sim.path[0];
    camera.reset(p0?.x ?? 0, p0?.y ?? 0);
  }

  // Trim to the tick the run actually finished on, so inputs past the finish
  // (common in TAS/optimizer strings) do not play as a frozen tail. See
  // `tryExportOffline`.
  const totalTicks = Math.max(1, opts.sim.finishTick ?? opts.sim.path.length - 1);
  const durationMs = totalTicks * SIM_TICK_MS;
  // `MediaRecorder` buffers the whole recording in memory, so a long run is the
  // worst case here too. Use the same memory-aware bitrate/frame-rate plan as the
  // offline path so this fallback cannot balloon either.
  const plan = planEncode(width, height, opts.fps, durationMs);
  const fps = plan.fps;
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: plan.bitrate,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const frameInterval = 1000 / fps;
  const tickStep = 240 / fps;
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

/** Derive a matching trail/tail pair from a single chosen arrow colour. The
 * tail is a darker body so the arrow reads as one object; the trail matches the
 * body so the streak still reads as the run's own colour. */
export function deriveArrowColors(body: string) {
  return { trail: body, thrust: darken(body, 0.25) };
}

export { withAlpha, cameraPreset };
export type { CameraPreset, CameraSettings };
