/**
 * Procedural level generation for the Generator tool.
 *
 * Everything here is a pure function of the seed: the same options always
 * produce the same level, so a generated level is reproducible and shareable.
 * Output is a `NalvlLevel`, which the editor opens directly and
 * `nalvlToRawLevelData` lowers to the engine payload.
 *
 * The templates are intentionally simple shapes (a corridor, an arena, a
 * slalom) rather than a solver-driven designer: they give an author a valid,
 * playable skeleton to sculpt, not a finished level. Each one always places a
 * `finish` wall so the level can actually be completed.
 */

import {
  defaultObstacle,
  emptyLevel,
  nextObstacleId,
  type NalvlLevel,
  type NalvlObstacle,
  type NalvlPoint,
  type NalvlWallType,
  type NalvlZoneType,
} from "./nalvl";

export type GenTemplate = "track" | "arena" | "gauntlet";

export const GEN_TEMPLATES: { id: GenTemplate; label: string; blurb: string }[] = [
  { id: "track", label: "Track", blurb: "A walled corridor with scattered boosts and hazards." },
  { id: "arena", label: "Arena", blurb: "A closed box with random interior walls and zones." },
  { id: "gauntlet", label: "Gauntlet", blurb: "A slalom of staggered walls ending in a finish." },
];

export interface GenOptions {
  template: GenTemplate;
  seed: number;
  /** Interior size in world units. */
  width: number;
  height: number;
  /** 0..1 — how many extra walls/obstacles to scatter. */
  density: number;
  /** Include boost/ice zones. */
  zones: boolean;
  /** Include spinning walls (rotation_pivot/speed). */
  rotating: boolean;
}

