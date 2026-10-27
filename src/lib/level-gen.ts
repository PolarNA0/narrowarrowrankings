/**
 * Procedural level generation for the Generator tool.
 *
 * Everything here is a pure function of the seed: the same options always
 * produce the same level, so a generated level is reproducible and shareable.
 * Output is a `NalvlLevel`, which the editor opens directly and
 * `nalvlToRawLevelData` lowers to the engine payload.
 *
 * The shapes here are measured off the 72 official levels rather than invented,
 * because the previous generator produced a plain box with straight bars poking
 * through it, which reads nothing like a real level. What the official set
 * actually does, and what this module copies:
 *
 *   - Everything sits on a 30-unit lattice, and walls are 8 units thick almost
 *     everywhere. The single finish wall is 32, which is what makes it read as a
 *     gate rather than another wall.
 *   - Corridors are narrow: the most common free gap between walls is 30 units,
 *     then 60, then 120.
 *   - Walls enclose. Official levels are closed shapes (rings, crosses, spirals,
 *     bordered motifs) that force the arrow to wind through them.
 *   - They are *sparse*. A median official level has only 51 obstacles over a
 *     ~1350x1560 extent, so it is mostly open space with a designed skeleton,
 *     not a dense lattice. A full maze is far busier than any official level, so
 *     the carving here retains only a fraction of its walls.
 *   - The finish is a short gate on the level's boundary, in the part furthest
 *     from the spawn.
 *   - The arrow always spawns at the world origin facing -y and no payload field
 *     moves it, so every template keeps that spot clear.
 *
 * The templates differ in how the skeleton is made, not in quality: `maze` is a
 * carved labyrinth, `rings` nested enclosures, `symmetry` a mirrored motif, and
 * `tunnels` a coarse grid of long runs and rooms.
 */

import {
  defaultObstacle,
  emptyLevel,
  type NalvlLevel,
  type NalvlObstacle,
  type NalvlPoint,
  type NalvlWallType,
  type NalvlZoneType,
} from "./nalvl";

/** The lattice every official coordinate is a multiple of. */
export const GEN_GRID = 30;
/** The most common wall thickness in the official levels. */
export const GEN_WALL_THICKNESS = 8;
/** Official finish walls are thicker, which is what makes them read as a gate. */
export const GEN_FINISH_THICKNESS = 32;
/** Corridor width. Official free gaps cluster at 30/60/120; 60 is the playable middle. */
export const GEN_CORRIDOR = 60;

export type GenTemplate = "maze" | "rings" | "symmetry" | "tunnels";

export const GEN_TEMPLATES: { id: GenTemplate; label: string; blurb: string }[] = [
  { id: "maze", label: "Maze", blurb: "A winding labyrinth of 60-wide corridors." },
  { id: "rings", label: "Rings", blurb: "Nested enclosures you spiral out of through gaps." },
  { id: "symmetry", label: "Symmetry", blurb: "A mirrored four-way motif inside a closed border." },
  { id: "tunnels", label: "Tunnels", blurb: "Wide straight runs and big rooms, like Highway Jet." },
];

export interface GenOptions {
  template: GenTemplate;
  seed: number;
  /** Rough extent in world units; rounded to whole cells. */
  width: number;
  height: number;
  /** 0..1 — how much of the skeleton survives, plus hazards and zones. */
  density: number;
  /** Include boost/ice zones. */
  zones: boolean;
  /** Include free-standing rotating bars (never across a corridor). */
  rotating: boolean;
}

export const DEFAULT_GEN_OPTIONS: GenOptions = {
  template: "maze",
  seed: 1,
  width: 1200,
  height: 1200,
  density: 0.35,
  zones: true,
  rotating: false,
};

/** mulberry32 — a small, fast, seedable PRNG (deterministic across runs). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/** Round to the lattice, so every coordinate the generator emits is legal. */
function snap(v: number): number {
  return Math.round(v / GEN_GRID) * GEN_GRID;
}

