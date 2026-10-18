/**
 * `.nalvl` — the site's level authoring format.
 *
 * A level is a name, a game mode and a list of obstacles. Obstacles are one of
 * three kinds, mirroring what the engine's `ApiObstacle` understands:
 *
 *  - `wall`   — a polyline (usually one segment) with a `wallType`; carries the
 *               optional `rotationPivot`/`rotationSpeed` for spinning walls.
 *  - `zone`   — a polygon with a `zoneType` (boost/ice/nosteer/steer/rail).
 *  - `portal` — a two-point segment with a `portalId` and `side`.
 *
 * `nalvlToRawLevelData` lowers a level to the exact `RawLevelData` payload the
 * physics engine consumes (the same shape `/level-details` returns), so an
 * authored level can be simulated, replayed and exported with zero translation
 * on the engine side. `rawLevelDataToNalvl` is the inverse, so any official or
 * community level can be opened in the editor.
 *
 * The on-disk form is JSON with a `format` tag, so a `.nalvl` file is diffable
 * and human-editable, and unknown fields survive a round-trip.
 */

import type { RawLevelData } from "./replay-sim";

export const NALVL_FORMAT = "nalvl";
export const NALVL_FORMAT_VERSION = 1;

export type NalvlWallType = "normal" | "death" | "bouncy" | "boost" | "finish";
export type NalvlZoneType = "boost" | "ice" | "nosteer" | "steer" | "rail";
export type NalvlKind = "wall" | "zone" | "portal";

export const NALVL_WALL_TYPES: NalvlWallType[] = ["normal", "death", "bouncy", "boost", "finish"];
export const NALVL_ZONE_TYPES: NalvlZoneType[] = ["boost", "ice", "nosteer", "steer", "rail"];

export interface NalvlPoint {
  x: number;
  y: number;
}

export interface NalvlObstacle {
  /** Stable identity for selection/editing; never written to the engine payload. */
  id: string;
  kind: NalvlKind;
  points: NalvlPoint[];
  wallType?: NalvlWallType;
  zoneType?: NalvlZoneType;
  zoneDirection?: number;
  thickness?: number;
  rotationPivot?: NalvlPoint | null;
  rotationSpeed?: number | null;
  portalId?: string;
  side?: string;
  speed?: number;
}

export interface NalvlLevel {
  format: typeof NALVL_FORMAT;
  formatVersion: number;
  name: string;
  gameMode: string;
  obstacles: NalvlObstacle[];
}

