/**
 * The canvas painters shared by the interactive replay stage (`ReplayViewer`)
 * and the offline video exporter (`replay-export`). Both need to draw the exact
 * same scene — walls, zones, portals, trails and the thrust flame — at different
 * canvas sizes and with different transforms, so the drawing lives here and each
 * caller supplies the world→px transform and the render mode.
 *
 * Everything here paints in *canvas px*: the caller has already set the base
 * transform (usually `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`) and passes `tx`
 * / `ty` closures built from the current camera or level fit.
 */
import { drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import { lighten, wallVisual, withAlpha } from "@/lib/replay-visuals";
import {
  GAME_COLLISION_COLOR,
  GAME_FINISH_THICKNESS,
  GAME_PORTAL_COLORS,
  GAME_THRUST_COLORS,
  GAME_WALL_THICKNESS,
  checkerAt,
  gameWallColor,
  gameZoneColor,
} from "@/lib/replay-render";
import type { SimGeometry, SimPortal, SimResult, SimWall } from "@/lib/replay-sim";

export type RenderMode = "lines" | "game";

/** The world→px transform and mode a painter needs. */
export interface PaintCtx {
  tx: (x: number) => number;
  ty: (y: number) => number;
  /** World→px scale, used for stroke widths and sprites. */
  scale: number;
  mode: RenderMode;
}

const wallColorFor = (type: string, mode: RenderMode) =>
  mode === "game" ? gameWallColor(type) : wallVisual(type).color;
const zoneColorFor = (type: string, mode: RenderMode) =>
  mode === "game" ? gameZoneColor(type) : wallVisual(type).color;

/** A portal as a dashed segment with a chevron pointing along the travel. */
export function drawPortal(
  ctx: CanvasRenderingContext2D,
  p: SimPortal,
  tx: (x: number) => number,
  ty: (y: number) => number,
  game = false,
) {
  const x0 = tx(p.ax);
  const y0 = ty(p.ay);
  const x1 = tx(p.bx);
  const y1 = ty(p.by);
  if (game) {
    // The game's portal: a bright particle band along the segment.
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(GAME_PORTAL_COLORS.a, 0.5);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = GAME_PORTAL_COLORS.a;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const visual = wallVisual("portal");
  ctx.save();
  ctx.strokeStyle = withAlpha(visual.color, 0.7);
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const s = 6;
  ctx.fillStyle = visual.color;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(ang) * s, my + Math.sin(ang) * s);
  ctx.lineTo(mx + Math.cos(ang + 2.5) * s, my + Math.sin(ang + 2.5) * s);
  ctx.lineTo(mx + Math.cos(ang - 2.5) * s, my + Math.sin(ang - 2.5) * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The finish line: a white strip with a black chequer, like the game's grid. */
export function drawFinish(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  worldThickness: number,
  scale: number,
) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const cells = Math.max(4, Math.round(len / 12));
  const cell = len / cells;
  const thick = Math.max(6, worldThickness * scale);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = checkerAt(i, j, 1) ? "#ffffff" : "#111114";
      ctx.fillRect(i * cell, -thick / 2 + (j * thick) / 2, cell, thick / 2);
    }
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, -thick / 2, len, thick);
  ctx.restore();
}