function wallSeg(
  a: NalvlPoint,
  b: NalvlPoint,
  type: NalvlWallType = "normal",
  thickness = GEN_WALL_THICKNESS,
): NalvlObstacle {
  return { ...defaultObstacle("wall", [a, b]), wallType: type, thickness };
}

function zoneBox(cx: number, cy: number, size: number, type: NalvlZoneType): NalvlObstacle {
  const h = size / 2;
  return {
    ...defaultObstacle("zone", [
      { x: cx - h, y: cy - h },
      { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h },
      { x: cx - h, y: cy + h },
    ]),
    zoneType: type,
  };
}

/** Shortest distance from a point to a segment; used for clearance checks. */
function distToSeg(p: NalvlPoint, a: NalvlPoint, b: NalvlPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to the nearest edge of an obstacle polygon. */
function distToObstacle(p: NalvlPoint, o: NalvlObstacle): number {
  const pts = o.points;
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  const n = pts.length >= 3 ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    best = Math.min(best, distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Border and finish
// ---------------------------------------------------------------------------

/**
 * A closed border with a finish gate cut into the side nearest `toward`.
 *
 * The gate is a 32-thick finish wall exactly one cell wide, replacing that
 * stretch of border. Putting it on the boundary is what the official levels do,
 * and it means the gate can never be bypassed by driving round it.
 */
function borderedLevel(
  halfW: number,
  halfH: number,
  toward: NalvlPoint,
  cell: number,
): NalvlObstacle[] {
  const x0 = -halfW;
  const x1 = halfW;
  const y0 = -halfH;
  const y1 = halfH;
  // Pick the side the target lies furthest toward, in relative terms.
  const rx = Math.abs(toward.x) / halfW;
  const ry = Math.abs(toward.y) / halfH;
  const half = cell / 2;
  const out: NalvlObstacle[] = [];

  if (rx >= ry) {
    const onEast = toward.x >= 0;
    const x = onEast ? x1 : x0;
    // The opposite side must be the one the gate is *not* on, or the border is
    // left open and the arrow can drive off the map.
    const opposite = onEast ? x0 : x1;
    const c = Math.max(y0 + half, Math.min(y1 - half, snap(toward.y)));
    out.push(wallSeg({ x, y: y0 }, { x, y: c - half }));
    out.push(wallSeg({ x, y: c + half }, { x, y: y1 }));
    out.push(wallSeg({ x, y: c - half }, { x, y: c + half }, "finish", GEN_FINISH_THICKNESS));
    out.push(wallSeg({ x: x0, y: y0 }, { x: x1, y: y0 }));
    out.push(wallSeg({ x: x0, y: y1 }, { x: x1, y: y1 }));
    out.push(wallSeg({ x: opposite, y: y0 }, { x: opposite, y: y1 }));
  } else {
    const onSouth = toward.y >= 0;
    const y = onSouth ? y1 : y0;
    const opposite = onSouth ? y0 : y1;
    const c = Math.max(x0 + half, Math.min(x1 - half, snap(toward.x)));
    out.push(wallSeg({ x: x0, y }, { x: c - half, y }));
    out.push(wallSeg({ x: c + half, y }, { x: x1, y }));
    out.push(wallSeg({ x: c - half, y }, { x: c + half, y }, "finish", GEN_FINISH_THICKNESS));
    out.push(wallSeg({ x: x0, y: y0 }, { x: x0, y: y1 }));
    out.push(wallSeg({ x: x1, y: y0 }, { x: x1, y: y1 }));
    out.push(wallSeg({ x: x0, y: opposite }, { x: x1, y: opposite }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Maze carving
// ---------------------------------------------------------------------------

interface Grid {
  cols: number;
  rows: number;
  cell: number;
  /** Vertical walls: between (cx, cy) and (cx + 1, cy). */
  v: Uint8Array;
  /** Horizontal walls: between (cx, cy) and (cx, cy + 1). */
  h: Uint8Array;
}

const vAt = (cols: number, cx: number, cy: number) => cy * cols + cx;
const hAt = (cols: number, cx: number, cy: number) => cy * cols + cx;

/**
 * Carve a maze by randomised depth-first search, then delete a large fraction of
 * the surviving walls.
 *
 * The deletion is the important part. A perfect maze has exactly one route
 * between any two cells and about twice as many walls as an official level, so
 * it plays as a long backtracking slog and looks nothing like one. Removing most
 * of the remaining walls leaves the open, designed-looking skeleton the official
 * levels have, and can never disconnect anything because only walls are removed.
 * What survives reads as rooms and corridors rather than a lattice.
 */
function carveMaze(
  cols: number,
  rows: number,
  cell: number,
  rand: () => number,
  keep: number,
): Grid {
  const v = new Uint8Array(cols * rows).fill(1);
  const h = new Uint8Array(cols * rows).fill(1);

  const visited = new Uint8Array(cols * rows);
  const start = { cx: (cols - 1) / 2, cy: (rows - 1) / 2 };
  const stack = [start];
  visited[vAt(cols, start.cx, start.cy)] = 1;
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = dirs
      .map((d) => ({ cx: cur.cx + d.dx, cy: cur.cy + d.dy }))
      .filter(
        (n) =>
          n.cx >= 0 && n.cx < cols && n.cy >= 0 && n.cy < rows && !visited[vAt(cols, n.cx, n.cy)],
      );
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const next = pick(rand, options);
    if (next.cx !== cur.cx) v[vAt(cols, Math.min(cur.cx, next.cx), cur.cy)] = 0;
    else h[hAt(cols, cur.cx, Math.min(cur.cy, next.cy))] = 0;
    visited[vAt(cols, next.cx, next.cy)] = 1;
    stack.push(next);
  }

  // Open a plaza around the spawn. The arrow spawns at the origin facing -y and
  // needs a runway to accelerate down, so the walls of the spawn cell and its
  // neighbours are removed. Only walls are removed, so this cannot disconnect
  // anything, and it brings the spawn clearance up to the official median.
  for (let cy = start.cy - 1; cy <= start.cy + 1; cy++) {
    for (let cx = start.cx - 1; cx <= start.cx + 1; cx++) {
      if (cx >= 0 && cx < cols - 1 && cy >= 0 && cy < rows) v[vAt(cols, cx, cy)] = 0;
      if (cx >= 0 && cx < cols && cy >= 0 && cy < rows - 1) h[hAt(cols, cx, cy)] = 0;
    }
  }

  // Thin the walls down to roughly the official density. The outer ring of walls
  // is left alone; `borderedLevel` supplies that.
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols - 1; cx++) {
      const i = vAt(cols, cx, cy);
      if (v[i] && rand() > keep) v[i] = 0;
    }
  }
  for (let cy = 0; cy < rows - 1; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = hAt(cols, cx, cy);
      if (h[i] && rand() > keep) h[i] = 0;
    }
  }

  return { cols, rows, cell, v, h };
}

/** The cell centre in world units. An odd grid puts the middle cell on the origin. */
function cellCenter(grid: Grid, cx: number, cy: number): NalvlPoint {
  return { x: (cx - (grid.cols - 1) / 2) * grid.cell, y: (cy - (grid.rows - 1) / 2) * grid.cell };
}

/** The reachable cell furthest from the spawn, by BFS over the carved space. */
function farthestCell(grid: Grid): NalvlPoint {
  const { cols, rows } = grid;
  const sx = (cols - 1) / 2;
  const sy = (rows - 1) / 2;
  const seen = new Uint8Array(cols * rows);
  const queue: { cx: number; cy: number }[] = [{ cx: sx, cy: sy }];
  seen[vAt(cols, sx, sy)] = 1;
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  let last = { cx: sx, cy: sy };
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    last = cur;
    for (const d of dirs) {
      const n = { cx: cur.cx + d.dx, cy: cur.cy + d.dy };
      if (n.cx < 0 || n.cx >= cols || n.cy < 0 || n.cy >= rows) continue;
      if (seen[vAt(cols, n.cx, n.cy)]) continue;
      const blocked =
        n.cx !== cur.cx
          ? grid.v[vAt(cols, Math.min(cur.cx, n.cx), cur.cy)]
          : grid.h[hAt(cols, cur.cx, Math.min(cur.cy, n.cy))];
      if (blocked) continue;
      seen[vAt(cols, n.cx, n.cy)] = 1;
      queue.push(n);
    }
  }
  return cellCenter(grid, last.cx, last.cy);
}

/** Emit the surviving interior walls of a carved grid. */
function emitGrid(grid: Grid): NalvlObstacle[] {
  const { cols, rows, cell } = grid;
  const cxAt = (cx: number) => (cx - (cols - 1) / 2) * cell;
  const cyAt = (cy: number) => (cy - (rows - 1) / 2) * cell;
  const out: NalvlObstacle[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols - 1; cx++) {
      if (!grid.v[vAt(cols, cx, cy)]) continue;
      const x = cxAt(cx) + cell / 2;
      out.push(wallSeg({ x, y: cyAt(cy) - cell / 2 }, { x, y: cyAt(cy) + cell / 2 }));
    }
  }
  for (let cy = 0; cy < rows - 1; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!grid.h[hAt(cols, cx, cy)]) continue;
      const y = cyAt(cy) + cell / 2;
      out.push(wallSeg({ x: cxAt(cx) - cell / 2, y }, { x: cxAt(cx) + cell / 2, y }));
    }
  }
  return out;
}

