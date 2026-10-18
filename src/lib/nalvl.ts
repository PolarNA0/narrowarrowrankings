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

/**
 * The game's own level format (what `POST /custom-levels` accepts and the game's
 * importer reads). Every obstacle MUST carry an `obstacle_type` — the game's
 * importer rejects a file whose obstacles omit it ("obstacle N is missing its
 * obstacle type"). Field names are snake_case, matching the engine payload.
 */
export interface GameLevelData {
  format_version: number;
  required_format_version: number;
  map_name: string;
  game_mode: string;
  obstacles: NonNullable<RawLevelData["obstacles"]>;
}

export interface GameLevelFile {
  level_id: string;
  name: string;
  published: boolean;
  // The game's file importer reads the level data at the top level (it found the
  // obstacle list, then rejected each entry for lacking `obstacle_type`).
  format_version: number;
  required_format_version: number;
  map_name: string;
  game_mode: string;
  obstacles: NonNullable<RawLevelData["obstacles"]>;
  // `POST /custom-levels` wraps the same data under `data`; included so one
  // exported file works for both the importer and the API.
  data: GameLevelData;
}

/** The format versions the game currently writes for a new custom level. */
export const GAME_FORMAT_VERSION = 3;
export const GAME_REQUIRED_FORMAT_VERSION = 0;

export type NalvlWallType = "normal" | "death" | "bouncy" | "boost" | "finish";
export type NalvlZoneType = "boost" | "ice" | "nosteer" | "steer" | "rail";
export type NalvlKind = "wall" | "zone" | "portal" | "wind" | "suction";

/** Site-only force fields; they never reach the game's exporter. */
export const NALVL_FIELD_KINDS: NalvlKind[] = ["wind", "suction"];

/** True for the site-only wind/suction kinds. */
export function isFieldKind(kind: NalvlKind): kind is "wind" | "suction" {
  return kind === "wind" || kind === "suction";
}

/** Default wind blow direction (radians): to the right (+x), matching screen. */
export const DEFAULT_FIELD_DIRECTION = 0;
/** Default field strength in world units per 240Hz tick (0.05 ≈ 12 units/s). */
export const DEFAULT_FIELD_STRENGTH = 0.05;

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
  /** Wind: push direction in radians. Suction: unused (pulls to the centre). */
  fieldDirection?: number;
  /** Wind/suction strength in world units per 240Hz tick. */
  fieldStrength?: number;
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
  if (kind === "wind" || kind === "suction") {
    return {
      ...base,
      fieldDirection: DEFAULT_FIELD_DIRECTION,
      fieldStrength: DEFAULT_FIELD_STRENGTH,
    };
  }
  // The game links two portals by a shared `portal_id`, one on each `side`
  // ("a"/"b"); a lone portal is still importable.
  return { ...base, portalId: "p1", side: "a" };
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

/**
 * Lower an authored level to the engine's `RawLevelData` payload. Unlike
 * `nalvlToGameData`, this KEEPS the site-only wind/suction fields (as
 * `field_type` obstacles) so the simulation layer can apply them; the engine
 * payload builder strips them again before the engine ever sees them.
 */
export function nalvlToRawLevelData(level: NalvlLevel): RawLevelData {
  const data = nalvlToGameData(level);
  const fields: NonNullable<RawLevelData["obstacles"]> = level.obstacles
    .filter((o) => isFieldKind(o.kind))
    .map((o) => ({
      obstacle_type: "field",
      field_type: o.kind,
      ...(isNum(o.fieldDirection) ? { field_direction: o.fieldDirection } : {}),
      field_strength: isNum(o.fieldStrength) ? o.fieldStrength : DEFAULT_FIELD_STRENGTH,
      points: o.points.map((p) => ({ x: p.x, y: p.y })),
    }));
  return { ...data, obstacles: [...data.obstacles, ...fields] };
}

/**
 * Lower an authored level to the game's own level data (the shape the game's
 * importer and `POST /custom-levels` expect). This is the payload that can be
 * taken back into the game — every obstacle gets an explicit `obstacle_type`.
 */