/** Zones and portals, drawn under the walls in both modes. */
export function paintZones(ctx: CanvasRenderingContext2D, geometry: SimGeometry, pc: PaintCtx) {
  const { tx, ty, mode } = pc;
  for (const z of geometry.zones) {
    const color = zoneColorFor(z.type, mode);
    // Trace the zone's own polygon so slanted/multi-point zones (e.g. Arctic
    // Dash) keep their shape; a zone with too few points falls back to its box.
    const pts =
      z.points && z.points.length >= 3
        ? z.points
        : [
            { x: z.x0, y: z.y0 },
            { x: z.x1, y: z.y0 },
            { x: z.x1, y: z.y1 },
            { x: z.x0, y: z.y1 },
          ];
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = tx(p.x);
      const py = ty(p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, mode === "game" ? 0.22 : 0.14);
    ctx.fill();
    if (mode !== "game") {
      ctx.strokeStyle = withAlpha(color, 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const p of geometry.portals) {
    drawPortal(ctx, p, tx, ty, mode === "game");
  }
}

/** Walls (and the finish line), at `tick` so rotating segments sit at their pose. */
export function paintWalls(
  ctx: CanvasRenderingContext2D,
  walls: SimWall[],
  tick: number,
  pc: PaintCtx,
) {
  const { tx, ty, scale, mode } = pc;
  ctx.lineCap = "round";
  for (const w of walls) {
    let ax = w.ax;
    let ay = w.ay;
    let bx = w.bx;
    let by = w.by;
    if (w.pivot && w.rotationSpeed) {
      const ang = w.rotationSpeed * tick;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const rotate = (px: number, py: number) => {
        const dx = px - w.pivot!.x;
        const dy = py - w.pivot!.y;
        return { x: w.pivot!.x + dx * cosA - dy * sinA, y: w.pivot!.y + dx * sinA + dy * cosA };
      };
      const a = rotate(ax, ay);
      const b = rotate(bx, by);
      ax = a.x;
      ay = a.y;
      bx = b.x;
      by = b.y;
    }
    const isFinish = w.type === "finish";
    const color = isFinish ? "#ffffff" : wallColorFor(w.type, mode);
    const X0 = tx(ax);
    const Y0 = ty(ay);
    const X1 = tx(bx);
    const Y1 = ty(by);

    if (mode === "game") {
      const thickness = isFinish ? GAME_FINISH_THICKNESS : w.thickness || GAME_WALL_THICKNESS;
      const core = Math.max(2, thickness * scale);
      if (isFinish) {
        drawFinish(ctx, X0, Y0, X1, Y1, thickness, scale);
        continue;
      }
      if (ax === bx && ay === by) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X0, Y0, core / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = core;
      ctx.beginPath();
      ctx.moveTo(X0, Y0);
      ctx.lineTo(X1, Y1);
      ctx.stroke();
      continue;
    }

    const visual = wallVisual(w.type);
    if (visual.kind === "finish") {
      drawFinish(ctx, X0, Y0, X1, Y1, w.thickness, scale);
      continue;
    }
    // Draw at the wall's real thickness, in world units. The engine collides at
    // `arrowRadius + thickness / 2`, so a wall drawn thinner than it collides
    // reads as the arrow bonking against nothing. A small floor keeps the
    // thinnest walls visible at the replay's zoom.
    const core = Math.max(1.5, w.thickness * scale);
    if (ax === bx && ay === by) {
      // A single-point wall: the engine collides with it as a zero-length
      // segment, so draw the dot it really is.
      ctx.fillStyle = withAlpha(visual.color, 0.16);
      ctx.beginPath();
      ctx.arc(X0, Y0, core * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = visual.color;
      ctx.beginPath();
      ctx.arc(X0, Y0, core / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // A faint wide pass under a crisp core reads as the game's neon walls.
    ctx.strokeStyle = withAlpha(visual.color, 0.16);
    ctx.lineWidth = Math.max(3, core * 2.4);
    ctx.beginPath();
    ctx.moveTo(X0, Y0);
    ctx.lineTo(X1, Y1);
    ctx.stroke();
    ctx.strokeStyle = visual.color;
    ctx.lineWidth = core;
    ctx.beginPath();
    ctx.moveTo(X0, Y0);
    ctx.lineTo(X1, Y1);
    ctx.stroke();
  }
}

/**
 * Stroke a run's trail in full up to `upto`; `glow` adds the halo pass.
 *
 * When `clip` is given (the viewport size in CSS px), only the on-screen tail of
 * the trail is stroked. The trail is drawn from the spawn every frame, so on a
 * long run the cost grows with the frame index; walking back from the head to
 * the last off-screen point keeps each frame's work bounded by what is visible.
 */
export function strokeTrail(
  ctx: CanvasRenderingContext2D,
  path: SimResult["path"],
  upto: number,
  color: string,
  glow: boolean,
  pc: PaintCtx,
  clip?: { w: number; h: number; pad?: number },
) {
  if (upto < 1) return;
  const { tx, ty } = pc;
  let from = 1;
  if (clip) {
    const pad = clip.pad ?? 120;
    let i = upto;
    while (i > 1) {
      const p = path[i - 1];
      const px = tx(p.x);
      const py = ty(p.y);
      if (px < -pad || px > clip.w + pad || py < -pad || py > clip.h + pad) break;
      i--;
    }
    // Start one point earlier so the segment entering the view is drawn too.
    from = Math.max(1, i - 1);
  }
  const startPt = path[from - 1];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (glow) {
    for (const [w, a] of [
      [7, 0.12],
      [3.5, 0.3],
    ] as const) {
      ctx.strokeStyle = withAlpha(color, a);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(tx(startPt.x), ty(startPt.y));
      for (let i = from; i <= upto; i++) ctx.lineTo(tx(path[i].x), ty(path[i].y));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = glow ? lighten(color, 0.35) : color;
  ctx.lineWidth = glow ? 1.4 : 2;
  ctx.beginPath();
  ctx.moveTo(tx(startPt.x), ty(startPt.y));
  for (let i = from; i <= upto; i++) ctx.lineTo(tx(path[i].x), ty(path[i].y));
  ctx.stroke();
}

/**
 * The game's thrust flame, drawn behind the arrow as two nested triangles.
 * `len`/`halfW` are canvas px *after* the transform, so `pxScale` (the current
 * zoom) must be folded in — otherwise the flame keeps its pixel size while the
 * arrow shrinks and it dwarfs the arrow when zoomed out.
 */
export function drawGameThrust(
  ctx: CanvasRenderingContext2D,
  kind: ArrowKind,
  x: number,
  y: number,
  rot: number,
  radius: number,
  pxScale: number,
  tx: (x: number) => number,
  ty: (y: number) => number,
) {
  const [outer, inner] = GAME_THRUST_COLORS[kind];
  // Behind the arrow is -forward; forward is (cos rot, sin rot). `back` is in
  // world units and goes through `tx`/`ty`, so it already scales.
  const back = radius * 0.85;
  const ox = x - Math.cos(rot) * back;
  const oy = y - Math.sin(rot) * back;
  const len = radius * 2.6 * pxScale;
  const halfW = radius * 0.7 * pxScale;
  ctx.save();
  ctx.translate(tx(ox), ty(oy));
  ctx.rotate(rot + Math.PI);
  for (const [color, f] of [
    [outer, 1],
    [inner, 0.6],
  ] as const) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, -halfW * f);
    ctx.lineTo(len * f, 0);
    ctx.lineTo(0, halfW * f);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The arrow's collision circle, drawn faintly under the sprite in game mode. */
export function drawCollisionCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  scale: number,
  tx: (x: number) => number,
  ty: (y: number) => number,
) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = GAME_COLLISION_COLOR;
  ctx.beginPath();
  ctx.arc(tx(x), ty(y), Math.max(2, radius * scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = GAME_COLLISION_COLOR;
  ctx.lineWidth = Math.max(1.2, scale * 0.9);
  ctx.stroke();
  ctx.restore();
}

/** Draw the two-tone arrow sprite at a world pose. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  kind: ArrowKind,
  x: number,
  y: number,
  rot: number,
  scale: number,
  radius: number,
  bodyColor: string,
  tailColor: string,
) {
  drawArrowSprite(ctx, kind, x, y, rot, scale, radius, bodyColor, tailColor);
}

/**
 * The in-game input readout: two steering dots that light up as the player
 * steers. Symbol 1 = right, 2 = left, 3 = brake (both). Drawn in screen space
 * at a fixed size in a corner of the canvas, like the game's own HUD, so it
 * reads the same at any zoom.
 */
export function drawInputIndicator(
  ctx: CanvasRenderingContext2D,
  symbol: number | undefined,
  width: number,
  height: number,
  opts: { radius?: number; margin?: number; color?: string } = {},
) {
  const r = opts.radius ?? 9;
  const margin = opts.margin ?? 16;
  const color = opts.color ?? "#e8e8ef";
  const gap = r * 2 + 8;
  const cy = height - margin - r;
  const rx = width - margin - r;
  const lx = rx - gap;

  const left = symbol === 2 || symbol === 3;
  const right = symbol === 1 || symbol === 3;

  const dot = (cx: number, on: boolean) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (on) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  ctx.save();
  // A faint plate so the dots read over bright walls.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.roundRect(lx - r - 8, cy - r - 8, gap + 2 * r + 16, 2 * r + 16, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  dot(lx, left);
  dot(rx, right);
  ctx.restore();
}