/**
 * Odd cell counts keep the spawn cell exactly on the origin, so the arrow never
 * starts inside a wall — the failure the editor warns about.
 */
function gridSize(extent: number, cell: number): number {
  const n = Math.max(5, Math.round(extent / cell));
  return n % 2 === 0 ? n + 1 : n;
}

function genMaze(o: GenOptions, rand: () => number): NalvlLevel {
  const cell = GEN_CORRIDOR;
  const cols = gridSize(o.width, cell);
  const rows = gridSize(o.height, cell);
  const grid = carveMaze(cols, rows, cell, rand, 0.1 + o.density * 0.35);
  const level = emptyLevel(`Maze ${o.seed}`);
  level.obstacles = [
    ...emitGrid(grid),
    ...borderedLevel((cols * cell) / 2, (rows * cell) / 2, farthestCell(grid), cell),
  ];
  return level;
}

/** The same carving on a coarser lattice, which yields long runs and big rooms. */
function genTunnels(o: GenOptions, rand: () => number): NalvlLevel {
  const cell = GEN_CORRIDOR * 2;
  const cols = gridSize(o.width, cell);
  const rows = gridSize(o.height, cell);
  const grid = carveMaze(cols, rows, cell, rand, 0.12 + o.density * 0.3);
  const level = emptyLevel(`Tunnels ${o.seed}`);
  level.obstacles = [
    ...emitGrid(grid),
    ...borderedLevel((cols * cell) / 2, (rows * cell) / 2, farthestCell(grid), cell),
  ];
  return level;
}