let idCounter = 0;
/** A process-unique id for a newly authored obstacle. */
export function nextObstacleId(): string {
  idCounter += 1;
  return `o${idCounter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

export function emptyLevel(name = "Untitled Level"): NalvlLevel {
  return {
    format: NALVL_FORMAT,
    formatVersion: NALVL_FORMAT_VERSION,
    name,
    gameMode: "speedrun",
    obstacles: [],
  };
}

/** A fresh obstacle of the given kind with sensible defaults. */
export function defaultObstacle(kind: NalvlKind, points: NalvlPoint[]): NalvlObstacle {
  const base: NalvlObstacle = { id: nextObstacleId(), kind, points };
  if (kind === "wall") return { ...base, wallType: "normal", thickness: 8 };
  if (kind === "zone") return { ...base, zoneType: "boost", zoneDirection: 0 };
  return { ...base, portalId: "p1", side: "both" };
}

/** A minimal, playable starter level so the editor is never a blank void. */
export function starterLevel(): NalvlLevel {
  const level = emptyLevel("Starter Circuit");
  level.obstacles = [
    defaultObstacle("wall", [
      { x: -400, y: -320 },
      { x: 400, y: -320 },
    ]),
    defaultObstacle("wall", [
      { x: -400, y: 320 },
      { x: 400, y: 320 },
    ]),
    defaultObstacle("wall", [
      { x: -400, y: -320 },
      { x: -400, y: 320 },
    ]),
    defaultObstacle("wall", [
      { x: 400, y: -320 },
      { x: 400, y: 320 },
    ]),
    {
      ...defaultObstacle("wall", [
        { x: 320, y: -80 },
        { x: 320, y: 80 },
      ]),
      wallType: "finish",
    },
  ];
  return level;
}

/** True for a finite number (rejects NaN/Infinity, which would corrupt the sim). */
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanPoints(points: unknown): NalvlPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p): p is { x: number; y: number } => {
      const q = p as { x?: unknown; y?: unknown };
      return isNum(q?.x) && isNum(q?.y);
    })
    .map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
}

/** Lower an authored level to the engine's `RawLevelData` payload. */
export function nalvlToRawLevelData(level: NalvlLevel): RawLevelData {
  const obstacles: NonNullable<RawLevelData["obstacles"]> = level.obstacles.map((o) => {
    const points = o.points.map((p) => ({ x: p.x, y: p.y }));
    if (o.kind === "zone") {
      return {
        points,
        obstacle_type: "zone",
        zone_type: o.zoneType ?? "boost",
        ...(isNum(o.zoneDirection) ? { zone_direction: o.zoneDirection } : {}),
      };
    }
    if (o.kind === "portal") {
      return {
        points,
        obstacle_type: "portal",
        portal_id: o.portalId ?? "p1",
        side: o.side ?? "both",
      };
    }
    return {
      points,
      obstacle_type: "wall",
      wall_type: o.wallType ?? "normal",
      wall_thickness: isNum(o.thickness) ? o.thickness : 8,
      ...(o.rotationPivot && isNum(o.rotationPivot.x) && isNum(o.rotationPivot.y)
        ? { rotation_pivot: { x: o.rotationPivot.x, y: o.rotationPivot.y } }
        : {}),
      ...(isNum(o.rotationSpeed) ? { rotation_speed: o.rotationSpeed } : {}),
    };
  });
  return { map_name: level.name, game_mode: level.gameMode, obstacles };
}

/** Recover an editable level from an engine payload (official or community). */
export function rawLevelDataToNalvl(data: RawLevelData, name?: string): NalvlLevel {
  const obstacles: NalvlObstacle[] = [];
  for (const o of data.obstacles ?? []) {
    const points = cleanPoints(o.points);
    if (points.length === 0) continue;
    const isZone = o.zone_type != null || o.obstacle_type === "zone";
    const isPortal = o.portal_id != null || o.obstacle_type === "portal";
    if (isZone) {
      obstacles.push({
        id: nextObstacleId(),
        kind: "zone",
        points,
        zoneType: (o.zone_type as NalvlZoneType) ?? "boost",
        ...(isNum(o.zone_direction) ? { zoneDirection: o.zone_direction } : {}),
      });
      continue;
    }
    if (isPortal) {
      obstacles.push({
        id: nextObstacleId(),
        kind: "portal",
        points,
        portalId: o.portal_id ?? "p1",
        side: o.side ?? "both",
      });
      continue;
    }
    obstacles.push({
      id: nextObstacleId(),
      kind: "wall",
      points,
      wallType: (o.wall_type as NalvlWallType) ?? "normal",
      thickness: isNum(o.wall_thickness) ? o.wall_thickness : 8,
      ...(o.rotation_pivot && isNum(o.rotation_pivot.x) && isNum(o.rotation_pivot.y)
        ? { rotationPivot: { x: o.rotation_pivot.x, y: o.rotation_pivot.y } }
        : {}),
      ...(isNum(o.rotation_speed) ? { rotationSpeed: o.rotation_speed } : {}),
    });
  }
  return {
    format: NALVL_FORMAT,
    formatVersion: NALVL_FORMAT_VERSION,
    name: name ?? data.map_name ?? "Untitled Level",
    gameMode: data.game_mode ?? "speedrun",
    obstacles,
  };
}

export function serializeNalvl(level: NalvlLevel): string {
  return JSON.stringify(level, null, 2);
}

/**
 * Parse a `.nalvl` file (or a bare engine payload). Throws a readable error on
 * anything that isn't a level, so the caller can surface it in the UI.
 */
export function parseNalvl(text: string): NalvlLevel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const obj = raw as Partial<NalvlLevel> & RawLevelData;
  if (!obj || typeof obj !== "object") throw new Error("Not a level object");
  if (Array.isArray(obj.obstacles)) {
    // Already a `.nalvl`, or an engine payload we can normalise either way.
    const looksAuthored = obj.format === NALVL_FORMAT;
    if (looksAuthored) {
      const level = obj as NalvlLevel;
      return {
        format: NALVL_FORMAT,
        formatVersion: level.formatVersion ?? NALVL_FORMAT_VERSION,
        name: typeof level.name === "string" ? level.name : "Untitled Level",
        gameMode: typeof level.gameMode === "string" ? level.gameMode : "speedrun",
        obstacles: (level.obstacles ?? []).map((o) => ({
          ...o,
          id: o.id ?? nextObstacleId(),
          points: cleanPoints(o.points),
        })),
      };
    }
    return rawLevelDataToNalvl(obj as RawLevelData);
  }
  throw new Error("No obstacles found in file");
}

/** Axis-aligned bounds of every point in the level, or a small default. */
export function levelBounds(level: NalvlLevel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of level.obstacles) {
    for (const p of o.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  return { minX, minY, maxX, maxY };
}

/** Suggested `.nalvl` filename for a level. */
export function nalvlFilename(level: NalvlLevel): string {
  const slug = level.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "level"}.nalvl`;
}
