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
import type {
  ForceField,
  SimGeometry,
  SimMotion,
  SimPortal,
  SimResult,
  SimTrigger,
  SimWall,
} from "@/lib/replay-sim";
import { motionOffsetAt } from "@/lib/replay-sim";

export type RenderMode = "lines" | "game";

/** The world→px transform and mode a painter needs. */
export interface PaintCtx {
  tx: (x: number) => number;
  ty: (y: number) => number;
  /** World→px scale, used for stroke widths and sprites. */
  scale: number;
  mode: RenderMode;
  /**
   * The level's moving blocks, indexed by `SimWall.motion`. Absent for levels
   * with none; a moving wall is drawn translated by its offset at the tick.
   */
  motions?: SimMotion[];
  /**
   * World-space rectangle the canvas can show. Painters skip geometry entirely
   * outside it. A generated endless course has ~1400 walls but only a handful
   * are ever on screen, so without this every frame strokes the whole level.
   */
  view?: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The world-space box a wall can occupy, accounting for rotation and motion. */
function wallBounds(
  w: SimWall,
  motions?: SimMotion[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Math.min(w.ax, w.bx);
  let maxX = Math.max(w.ax, w.bx);
  let minY = Math.min(w.ay, w.by);
  let maxY = Math.max(w.ay, w.by);
  if (w.pivot && w.rotationSpeed) {
    // The wall sweeps a disc about the pivot; bound it by that disc.
    const r = Math.sqrt(
      Math.max(
        (w.ax - w.pivot.x) ** 2 + (w.ay - w.pivot.y) ** 2,
        (w.bx - w.pivot.x) ** 2 + (w.by - w.pivot.y) ** 2,
      ),
    );
    minX = Math.min(minX, w.pivot.x - r);
    maxX = Math.max(maxX, w.pivot.x + r);
    minY = Math.min(minY, w.pivot.y - r);
    maxY = Math.max(maxY, w.pivot.y + r);
  }
  // A mover travels as far as its offset, in either direction.
  const m = motions && w.motion != null && w.motion >= 0 ? motions[w.motion] : undefined;
  if (m) {
    minX -= Math.abs(m.dx);
    maxX += Math.abs(m.dx);
    minY -= Math.abs(m.dy);
    maxY += Math.abs(m.dy);
  }
  return { minX, minY, maxX, maxY };
}

/** Whether a wall can be skipped because it lies entirely off screen. */
function offscreen(w: SimWall, pc: PaintCtx): boolean {
  const view = pc.view;
  if (!view) return false;
  const b = wallBounds(w, pc.motions);
  return b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY;
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
  const { tx, ty, mode, view } = pc;
  for (const z of geometry.zones) {
    if (
      view &&
      (z.x1 < view.minX || z.x0 > view.maxX || z.y1 < view.minY || z.y0 > view.maxY)
    )
      continue;
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

/** One drifting particle inside a field; `seed`/`phase` are stable per particle. */
export interface FieldParticle {
  /** 0..1, its stable position along the flow. */
  seed: number;
  /** 0..1, its lane offset across the flow. */
  phase: number;
}

/** Target spacing between particles, in canvas px (so density is zoom-independent). */
const FIELD_PARTICLE_SPACING = 26;
/** Cap per field so a huge zone cannot spawn thousands of particles. */
const FIELD_PARTICLES_MAX = 220;

/** The polygon's bounding box. */
function fieldBounds(pts: Array<{ x: number; y: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Wind/suction fields: a faint white area with tiny arrow particles flowing
 * through it. Wind particles march along `direction`; suction particles march
 * inward toward the centroid. `time` is in seconds so the drift is smooth and
 * independent of frame rate; `particles` is a stable pool so the field does not
 * jitter between frames.
 *
 * This is a site-only mechanic (the engine has no force fields), so the render
 * is purely a preview of the simulation layer's per-tick velocity delta.
 */
export function paintForceFields(
  ctx: CanvasRenderingContext2D,
  fields: ForceField[],
  pc: PaintCtx,
  particles: FieldParticle[],
  time = 0,
) {
  const { tx, ty } = pc;
  for (const f of fields) {
    const pts = f.points;
    if (pts.length < 3) continue;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    // Faint white area enclosing the field.
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => {
      const X = tx(p.x);
      const Y = ty(p.y);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // A unit vector along the flow at each point (wind: `direction`; suction:
    // toward the centroid). Particles are advected from a random start point.
    const flowAt = (x: number, y: number): { x: number; y: number } => {
      if (f.kind === "suction") {
        const vx = cx - x;
        const vy = cy - y;
        const len = Math.hypot(vx, vy) || 1;
        return { x: vx / len, y: vy / len };
      }
      const dir = f.direction ?? 0;
      return { x: Math.cos(dir), y: Math.sin(dir) };
    };

    // Seed particles on a grid that covers the field's screen bounds, so the
    // whole zone fills evenly at any zoom. Grid spacing is in canvas px, so a
    // wider zone simply gets more particles; the pool is read modulo its length
    // so the same stable seeds are reused as the grid grows.
    const b = fieldBounds(pts);
    const stepPx = FIELD_PARTICLE_SPACING;
    const cols = Math.max(1, Math.round((b.w * pc.scale) / stepPx) + 1);
    const rows = Math.max(1, Math.round((b.h * pc.scale) / stepPx) + 1);
    const span = Math.max(1, Math.hypot(b.w, b.h));
    // Wind marches the particle fully across the field and wraps; suction runs
    // from the edge to the centre and resets, so the pull always reads inward.
    const speed = Math.min(1, Math.abs(f.strength) * 20 + 0.25);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    let drawn = 0;
    for (let gy = 0; gy < rows && drawn < FIELD_PARTICLES_MAX; gy++) {
      for (let gx = 0; gx < cols && drawn < FIELD_PARTICLES_MAX; gx++) {
        const p = particles[drawn % particles.length];
        drawn++;
        // `t` advances with time so the particle marches across the field; the
        // start point is a stable hash of the grid cell, so the field shimmers
        // instead of jumping between frames.
        const t = (p.seed + time * speed * (0.5 + 0.5 * p.phase)) % 1;
        let sx = b.minX + ((gx + 0.5) / cols) * b.w;
        let sy = b.minY + ((gy + 0.5) / rows) * b.h;
        if (f.kind === "suction") {
          // Start on the box edge and travel to the centre.
          sx = sx * (1 - t) + cx * t;
          sy = sy * (1 - t) + cy * t;
        } else {
          const flow = flowAt(sx, sy);
          const travel = (t - 0.5) * span;
          sx += flow.x * travel;
          sy += flow.y * travel;
        }
        const X = tx(sx);
        const Y = ty(sy);
        const flow = flowAt(sx, sy);
        const head = 7;
        ctx.beginPath();
        ctx.moveTo(X - flow.x * head, Y - flow.y * head);
        ctx.lineTo(X, Y);
        ctx.stroke();
        // Arrowhead.
        const ang = Math.atan2(flow.y, flow.x);
        const h = 3.2;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X - Math.cos(ang - 0.5) * h, Y - Math.sin(ang - 0.5) * h);
        ctx.lineTo(X - Math.cos(ang + 0.5) * h, Y - Math.sin(ang + 0.5) * h);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/**
 * Accelerator wires. Drawn as a thin charged line with a faint glow, so an
 * author can tell at a glance which way a run will be launched — the push
 * direction is not the wire's own orientation (it is captured from the arrow's
 * velocity at the crossing), so no arrowhead is drawn.
 */
export function paintTriggers(ctx: CanvasRenderingContext2D, triggers: SimTrigger[], pc: PaintCtx) {
  const { tx, ty, scale } = pc;
  const visual = wallVisual("accelerator");
  ctx.save();
  ctx.lineCap = "round";
  for (const t of triggers) {
    const ax = tx(t.ax);
    const ay = ty(t.ay);
    const bx = tx(t.bx);
    const by = ty(t.by);
    // Soft outer glow.
    ctx.strokeStyle = withAlpha(visual.color, 0.18);
    ctx.lineWidth = Math.max(6, 7 * scale);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // Bright core.
    ctx.strokeStyle = visual.color;
    ctx.lineWidth = Math.max(1.5, visual.width * scale);
    ctx.setLineDash([9, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
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
    if (offscreen(w, pc)) continue;
    let ax = w.ax;
    let ay = w.ay;
    let bx = w.bx;
    let by = w.by;
    // A moving block is drawn at its offset for this tick, so the rendered wall
    // tracks the geometry the engine actually collides against.
    if (pc.motions && w.motion != null && w.motion >= 0) {
      const m = pc.motions[w.motion];
      if (m) {
        const off = motionOffsetAt(m.dx, m.dy, m.period, tick);
        ax += off.x;
        ay += off.y;
        bx += off.x;
        by += off.y;
      }
    }
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
  power = 1,
  tick = 0,
) {
  const [outer, inner] = GAME_THRUST_COLORS[kind];
  // Behind the arrow is -forward; forward is (cos rot, sin rot). `back` is in
  // world units and goes through `tx`/`ty`, so it already scales.
  const back = radius * 0.85;
  const ox = x - Math.cos(rot) * back;
  const oy = y - Math.sin(rot) * back;
  // The flame is not a fixed decal: it grows with the engine's thrust level and
  // flickers a little every 240Hz tick, so it reads as an engine firing rather
  // than a shape glued to the arrow. The flicker is a pure function of the tick,
  // so the offline export reproduces the interactive view exactly.
  const p = Math.max(0, Math.min(1, power));
  const flicker = 0.9 + 0.1 * (Math.sin(tick * 12.9898) * 0.5 + 0.5);
  const grow = (0.4 + 0.6 * p) * flicker;
  const len = radius * 2.6 * pxScale * grow;
  const halfW = radius * 0.7 * pxScale * grow;
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