// ---------------------------------------------------------------------------
// Rings and symmetry
// ---------------------------------------------------------------------------

/**
 * Nested squares, each broken by one gap, with a finish gate on the outer border.
 *
 * The arrow starts in the middle and spirals out. Each ring is a closed square
 * with a single opening, so the space between two rings is an annulus the arrow
 * can always travel around — which is what makes the level solvable, and why the
 * gaps can be placed at random.
 */
function genRings(o: GenOptions, rand: () => number): NalvlLevel {
  const level = emptyLevel(`Rings ${o.seed}`);
  const cell = GEN_CORRIDOR;
  const maxRings = Math.max(2, Math.floor(Math.min(o.width, o.height) / 2 / cell) - 1);
  const rings = Math.max(2, Math.round(maxRings * (0.4 + o.density * 0.6)));
  const out: NalvlObstacle[] = [];
  const half = cell / 2;

  for (let k = 1; k <= rings; k++) {
    const r = k * cell;
    const gap = pick(rand, [0, 1, 2, 3]);
    const lo = -r + half;
    const hi = r - half;
    // Side 0 top, 1 bottom, 2 left, 3 right; the chosen side is split by the gap.
    if (gap === 0) {
      out.push(wallSeg({ x: -r, y: r }, { x: lo, y: r }));
      out.push(wallSeg({ x: hi, y: r }, { x: r, y: r }));
    } else {
      out.push(wallSeg({ x: -r, y: r }, { x: r, y: r }));
    }
    if (gap === 1) {
      out.push(wallSeg({ x: -r, y: -r }, { x: lo, y: -r }));
      out.push(wallSeg({ x: hi, y: -r }, { x: r, y: -r }));
    } else {
      out.push(wallSeg({ x: -r, y: -r }, { x: r, y: -r }));
    }
    if (gap === 2) {
      out.push(wallSeg({ x: -r, y: -r }, { x: -r, y: lo }));
      out.push(wallSeg({ x: -r, y: hi }, { x: -r, y: r }));
    } else {
      out.push(wallSeg({ x: -r, y: -r }, { x: -r, y: r }));
    }
    if (gap === 3) {
      out.push(wallSeg({ x: r, y: -r }, { x: r, y: lo }));
      out.push(wallSeg({ x: r, y: hi }, { x: r, y: r }));
    } else {
      out.push(wallSeg({ x: r, y: -r }, { x: r, y: r }));
    }
  }

  const outer = (rings + 1) * cell;
  const side = pick(rand, [0, 1, 2, 3]);
  const toward =
    side === 0
      ? { x: 0, y: 1 }
      : side === 1
        ? { x: 0, y: -1 }
        : side === 2
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };
  out.push(...borderedLevel(outer, outer, toward, cell));
  level.obstacles = out;
  return level;
}