export const DEFAULT_GEN_OPTIONS: GenOptions = {
  template: "track",
  seed: 1,
  width: 1600,
  height: 900,
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

function wall(points: NalvlPoint[], wallType: NalvlWallType = "normal"): NalvlObstacle {
  return { ...defaultObstacle("wall", points), wallType };
}

function zone(points: NalvlPoint[], zoneType: NalvlZoneType): NalvlObstacle {
  return { ...defaultObstacle("zone", points), zoneType };
}

function zoneBox(cx: number, cy: number, w: number, h: number): NalvlPoint[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

/** A `finish` wall spanning `h` vertically, centred at `(x, cy)`. */
function finishWall(x: number, cy: number, h: number): NalvlObstacle {
  return wall(
    [
      { x, y: cy - h / 2 },
      { x, y: cy + h / 2 },
    ],
    "finish",
  );
}

function perimeter(w: number, h: number): NalvlObstacle[] {
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  return [
    wall([
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ]),
    wall([
      { x: x0, y: y1 },
      { x: x1, y: y1 },
    ]),
    wall([
      { x: x0, y: y0 },
      { x: x0, y: y1 },
    ]),
    wall([
      { x: x1, y: y0 },
      { x: x1, y: y1 },
    ]),
  ];
}

function maybeRotate(rand: () => number, o: NalvlObstacle, enabled: boolean): NalvlObstacle {
  if (!enabled || rand() > 0.5) return o;
  const cx = o.points.reduce((s, p) => s + p.x, 0) / o.points.length;
  const cy = o.points.reduce((s, p) => s + p.y, 0) / o.points.length;
  return {
    ...o,
    rotationPivot: { x: cx, y: cy },
    rotationSpeed: (rand() < 0.5 ? -1 : 1) * (0.0006 + rand() * 0.0014),
  };
}

function genTrack(o: GenOptions, rand: () => number): NalvlLevel {
  const level = emptyLevel(`Track ${o.seed}`);
  const x0 = -o.width / 2;
  const x1 = o.width / 2;
  const y0 = -o.height / 2;
  const y1 = o.height / 2;
  level.obstacles = [
    wall([
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ]),
    wall([
      { x: x0, y: y1 },
      { x: x1, y: y1 },
    ]),
    wall([
      { x: x0, y: y0 },
      { x: x0, y: y1 },
    ]),
  ];
  const count = Math.round(o.density * 10);
  for (let i = 0; i < count; i++) {
    const cx = x0 + ((i + 0.5) / count) * o.width;
    const gap = o.height * (0.25 + rand() * 0.3);
    const cy = y0 + rand() * o.height;
    const top = cy - gap;
    const bot = cy + gap;
    const obstacle = wall([
      { x: cx, y: y0 },
      { x: cx, y: top },
    ]);
    level.obstacles.push(maybeRotate(rand, obstacle, o.rotating));
    level.obstacles.push(
      wall([
        { x: cx, y: bot },
        { x: cx, y: y1 },
      ]),
    );
    if (o.zones && rand() < 0.5) {
      level.obstacles.push(zone(zoneBox(cx + o.width / (count * 2), cy, 90, 140), "boost"));
    }
  }
  level.obstacles.push(finishWall(x1, 0, o.height * 0.8));
  return level;
}

function genArena(o: GenOptions, rand: () => number): NalvlLevel {
  const level = emptyLevel(`Arena ${o.seed}`);
  level.obstacles = perimeter(o.width, o.height);
  const count = Math.round(o.density * 24);
  for (let i = 0; i < count; i++) {
    const cx = (rand() - 0.5) * o.width * 0.8;
    const cy = (rand() - 0.5) * o.height * 0.8;
    const horizontal = rand() < 0.5;
    const len = 80 + rand() * 220;
    const pts = horizontal
      ? [
          { x: cx - len / 2, y: cy },
          { x: cx + len / 2, y: cy },
        ]
      : [
          { x: cx, y: cy - len / 2 },
          { x: cx, y: cy + len / 2 },
        ];
    const roll = rand();
    const kind: NalvlWallType = roll < 0.15 ? "death" : roll < 0.3 ? "bouncy" : "normal";
    level.obstacles.push(maybeRotate(rand, wall(pts, kind), o.rotating));
    if (o.zones && rand() < 0.25) {
      const zt: NalvlZoneType = rand() < 0.6 ? "boost" : "ice";
      level.obstacles.push(zone(zoneBox(cx, cy, 120, 120), zt));
    }
  }
  level.obstacles.push(finishWall(o.width / 2, 0, o.height * 0.5));
  return level;
}

function genGauntlet(o: GenOptions, rand: () => number): NalvlLevel {
  const level = emptyLevel(`Gauntlet ${o.seed}`);
  level.obstacles = perimeter(o.width, o.height);
  const x0 = -o.width / 2;
  const y0 = -o.height / 2;
  const count = Math.max(4, Math.round(o.density * 14));
  for (let i = 0; i < count; i++) {
    const cx = x0 + ((i + 1) / (count + 1)) * o.width;
    const topHalf = i % 2 === 0;
    const wallH = o.height * (0.35 + rand() * 0.35);
    const pts: NalvlPoint[] = topHalf
      ? [
          { x: cx, y: y0 },
          { x: cx, y: y0 + wallH },
        ]
      : [
          { x: cx, y: -y0 },
          { x: cx, y: -y0 - wallH },
        ];
    level.obstacles.push(maybeRotate(rand, wall(pts), o.rotating));
    if (o.zones && rand() < 0.4) {
      level.obstacles.push(zone(zoneBox(cx + 60, 0, 80, 200), "boost"));
    }
  }
  level.obstacles.push(finishWall(o.width / 2, 0, o.height * 0.8));
  return level;
}

/** Generate a level from options. Deterministic in `options.seed`. */
export function generateLevel(options: GenOptions): NalvlLevel {
  const rand = mulberry32(options.seed);
  const o: GenOptions = {
    ...options,
    width: Math.max(400, options.width),
    height: Math.max(400, options.height),
    density: Math.min(1, Math.max(0, options.density)),
  };
  if (o.template === "arena") return genArena(o, rand);
  if (o.template === "gauntlet") return genGauntlet(o, rand);
  return genTrack(o, rand);
}

/** Re-id a level's obstacles (used after a generate, so ids stay unique). */
export function reidLevel(level: NalvlLevel): NalvlLevel {
  return { ...level, obstacles: level.obstacles.map((o) => ({ ...o, id: nextObstacleId() })) };
}
