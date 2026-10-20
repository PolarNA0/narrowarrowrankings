/**
 * Endless mode: a course stitched from "pieces", played for score instead of
 * time.
 *
 * The engine takes a level's whole obstacle list up front, so "endless" is
 * really a long deterministic course generated from a seed: you die long before
 * the end, and seed + input string reproduces the run exactly.
 *
 * The course runs along -y (the direction the arrow faces at spawn) and has a
 * *meandering* centreline. Every piece is a series of **gates** — a horizontal
 * wall with a gap centred on the centreline at that point. Gates are fair: you
 * approach a gate head-on and can slide left/right freely before reaching it, so
 * a passable gap is always reachable. Full-height vertical walls are never used
 * because they would trap an arrow on the wrong side. The meander is what makes
 * the mode about steering: hold straight and the gap slides out from under you.
 *
 * Score is the number of pieces passed: crossing a piece's far boundary adds a
 * point. Markers are emitted alongside the level so the play loop can count them
 * as the arrow crosses.
 */

import {
  defaultObstacle,
  emptyLevel,
  nalvlToRawLevelData,
  type NalvlLevel,
  type NalvlObstacle,
  type NalvlPoint,
  type NalvlWallType,
  type NalvlZoneType,
} from "./nalvl";
import type { RawLevelData } from "./replay-sim";

/** Full corridor width; obstacles span x in [-WIDTH/2, WIDTH/2]. */
export const COURSE_WIDTH = 900;
/** Length of one piece along the course (the -y axis). */
export const SECTION_LENGTH = 620;
/** Gap width at the start of the course. */
export const DEFAULT_GAP = 205;
/** The narrowest a gap may get; comfortably wider than any arrow (radius 12-20). */
export const MIN_GAP = 170;
/**
 * How far the centreline may wander from x=0. The arrow turns slowly (roughly
 * 1 rad per 2 s of held steer) and curves rather than sliding, so this is capped
 * to what it can actually track: a wider swing looks dramatic but cannot be
 * followed. It must still exceed half the gap, or a straight coast stays inside
 * every gap and the course plays itself.
 */
export const MAX_MEANDER = 150;

/** A point where the score increments: the boundary at the end of a piece. */
export interface SectionMarker {
  index: number;
  /** Course y of the boundary (negative; forward is -y). */
  y: number;
  /** Centreline x of the gap at this boundary. */
  x: number;
}

export interface EndlessCourse {
  level: NalvlLevel;
  data: RawLevelData;
  markers: SectionMarker[];
  seed: number;
}

/** Deterministic PRNG (mulberry32), so a seed always builds the same course. */
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wall(points: NalvlPoint[], wallType: NalvlWallType = "normal"): NalvlObstacle {
  return { ...defaultObstacle("wall", points), wallType };
}

function zone(points: NalvlPoint[], zoneType: NalvlZoneType): NalvlObstacle {
  return { ...defaultObstacle("zone", points), zoneType };
}