/**
 * A motif drawn once and mirrored into all four quadrants, inside a closed
 * border. The mirroring is what the official Symmetry Pack does, and it makes an
 * arbitrary set of strokes read as a designed shape rather than noise.
 */
function genSymmetry(o: GenOptions, rand: () => number): NalvlLevel {
  const level = emptyLevel(`Symmetry ${o.seed}`);
  const cell = GEN_CORRIDOR;
  const cols = gridSize(o.width, cell);
  const rows = gridSize(o.height, cell);
  const halfW = (cols * cell) / 2;
  const halfH = (rows * cell) / 2;
  const strokes = Math.max(3, Math.round(4 + o.density * 12));
  const mirrored = new Map<string, { a: NalvlPoint; b: NalvlPoint }>();

  // Strokes must stop one cell short of the border, or they poke out through the
  // wall and the map stops being enclosed. All values stay multiples of `cell`,
  // so clamping with `min` keeps them on the lattice.
  const maxX = halfW - cell;
  const maxY = halfH - cell;
  for (let i = 0; i < strokes; i++) {
    // One quadrant only, kept clear of the origin so the spawn stays open.
    const ax = cell * (1 + Math.floor(rand() * Math.max(1, halfW / cell - 3)));
    const ay = cell * (1 + Math.floor(rand() * Math.max(1, halfH / cell - 3)));
    const horizontal = rand() < 0.5;
    const len = cell * (1 + Math.floor(rand() * 3));
    const a = { x: ax, y: ay };
    const b = horizontal
      ? { x: Math.min(ax + len, maxX), y: ay }
      : { x: ax, y: Math.min(ay + len, maxY) };
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const p = { x: a.x * sx, y: a.y * sy };
        const q = { x: b.x * sx, y: b.y * sy };
        const key = `${Math.min(p.x, q.x)},${Math.min(p.y, q.y)}:${Math.max(p.x, q.x)},${Math.max(p.y, q.y)}`;
        mirrored.set(key, { a: p, b: q });
      }
    }
  }

  const out: NalvlObstacle[] = [...mirrored.values()].map((s) => wallSeg(s.a, s.b));
  out.push(...borderedLevel(halfW, halfH, { x: 0, y: -1 }, cell));
  level.obstacles = out;
  return level;
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