export function nalvlToGameData(level: NalvlLevel): GameLevelData {
  const obstacles: NonNullable<RawLevelData["obstacles"]> = level.obstacles
    // Wind/suction are site-only: the game's engine has no concept of them, so
    // they must not appear in an export or the game would reject the file.
    .filter((o) => !isFieldKind(o.kind))
    .map((o) => {
      const points = o.points.map((p) => ({ x: p.x, y: p.y }));
      if (o.kind === "zone") {
        return {
          obstacle_type: "zone",
          zone_type: o.zoneType ?? "boost",
          points,
          ...(isNum(o.zoneDirection) ? { zone_direction: o.zoneDirection } : {}),
        };
      }
      if (o.kind === "portal") {
        return {
          obstacle_type: "portal",
          portal_id: o.portalId ?? "p1",
          side: o.side === "both" ? "a" : (o.side ?? "a"),
          points,
        };
      }
      return {
        obstacle_type: "wall",
        wall_type: o.wallType ?? "normal",
        wall_thickness: isNum(o.thickness) ? o.thickness : 8,
        points,
        ...(o.rotationPivot && isNum(o.rotationPivot.x) && isNum(o.rotationPivot.y)
          ? { rotation_pivot: { x: o.rotationPivot.x, y: o.rotationPivot.y } }
          : {}),
        ...(isNum(o.rotationSpeed) ? { rotation_speed: o.rotationSpeed } : {}),
      };
    });
  return {
    format_version: GAME_FORMAT_VERSION,
    required_format_version: GAME_REQUIRED_FORMAT_VERSION,
    map_name: level.name,
    game_mode: level.gameMode,
    obstacles,
  };
}

/** Wrap a level as a game-importable file (game importer shape + API `data`). */
export function nalvlToGameFile(level: NalvlLevel): GameLevelFile {
  const data = nalvlToGameData(level);
  return {
    level_id: gameLevelId(level),
    name: level.name,
    published: false,
    format_version: data.format_version,
    required_format_version: data.required_format_version,
    map_name: data.map_name,
    game_mode: data.game_mode,
    obstacles: data.obstacles,
    data,
  };
}

/** An 8-char uppercase hex id, the shape the game uses for custom `level_id`s. */
export function gameLevelId(seed?: NalvlLevel | string): string {
  const text =
    typeof seed === "string" ? seed : seed ? JSON.stringify(seed.obstacles) : String(Date.now());
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
}

/** Recover an editable level from an engine payload (official or community). */
export function rawLevelDataToNalvl(data: RawLevelData, name?: string): NalvlLevel {
  const obstacles: NalvlObstacle[] = [];
  for (const o of data.obstacles ?? []) {
    const points = cleanPoints(o.points);
    if (points.length === 0) continue;
    if (o.field_type === "wind" || o.field_type === "suction") {
      obstacles.push({
        id: nextObstacleId(),
        kind: o.field_type,
        points,
        fieldDirection: isNum(o.field_direction) ? o.field_direction : DEFAULT_FIELD_DIRECTION,
        fieldStrength: isNum(o.field_strength) ? o.field_strength : DEFAULT_FIELD_STRENGTH,
      });
      continue;
    }
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
 * Parse a level file. Accepts:
 *  - the site's `.nalvl` (`{format:"nalvl", obstacles:[…]}`),
 *  - the game's custom-level file (`{level_id, name, data:{obstacles:[…]}}`),
 *  - a bare engine/level payload (`{map_name, obstacles:[…]}`).
 * Throws a readable error on anything that isn't a level, so the caller can
 * surface it in the UI.
 */
export function parseNalvl(text: string): NalvlLevel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const obj = raw as Record<string, unknown> & Partial<NalvlLevel> & RawLevelData;
  if (!obj || typeof obj !== "object") throw new Error("Not a level object");

  // The game's custom-level file wraps the level under `data`.
  if (
    obj.data &&
    typeof obj.data === "object" &&
    Array.isArray((obj.data as RawLevelData).obstacles)
  ) {
    const data = obj.data as RawLevelData;
    const name = typeof obj.name === "string" ? obj.name : data.map_name;
    return rawLevelDataToNalvl(data, name);
  }

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

/**
 * Suggested filename for the game-importable file. The game's importer is a
 * `.json` file picker, so this is JSON (with `obstacle_type` on every obstacle),
 * not the site's `.nalvl`.
 */
export function gameFilename(level: NalvlLevel): string {
  const slug = level.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "level"}-game.json`;
}