/** A box centred on `(cx, cy)` spanning `w` by `h`. */
function box(cx: number, cy: number, w: number, h: number): NalvlPoint[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

const HALF = COURSE_WIDTH / 2;

/**
 * A gate: two horizontal walls at course y leaving a `gap`-wide hole centred on
 * `gapX`. Emitted with no wall on a side the hole has reached the rail on.
 */
function gate(
  y: number,
  gapX: number,
  gap: number,
  wallType: NalvlWallType = "death",
): NalvlObstacle[] {
  const g = Math.max(MIN_GAP, gap) / 2;
  const left = clamp(gapX - g, -HALF, HALF);
  const right = clamp(gapX + g, -HALF, HALF);
  const out: NalvlObstacle[] = [];
  if (left > -HALF)
    out.push(
      wall(
        [
          { x: -HALF, y },
          { x: left, y },
        ],
        wallType,
      ),
    );
  if (right < HALF)
    out.push(
      wall(
        [
          { x: right, y },
          { x: HALF, y },
        ],
        wallType,
      ),
    );
  return out;
}

/** The centreline x at course y, linearly interpolated across one piece. */
function channelX(y: number, nearY: number, farY: number, entryX: number, exitX: number): number {
  const t = clamp((nearY - y) / (nearY - farY), 0, 1);
  return entryX + (exitX - entryX) * t;
}

export type EndlessPieceId = "empty" | "gate" | "slalom" | "gauntlet" | "boost" | "spinner";

export interface EndlessPiece {
  id: EndlessPieceId;
  label: string;
}

/**
 * The interior of a piece: zero or more gates between the entry and exit, plus
 * non-blocking decorations. The stitcher always adds the exit boundary gate, so
 * a piece never emits its own last gate.
 */
function buildSection(
  nearY: number,
  farY: number,
  entryX: number,
  exitX: number,
  gap: number,
  progress: number,
  rand: () => number,
): { obstacles: NalvlObstacle[]; piece: EndlessPiece } {
  const out: NalvlObstacle[] = [];
  const span = nearY - farY;

  // Interior gates ramp in with progress: none at the start, up to two later.
  const maxInterior = Math.min(2, Math.floor(progress * 3));
  const nInterior = maxInterior > 0 ? Math.floor(rand() * (maxInterior + 1)) : 0;
  for (let j = 1; j <= nInterior; j++) {
    const y = nearY - (j / (nInterior + 1)) * span;
    const cx = channelX(y, nearY, farY, entryX, exitX);
    out.push(...gate(y, cx, gap));
  }

  let piece: EndlessPiece;
  if (nInterior >= 2) piece = { id: "gauntlet", label: "Gauntlet" };
  else if (nInterior === 1) piece = { id: "gate", label: "Gate" };
  else piece = { id: "empty", label: "Straight" };

  // A boost zone sitting on the centreline: a reward for holding the line.
  if (rand() < 0.28) {
    const y = nearY - 0.5 * span;
    const cx = channelX(y, nearY, farY, entryX, exitX);
    out.push(zone(box(cx, y, Math.max(MIN_GAP, gap) * 0.55, 150), "boost"));
    if (nInterior === 0) piece = { id: "boost", label: "Boost" };
  }

  // A spinner tucked against a rail, clear of the centreline. Its swept circle
  // stays inside the piece and never reaches the channel, so it is decorative
  // pressure rather than a wall in the way.
  if (progress > 0.35 && rand() < 0.22) {
    const y = nearY - 0.5 * span;
    const cx = channelX(y, nearY, farY, entryX, exitX);
    const clear = Math.max(MIN_GAP, gap) / 2;
    const len = 70 + rand() * 50;
    const side = rand() < 0.5 ? -1 : 1;
    const pivotX = clamp(cx + side * (clear + len / 2 + 30), -HALF + len / 2, HALF - len / 2);
    const o = wall([
      { x: pivotX - len / 2, y },
      { x: pivotX + len / 2, y },
    ]);
    o.rotationPivot = { x: pivotX, y };
    o.rotationSpeed = (rand() < 0.5 ? -1 : 1) * (0.0006 + rand() * 0.0012);
    out.push(o);
    if (nInterior === 0) piece = { id: "spinner", label: "Spinner" };
  }

  return { obstacles: out, piece };
}

export interface EndlessOptions {
  seed: number;
  /** How many pieces to build. Defaults to a long, effectively-endless course. */
  sections?: number;
}

/**
 * Build an endless course from a seed. The same seed always yields the same
 * level, so a run can be replayed and verified from the seed and input string.
 */
export function buildEndlessCourse(options: EndlessOptions): EndlessCourse {
  const seed = options.seed >>> 0;
  const sections = Math.max(1, options.sections ?? 400);
  const rand = mulberry32(seed);
  const level = emptyLevel(`Endless ${seed}`);
  const endY = -sections * SECTION_LENGTH;

  // Back wall behind the spawn, so the arrow cannot leave the way it came.
  level.obstacles.push(
    wall([
      { x: -HALF, y: 40 },
      { x: HALF, y: 40 },
    ]),
  );

  // Side rails down the whole course. Without them the arrow drifts out of the
  // corridor and the gates stop blocking anything, so the run leaks sideways
  // instead of ending. Long walls are fine for the engine.
  level.obstacles.push(
    wall([
      { x: -HALF, y: 40 },
      { x: -HALF, y: endY },
    ]),
    wall([
      { x: HALF, y: 40 },
      { x: HALF, y: endY },
    ]),
  );

  // The centreline: a clamped random walk from the spawn (x=0). Each gate's gap
  // sits on it, so the course curves and must be steered. The first stretch is
  // forced gentle so a run eases in before the course starts pulling sideways.
  const centers: number[] = [0];
  for (let i = 0; i < sections; i++) {
    const gentle = Math.min(1, i / 8);
    const step = (rand() * 2 - 1) * 95 * gentle;
    centers.push(clamp(centers[i] + step, -MAX_MEANDER, MAX_MEANDER));
  }

  const markers: SectionMarker[] = [];
  for (let i = 0; i < sections; i++) {
    const nearY = -i * SECTION_LENGTH;
    const farY = -(i + 1) * SECTION_LENGTH;
    const entryX = centers[i];
    const exitX = centers[i + 1];
    const progress = i / sections;
    // Gaps narrow with progress but never below MIN_GAP.
    const gap = Math.max(MIN_GAP, DEFAULT_GAP - progress * 30);
    const { obstacles } = buildSection(nearY, farY, entryX, exitX, gap, progress, rand);
    level.obstacles.push(...obstacles);
    // The boundary gate: thread the gap or die.
    level.obstacles.push(...gate(farY, exitX, gap));
    markers.push({ index: i, y: farY, x: exitX });
  }

  // A solid finish line at the very end, so a fully cleared course ends cleanly.
  level.obstacles.push(
    wall(
      [
        { x: -HALF, y: endY },
        { x: HALF, y: endY },
      ],
      "finish",
    ),
  );

  return { level, data: nalvlToRawLevelData(level), markers, seed };
}

/**
 * How many section markers the path has crossed. The arrow runs along -y, so a
 * marker at `y` is passed once the path reaches a sample at or below it. Counts
 * each marker once, in course order, and tolerates a path that starts partway
 * through (e.g. resumed from a checkpoint).
 */
export function sectionsCrossed(markers: SectionMarker[], path: { y: number }[]): number {
  if (markers.length === 0 || path.length === 0) return 0;
  let count = 0;
  let mi = 0;
  for (let i = 0; i < path.length && mi < markers.length; i++) {
    while (mi < markers.length && path[i].y <= markers[mi].y) {
      count++;
      mi++;
    }
  }
  return count;
}

/** The next unpassed marker ahead of the arrow, or null at the end of the course. */
export function nextMarker(markers: SectionMarker[], y: number): SectionMarker | null {
  for (const m of markers) if (y > m.y) return m;
  return null;
}