/**
 * Scatter hazards, zones and rotating bars into the space the skeleton left open.
 *
 * A candidate is rejected unless it clears every wall by a margin, so a rotating
 * bar can never reach a wall and seal the corridor it sits in, and a zone never
 * straddles one. Every extent is a multiple of the lattice, so nothing lands
 * off-grid.
 */
function decorate(level: NalvlLevel, o: GenOptions, rand: () => number): void {
  const xs = level.obstacles.flatMap((ob) => ob.points.map((p) => p.x));
  const ys = level.obstacles.flatMap((ob) => ob.points.map((p) => p.y));
  if (xs.length === 0) return;
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  const placed: NalvlPoint[] = [];
  const clearOf = (p: NalvlPoint, margin: number) =>
    level.obstacles.every((ob) => distToObstacle(p, ob) >= margin) &&
    placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= margin * 2);

  // Must be a lattice multiple, or the bar's ends land off-grid.
  const half = GEN_GRID;
  let hazards = 0;
  let zones = 0;
  let bars = 0;
  const wantHazards = Math.round(o.density * 5);
  const wantZones = o.zones ? Math.round(o.density * 7) : 0;
  const wantBars = o.rotating ? Math.round(o.density * 4) : 0;

  for (let i = 0; i < 120; i++) {
    if (hazards >= wantHazards && zones >= wantZones && bars >= wantBars) break;
    const p = {
      x: snap(bounds.minX + rand() * (bounds.maxX - bounds.minX)),
      y: snap(bounds.minY + rand() * (bounds.maxY - bounds.minY)),
    };
    // Never crowd the spawn: the arrow needs room to accelerate off the line.
    if (Math.hypot(p.x, p.y) < GEN_CORRIDOR * 1.5) continue;

    const axis = (horizontal: boolean): [NalvlPoint, NalvlPoint] =>
      horizontal
        ? [
            { x: p.x - half, y: p.y },
            { x: p.x + half, y: p.y },
          ]
        : [
            { x: p.x, y: p.y - half },
            { x: p.x, y: p.y + half },
          ];

    if (bars < wantBars && clearOf(p, GEN_CORRIDOR)) {
      const pts = axis(rand() < 0.5);
      level.obstacles.push({
        ...defaultObstacle("wall", pts),
        rotationPivot: { x: p.x, y: p.y },
        rotationSpeed: (rand() < 0.5 ? -1 : 1) * (0.0008 + rand() * 0.0012),
      });
      placed.push(p);
      bars += 1;
      continue;
    }
    if (zones < wantZones && clearOf(p, GEN_CORRIDOR * 0.9)) {
      level.obstacles.push(zoneBox(p.x, p.y, GEN_CORRIDOR, rand() < 0.6 ? "boost" : "ice"));
      placed.push(p);
      zones += 1;
      continue;
    }
    if (hazards < wantHazards && clearOf(p, GEN_CORRIDOR * 0.9)) {
      const pts = axis(rand() < 0.5);
      level.obstacles.push(wallSeg(pts[0], pts[1], rand() < 0.5 ? "death" : "bouncy"));
      placed.push(p);
      hazards += 1;
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Give every obstacle a fresh id.
 *
 * `defaultObstacle` mints ids from a module counter, so a level generated twice
 * from the same seed would otherwise differ in its ids. Re-minting them here
 * keeps the output identical for identical options, which is what makes a seed a
 * shareable recipe.
 */
function reid(level: NalvlLevel): NalvlLevel {
  return { ...level, obstacles: level.obstacles.map((o, i) => ({ ...o, id: `g${i}` })) };
}

/** Generate a level from options. Deterministic in `options.seed`. */
export function generateLevel(options: GenOptions): NalvlLevel {
  const rand = mulberry32(options.seed);
  const o: GenOptions = {
    ...options,
    width: Math.max(GEN_CORRIDOR * 5, options.width),
    height: Math.max(GEN_CORRIDOR * 5, options.height),
    density: Math.min(1, Math.max(0, options.density)),
  };
  let level: NalvlLevel;
  if (o.template === "rings") level = genRings(o, rand);
  else if (o.template === "symmetry") level = genSymmetry(o, rand);
  else if (o.template === "tunnels") level = genTunnels(o, rand);
  else level = genMaze(o, rand);
  decorate(level, o, rand);
  return reid(level);
}

/**
 * Whether the arrow can reach the finish from the spawn.
 *
 * The walls are rasterised onto a fine lattice and flood-filled from the origin,
 * which catches the two ways a generated level can be broken: the spawn sealed
 * inside a wall, and a finish walled off from the rest of the map. Success is
 * reaching a free cell beside the finish gate.
 *
 * This is a reachability check on the free space, not a physics check: a level
 * can be reachable and still be too tight to drive. Corridor widths are held at
 * `GEN_CORRIDOR` by construction rather than verified here.
 */
export function isCompletable(level: NalvlLevel, raster = 10): boolean {
  const solid = level.obstacles.filter((o) => o.kind === "wall");
  if (solid.length === 0) return false;
  const xs = solid.flatMap((o) => o.points.map((p) => p.x));
  const ys = solid.flatMap((o) => o.points.map((p) => p.y));
  const minX = Math.min(...xs) - raster * 2;
  const minY = Math.min(...ys) - raster * 2;
  const w = Math.ceil((Math.max(...xs) + raster * 2 - minX) / raster);
  const h = Math.ceil((Math.max(...ys) + raster * 2 - minY) / raster);
  if (w * h > 4_000_000) return false;
  const blocked = new Uint8Array(w * h);
  const finishCells = new Uint8Array(w * h);
  const toGx = (x: number) => Math.floor((x - minX) / raster);
  const toGy = (y: number) => Math.floor((y - minY) / raster);

  // A wall blocks every cell whose centre lies within half its thickness, which
  // is the set of cells the wall actually passes through at this resolution.
  for (const o of solid) {
    const isFinish = o.wallType === "finish";
    const span = Math.max(1, Math.ceil((o.thickness ?? GEN_WALL_THICKNESS) / 2 / raster));
    const pts = o.points;
    const edges = pts.length >= 3 ? pts.length : pts.length - 1;
    for (let i = 0; i < edges; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / raster));
      for (let s = 0; s <= steps; s++) {
        const gx = toGx(a.x + ((b.x - a.x) * s) / steps);
        const gy = toGy(a.y + ((b.y - a.y) * s) / steps);
        for (let oy = -span; oy <= span; oy++) {
          for (let ox = -span; ox <= span; ox++) {
            const px = gx + ox;
            const py = gy + oy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            blocked[py * w + px] = 1;
            if (isFinish) finishCells[py * w + px] = 1;
          }
        }
      }
    }
  }

  const sx = toGx(0);
  const sy = toGy(0);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || blocked[sy * w + sx]) return false;

  const seen = new Uint8Array(w * h);
  const queue = [sy * w + sx];
  seen[sy * w + sx] = 1;
  for (let i = 0; i < queue.length; i++) {
    const idx = queue[i];
    const gx = idx % w;
    const gy = (idx - gx) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      // Standing next to the gate is the finish; the gate itself is solid.
      if (finishCells[n]) return true;
      if (seen[n] || blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return false;
}
