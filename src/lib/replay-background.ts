/**
 * Replay backgrounds.
 *
 * The game draws a themed backdrop behind every level. This module renders the
 * same idea procedurally so the replay stage and the video exporter can show a
 * chosen backdrop instead of a flat near-black fill.
 *
 * Each backdrop is painted once into an offscreen canvas and cached, then blitted
 * with a single `drawImage` per frame. Redrawing a starfield or a nebula every
 * frame is what makes an export feel laggy, so the cost is paid once per
 * (theme, size) instead of once per frame.
 */

export type BackgroundTheme = "void" | "stars" | "nebula" | "grid" | "moon" | "aurora";

export interface BackgroundOption {
  id: BackgroundTheme;
  label: string;
}

/** The backdrops offered in the exporter, in the order they are shown. */
export const BACKGROUNDS: BackgroundOption[] = [
  { id: "void", label: "Void" },
  { id: "stars", label: "Stars" },
  { id: "nebula", label: "Nebula" },
  { id: "grid", label: "Grid" },
  { id: "moon", label: "Moon" },
  { id: "aurora", label: "Aurora" },
];

export const DEFAULT_BACKGROUND: BackgroundTheme = "void";

/** A small deterministic PRNG so a backdrop looks the same every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = "#07070b";

function fillVoid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, "#101018");
  g.addColorStop(1, BASE);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = mulberry32(1337);
  const count = Math.round((w * h) / 5200);
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() * 1.4 + 0.25;
    const a = rnd() * 0.7 + 0.25;
    ctx.globalAlpha = a;
    ctx.fillStyle = rnd() > 0.92 ? "#bcd4ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few brighter, larger stars with a soft halo.
  for (let i = 0; i < Math.max(3, count / 60); i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() * 1.6 + 1.1;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    g.addColorStop(0, "rgba(220,232,255,0.9)");
    g.addColorStop(1, "rgba(220,232,255,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = mulberry32(90210);
  const hues = [225, 280, 200, 320];
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (rnd() * 0.35 + 0.25) * Math.max(w, h);
    const hue = hues[i % hues.length];
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue}, 70%, 60%, 0.20)`);
    g.addColorStop(0.5, `hsla(${hue}, 70%, 55%, 0.07)`);
    g.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const step = 48;
  ctx.strokeStyle = "rgba(120,150,220,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y <= h; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(120,150,220,0.16)";
  ctx.beginPath();
  for (let x = 0; x <= w; x += step * 4) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y <= h; y += step * 4) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
}

function drawMoon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#14161c");
  g.addColorStop(0.5, "#1b1e27");
  g.addColorStop(1, "#0e1015");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(4242);
  const craters = Math.round((w * h) / 40000);
  for (let i = 0; i < craters; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() * 26 + 5;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#0a0b0f";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#3a4050";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bands = [
    ["#0a2a2e", 0.0],
    ["#0e3b46", 0.28],
    ["#123a55", 0.55],
    ["#0a1c33", 0.8],
    ["#07070b", 1.0],
  ] as const;
  const g = ctx.createLinearGradient(0, h, w, 0);
  for (const [color, stop] of bands) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(777);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const x = (rnd() * 0.6 + 0.2) * w;
    const y = rnd() * h;
    const r = (rnd() * 0.3 + 0.2) * Math.max(w, h);
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, "hsla(160, 80%, 55%, 0.14)");
    g2.addColorStop(1, "hsla(160, 80%, 55%, 0)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function paint(ctx: CanvasRenderingContext2D, theme: BackgroundTheme, w: number, h: number) {
  switch (theme) {
    case "stars":
      fillVoid(ctx, w, h);
      drawStars(ctx, w, h);
      break;
    case "nebula":
      fillVoid(ctx, w, h);
      drawNebula(ctx, w, h);
      break;
    case "grid":
      fillVoid(ctx, w, h);
      drawGrid(ctx, w, h);
      break;
    case "moon":
      drawMoon(ctx, w, h);
      break;
    case "aurora":
      drawAurora(ctx, w, h);
      break;
    default:
      fillVoid(ctx, w, h);
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * A cached backdrop canvas at device resolution. The caller blits it with
 * `drawImage(bg, 0, 0, cssWidth, cssHeight)` under a `dpr` transform.
 */
export function getBackgroundCanvas(
  theme: BackgroundTheme,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${theme}:${cssWidth}x${cssHeight}@${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(ctx, theme, cssWidth, cssHeight);
  cache.set(key, canvas);
  return canvas;
}

/** The base page colour a theme wants behind the canvas (for letterboxing). */
export function backgroundBase(theme: BackgroundTheme): string {
  if (theme === "moon") return "#12141a";
  if (theme === "aurora") return "#0a1c33";
  return BASE;
}
