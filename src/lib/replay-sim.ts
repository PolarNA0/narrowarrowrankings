import type { ApiMap } from "./physics/rust";
/**
 * Replay trajectory reconstruction.
 *
 * Rather than approximating the game's `Player` physics, this drives the exact
 * engine the live game runs — a small Rust/WASM core bundled under
 * `./physics` (the same `GameMechanicsEngine` the Flutter app loads through
 * `physics_core_capacitor.js`). The engine steps once per recorded input
 * sample, so the replay is a faithful reconstruction rather than a plausible
 * but drifting guess.
 *
 * The previous hand-rolled model had several wrong constants (thrust ~17x too
 * high, a throttle ramp that was 4x too slow at 60Hz, no traction, no speed
 * cap, no proper collision), which is why the arrow started late and then
 * wandered off the real path.
 *
 * The engine itself ships only a neutral default, but each arrow (Narrow /
 * Speedy / Energy) runs its own physics. `simulateRun` therefore swaps in the
 * run's arrow constants (see {@link ARROW_CONSTANTS}) — without them the
 * reconstruction DNFs against walls the real run cleared.
 *
 * Coordinate note: the engine's `rotation` is 0 when facing "north" (toward
 * -y, matching the level's spawn heading), while the renderer treats `rot` as
 * a standard screen angle. `SimPoint.rot` is therefore stored as the facing
 * angle (`engineRotation - PI/2`) so the arrow points the way it travels.
 */

/**
 * Milliseconds per simulation step. The engine advances one step per 240Hz
 * input tick and the viewer samples every tick, so a spin that never moves the
 * arrow still plays back — the heading comes from the engine's rotation, not
 * from the displacement between samples.
 */
export const SIM_TICK_MS = 1000 / 240;

/**
 * Cosine threshold for the accelerator wire: the boost only fires while the
 * arrow's heading is within ~76° of the thrust direction. Beyond that a spin or
 * a zig-zag starves the charge, so the player can slow down or break off.
 */
export const ACCELERATOR_MIN_ALIGN = 0.25;

/**
 * The engine ships only a neutral default, but the three playable arrows each
 * have their own physics. These are the exact constants the game client feeds
 * the engine, recovered from its compiled Dart (`bui`), keyed by arrow name.
 * `create_default_game_state()` is a mix of Narrow's power and Speedy's
 * energy/traction, so using it for every run made replays diverge.
 */
export const ARROW_CONSTANTS: Record<string, Record<string, number>> = {
  narrow: {
    radius: 16,
    engine_power: 0.002,
    engine_startup_ticks: 60,
    energy_capacity: 0.6,
    energy_regeneration: 0.002,
    traction_power: 0.006,
    brake_power: 0.01,
    aerodynamics: 0.9992,
    oiliness: 0.996,
    turning_speed: 0.00032,
  },
  speedy: {
    radius: 20,
    engine_power: 0.0028,
    engine_startup_ticks: 120,
    energy_capacity: 0.2,
    energy_regeneration: 0.001,
    traction_power: 0.002,
    brake_power: 0.012,
    aerodynamics: 0.9996,
    oiliness: 0.996,
    turning_speed: 0.00028,
  },
  energy: {
    radius: 12,
    engine_power: 0.0016,
    engine_startup_ticks: 40,
    energy_capacity: 1.8,
    energy_regeneration: 0.004,
    traction_power: 0.005,
    brake_power: 0.02,
    aerodynamics: 0.999,
    oiliness: 0.998,
    turning_speed: 0.00038,
  },
};

/** Resolve a run's `arrow_name` to its physics constants (default: Narrow). */
export function arrowConstants(arrowName: string | null | undefined): Record<string, number> {
  const name = (arrowName ?? "").toLowerCase();
  if (name.includes("speedy")) return ARROW_CONSTANTS.speedy;
  if (name.includes("energy")) return ARROW_CONSTANTS.energy;
  return ARROW_CONSTANTS.narrow;
}

export interface SimPoint {
  x: number;
  y: number;
  /** Facing angle in radians (engine rotation minus 90°, i.e. "forward"). */
  rot: number;
  /** True once the arrow has crossed the finish line at this sample. */
  finished?: boolean;
  /** Engine thrust level at this sample (0..1); drives the flame in game mode. */
  thrustPower?: number;
  /**
   * The input symbol that produced this sample (0 coast, 1 right, 2 left,
   * 3 brake). Absent on the spawn sample, which no input produced. Drives the
   * steer-dot HUD.
   */
  input?: number;
}

export interface SimWall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  type: string;
  thickness: number;
  /** Pivot the segment spins around, in world units. */
  pivot?: { x: number; y: number };
  /** Rotation rate in radians per 240Hz tick; absent when the wall is static. */
  rotationSpeed?: number;
  /**
   * Index into `SimGeometry.movingBlocks` when this wall is a moving block, or
   * -1/undefined otherwise. The renderer translates the segment by that
   * motion's offset at the current tick.
   */
  motion?: number;
}

/**
 * A filled zone (boost/ice/nosteer/steer/rail). The zone is an arbitrary
 * polygon — level editors use slanted and multi-point zones (e.g. Arctic Dash)
 * — so the renderer draws `points` verbatim; the `x0..y1` box is only a
 * convenience bound for framing the camera.
 */
export interface SimZone {
  points: Array<{ x: number; y: number }>;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  type: string;
}

/**
 * A force field: an area that continuously pushes (wind) or pulls (suction)
 * the arrow while it is inside. The engine has no concept of these, so they are
 * applied by the simulation layer as a per-tick velocity delta; they are
 * therefore a site-only mechanic and never reach the game's exporter.
 *
 * `strength` is the velocity added per 240Hz tick at the field's centre, in
 * world units/tick, so it is on the same scale as the arrow's own velocity.
 */
export interface ForceField {
  kind: "wind" | "suction";
  /** The field's polygon, in world units. */
  points: Array<{ x: number; y: number }>;
  /** Wind: push direction in radians. Suction: unused (pulls to the centre). */
  direction?: number;
  /** Velocity delta per tick at the centre. */
  strength: number;
}

/**
 * An accelerator wire: a one-shot trigger the arrow crosses (segment
 * intersection against the previous tick's position, so a fast arrow cannot
 * tunnel through it). Crossing it arms a charge that thrusts the arrow along
 * `dirX`/`dirY` — the wire's normal, oriented the way the arrow was facing.
 *
 * The charge is deliberately controllable: it only fires while the arrow's
 * heading stays aligned with that thrust and the player is not braking. A spin,
 * a zig-zag or a held brake therefore starve the boost and let the arrow slow
 * down to clear a wall. `accel` is the velocity delta per 240Hz tick at full
 * thrust, on the same scale as the arrow's own velocity.
 */
export interface SimTrigger {
  /** The wire's endpoints, in world units. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Unit normal of the wire, oriented the way the arrow was facing. */
  dirX: number;
  dirY: number;
  /** Speed at which the thrust fades out, in world units/tick. */
  targetSpeed: number;
  /** Velocity delta per tick at full thrust, in world units/tick. */
  accel: number;
}

/** A portal, drawn as a segment with an arrow showing the travel direction. */
export interface SimPortal {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * The live accelerator charge: the thrust direction captured when the wire was
 * crossed (a unit vector perpendicular to the wire, pointing the way the arrow
 * was facing), the thrust target and strength. There is no "spent" flag
 * — the charge is a standing property of the level, so any run that crosses the
 * wire gets it and a checkpoint always restores it. Whether it thrusts on a
 * given tick is decided from the arrow's live heading and input (see
 * `applyWire`), which keeps the boost in the player's hands.
 */
export interface WireState {
  armed: boolean;
  dirX: number;
  dirY: number;
  targetSpeed: number;
  accel: number;
}

/**
 * A moving block: an obstacle the simulation layer translates on a there-and-
 * back line, since the engine can only spin an obstacle, not slide one. Indexed
 * by the obstacle's position in `data.obstacles` so the sim can offset exactly
 * that entry when it rebuilds the engine state.
 */
export interface SimMotion {
  /** Index into the level's obstacle list. */
  obstacleIndex: number;
  /** Offset in world units reached at `period / 2` ticks, then back to zero. */
  dx: number;
  dy: number;
  /** Ticks for a full there-and-back cycle. */
  period: number;
}

/** Everything the renderer needs, split by how each obstacle is drawn. */
export interface SimGeometry {
  walls: SimWall[];
  zones: SimZone[];
  portals: SimPortal[];
  /** Site-only wind/suction fields, drawn as faint white areas with particles. */
  forceFields?: ForceField[];
  /** Site-only accelerator wires, drawn as thin charged lines. */
  triggers?: SimTrigger[];
  /** Site-only moving blocks, drawn at their current-tick offset. */
  movingBlocks?: SimMotion[];
}

export interface SimResult {
  path: SimPoint[];
  /** Tick (input index) at which the finish was reached, or null. */
  finishTick: number | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Raw level payload as returned by `/level-details`. */
export interface RawLevelData {
  map_name?: string;
  game_mode?: string;
  obstacles?: Array<{
    points?: Array<{ x?: number; y?: number }>;
    wall_type?: string;
    obstacle_type?: string;
    wall_thickness?: number;
    rotation_pivot?: { x?: number; y?: number } | null;
    rotation_speed?: number | null;
    zone_type?: string;
    zone_direction?: number;
    portal_id?: string;
    side?: string;
    speed?: number;
    /** Site-only force field (wind/suction); stripped before the engine sees it. */
    field_type?: string;
    field_direction?: number;
    field_strength?: number;
    /**
     * Site-only motion for a moving block: the wall eases out to an offset of
     * `motion_dx`/`motion_dy` world units at half of `motion_period` ticks, then
     * back to its start at `motion_period` (a there-and-back sweep). The engine
     * cannot move an obstacle (it only spins one), so the simulation layer
     * rebuilds the engine each tick with the obstacle's points offset by the
     * animation curve; the engine never sees these fields, exactly like the
     * wind/suction fields.
     */
    motion_dx?: number;
    motion_dy?: number;
    motion_period?: number;
    /**
     * Site-only accelerator wire. `accelerator_speed` is the target speed that
     * disarms the charge and `accelerator_accel` the per-tick velocity delta;
     * the push direction is captured from the arrow's velocity when it crosses.
     * Like wind/suction, the engine has no concept of it, so the sim layer
     * applies it and the exporter strips it.
     */
    accelerator_speed?: number;
    accelerator_accel?: number;
  }>;
}

export interface SimOptions {
  /** Maximum number of input samples to simulate (guards very long runs). */
  maxTicks?: number;
}

/**
 * Flatten a level's obstacles into what the renderer draws. Walls become line
 * segments, zones become filled boxes, portals become directed segments, and
 * the finish wall is tagged so it can be drawn as a checkered strip.
 */
export function levelGeometry(data: RawLevelData | null | undefined): SimGeometry {
  const walls: SimWall[] = [];
  const zones: SimZone[] = [];
  const portals: SimPortal[] = [];
  const forceFields: ForceField[] = [];
  const triggers: SimTrigger[] = [];
  const obstacles = data?.obstacles ?? [];
  const motionByObstacle = new Map<number, number>();
  for (let i = 0; i < obstacles.length; i++) {
    if (isMovingBlock(obstacles[i])) motionByObstacle.set(i, motionByObstacle.size);
  }
  for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
    const obstacle = obstacles[obstacleIndex];
    const pts = obstacle.points ?? [];

    // Site-only force fields are neither walls nor zones: they push/pull the
    // arrow and are applied by the simulation layer, so they must never be
    // emitted as an engine obstacle.
    if (isForceField(obstacle)) {
      const valid = pts.filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null);
      if (valid.length < 3) continue;
      forceFields.push({
        kind: obstacle.field_type === "suction" ? "suction" : "wind",
        points: valid.map((p) => ({ x: p.x, y: p.y })),
        ...(isFiniteNum(obstacle.field_direction) ? { direction: obstacle.field_direction } : {}),
        strength: isFiniteNum(obstacle.field_strength) ? obstacle.field_strength : 0,
      });
      continue;
    }

    // Accelerator wires are the same: a site-only trigger the sim reads, never
    // an engine obstacle. Authored as a two-point segment; the thrust direction
    // is the wire's normal, and the sim orients it the way the arrow faces.
    if (isAcceleratorTrigger(obstacle)) {
      const a = pts[0];
      const b = pts[1];
      if (a?.x != null && a?.y != null && b?.x != null && b?.y != null) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        triggers.push({
          ax: a.x,
          ay: a.y,
          bx: b.x,
          by: b.y,
          // Perpendicular to the wire: (-dy, dx) / len. Which of the two
          // directions is "forward" is decided per crossing.
          dirX: len > 0 ? -dy / len : 0,
          dirY: len > 0 ? dx / len : 1,
          targetSpeed: obstacle.accelerator_speed as number,
          accel: obstacle.accelerator_accel as number,
        });
      }
      continue;
    }

    const isZone = obstacle.zone_type != null || obstacle.obstacle_type === "zone";
    const isPortal = obstacle.portal_id != null || obstacle.obstacle_type === "portal";

    if (isZone) {
      const valid = pts.filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null);
      if (valid.length === 0) continue;
      const xs = valid.map((p) => p.x);
      const ys = valid.map((p) => p.y);
      zones.push({
        points: valid.map((p) => ({ x: p.x, y: p.y })),
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
        type: obstacle.zone_type ?? "boost",
      });
      continue;
    }

    if (isPortal) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a?.x == null || a?.y == null || b?.x == null || b?.y == null) continue;
        portals.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
      continue;
    }

    const type = obstacle.wall_type ?? "normal";
    const thickness = obstacle.wall_thickness ?? 8;
    const pivot =
      obstacle.rotation_pivot?.x != null && obstacle.rotation_pivot?.y != null
        ? { x: obstacle.rotation_pivot.x, y: obstacle.rotation_pivot.y }
        : undefined;
    const rotationSpeed = obstacle.rotation_speed ?? undefined;

    // A moving block also slides; the renderer reads its motion from
    // `movingBlocks` (this wall's slot in that dense list) and translates the
    // segment at draw time.
    const motion = motionByObstacle.get(obstacleIndex) ?? -1;

    // Some obstacles carry a single point, not a polyline: the editor lets you
    // drop a wall as a dot, and the engine still collides with it (a
    // zero-length segment with the same thickness). Rendering it as a dot keeps
    // those collisions visible instead of reading as a bonk against nothing.
    const valid = pts.filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null);
    if (valid.length === 1) {
      const p = valid[0];
      walls.push({
        ax: p.x,
        ay: p.y,
        bx: p.x,
        by: p.y,
        type,
        thickness,
        pivot,
        rotationSpeed,
        motion,
      });
      continue;
    }
    for (let i = 0; i + 1 < valid.length; i++) {
      const a = valid[i];
      const b = valid[i + 1];
      walls.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        type,
        thickness,
        pivot,
        rotationSpeed,
        motion,
      });
    }
  }
  return { walls, zones, portals, forceFields, triggers, movingBlocks: levelMotions(data) };
}

/**
 * The centre of the finish wall, used as the target the optimizer's DNF
 * proximity signal steers toward. Returns null for a level with no finish wall
 * (custom levels the engine finishes some other way), in which case the search
 * falls back to a plain finish/DNF score.
 */
export function finishTarget(
  data: RawLevelData | null | undefined,
): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const obstacle of data?.obstacles ?? []) {
    if (obstacle.wall_type !== "finish") continue;
    for (const p of obstacle.points ?? []) {
      if (p?.x == null || p?.y == null) continue;
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

/**
 * Build the obstacle list the engine expects. `ApiObstacle` is an internally
 * tagged enum: walls carry `wall_type`/`wall_thickness`, zones carry
 * `zone_type` (boost/ice/nosteer/steer/rail) plus an optional
 * `zone_direction`, and portals carry `portal_id`/`side`. Every field the
 * level uses is passed through verbatim and only `obstacle_type` is inferred
 * when the payload omits it, because the engine rejects an entry whose type
 * does not match its required fields.
 */
function engineObstacles(data: RawLevelData) {
  const fields = [
    "wall_type",
    "wall_thickness",
    "zone_type",
    "zone_direction",
    "portal_id",
    "side",
    "rotation_pivot",
    "rotation_speed",
    "speed",
  ] as const;
  return (data.obstacles ?? [])
    .filter((o) => !isForceField(o) && !isAcceleratorTrigger(o))
    .map((o) => {
      const out: Record<string, unknown> = {
        obstacle_type: o.obstacle_type ?? (o.zone_type ? "zone" : o.portal_id ? "portal" : "wall"),
        points: (o.points ?? []).map((p) => ({ x: p.x ?? 0, y: p.y ?? 0 })),
      };
      for (const key of fields) {
        if (o[key] != null) out[key] = o[key];
      }
      return out;
    });
}

type EngineInput = { left: boolean; right: boolean };
type EngineModule = typeof import("./physics/rust.js");

/** True for a finite number (rejects NaN/Infinity, which would corrupt the sim). */
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** True for a site-only wind/suction field obstacle (not an engine obstacle). */
export function isForceField(o: {
  field_type?: string;
  zone_type?: string;
  portal_id?: string;
  wall_type?: string;
  obstacle_type?: string;
}): boolean {
  return o.field_type === "wind" || o.field_type === "suction";
}

/**
 * True for a site-only accelerator wire: a one-shot trigger, not a wall the
 * engine should ever see. Requires a positive target speed and accel, so a
 * half-authored wire stays inert rather than arming a no-op charge.
 */
export function isAcceleratorTrigger(o: {
  accelerator_speed?: number;
  accelerator_accel?: number;
}): boolean {
  return (
    isFiniteNum(o.accelerator_speed) &&
    o.accelerator_speed > 0 &&
    isFiniteNum(o.accelerator_accel) &&
    o.accelerator_accel > 0
  );
}

/** True for an obstacle the sim translates (site-only motion fields present). */
export function isMovingBlock(o: {
  motion_period?: number;
  motion_dx?: number;
  motion_dy?: number;
}): boolean {
  if (!isFiniteNum(o.motion_period) || o.motion_period <= 0) return false;
  return (
    (isFiniteNum(o.motion_dx) && o.motion_dx !== 0) ||
    (isFiniteNum(o.motion_dy) && o.motion_dy !== 0)
  );
}

/**
 * A moving block's offset at `tick`, in world units. The block eases to the far
 * end over the first half of its period and back over the second, so it is
 * momentarily still at each end (a smooth there-and-back rather than a snap).
 */
export function motionOffsetAt(
  dx: number,
  dy: number,
  period: number,
  tick: number,
): { x: number; y: number } {
  if (!isFiniteNum(period) || period <= 0) return { x: 0, y: 0 };
  const phase = (((tick % period) + period) % period) / period; // 0..1
  const k = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0..1..0
  return { x: dx * k, y: dy * k };
}

/** Every moving block in a level, with the obstacle index the sim offsets. */
export function levelMotions(data: RawLevelData | null | undefined): SimMotion[] {
  const motions: SimMotion[] = [];
  const obstacles = data?.obstacles ?? [];
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (!isMovingBlock(o)) continue;
    motions.push({
      obstacleIndex: i,
      dx: isFiniteNum(o.motion_dx) ? o.motion_dx : 0,
      dy: isFiniteNum(o.motion_dy) ? o.motion_dy : 0,
      period: o.motion_period as number,
    });
  }
  return motions;
}

/** The fields' force polygons must not reach the engine, which would reject them. */
export function stripForceFields(data: RawLevelData): RawLevelData {
  if (!data.obstacles?.some(isForceField)) return data;
  return { ...data, obstacles: data.obstacles.filter((o) => !isForceField(o)) };
}

/**
 * Do segments p1→p2 and p3→p4 cross? Used for the accelerator wire, where the
 * arrow's per-tick movement can exceed the wire's thickness, so a point test
 * would tunnel straight through it.
 */
export function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Point-in-polygon (ray casting), for deciding whether the arrow is inside a field. */
export function pointInPolygon(
  x: number,
  y: number,
  pts: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The velocity delta a set of force fields applies to an arrow at (x, y),
 * in world units per tick. Wind adds a constant push along `direction`;
 * suction pulls toward the field's centroid with a strength that is constant
 * inside the area (a simple, predictable mechanic rather than an inverse-square
 * well, which would make the edges impossibly strong).
 */
export function forceAt(fields: ForceField[], x: number, y: number): { x: number; y: number } {
  let dx = 0;
  let dy = 0;
  for (const f of fields) {
    if (!pointInPolygon(x, y, f.points)) continue;
    if (f.kind === "suction") {
      let cx = 0;
      let cy = 0;
      for (const p of f.points) {
        cx += p.x;
        cy += p.y;
      }
      cx /= f.points.length;
      cy /= f.points.length;
      const vx = cx - x;
      const vy = cy - y;
      const len = Math.hypot(vx, vy);
      if (len > 1e-6) {
        dx += (vx / len) * f.strength;
        dy += (vy / len) * f.strength;
      }
    } else {
      const dir = f.direction ?? 0;
      dx += Math.cos(dir) * f.strength;
      dy += Math.sin(dir) * f.strength;
    }
  }
  return { x: dx, y: dy };
}

/** Minimal shape of the engine state the replay reads. */
interface EnginePlayerState {
  player: {
    translation: { x: number; y: number };
    rotation: number;
    state?: string;
    /** Engine's current thrust level (0..1); drives the flame length. */
    thrust_power?: number;
    /** Velocity in world units/tick; force fields add to this per tick. */
    velocity?: { x: number; y: number; r?: number };
  };
}

let enginePromise: Promise<EngineModule> | null = null;

/** Lazily initialise the bundled physics engine exactly once. */
function loadEngine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = import("./physics/rust.js").then(async (mod) => {
      await mod.default();
      return mod;
    });
  }
  return enginePromise;
}

/**
 * A live engine bound to one level and arrow, steppable one tick at a time.
 * The read-only replay uses it once; the TAS editor keeps one open and rewinds
 * it, so a scrub never re-runs the whole run from the spawn.
 */
export interface ReplayEngine {
  /** Step the engine with one input symbol, returning the resulting sample. */
  step(symbol: number): SimPoint;
  /**
   * Step the engine and return its cheap terminal-state code: 0 playing,
   * 1 finish, 2 dead. Avoids the full-state JSON `step` parses, so a search
   * looping over thousands of candidate runs stays fast.
   */
  stepCode(symbol: number): number;
  /** Reset to the spawn pose (engine rebuild) and return the initial sample. */
  reset(): SimPoint;
  /**
   * Parse the engine's current full state into a sample, without stepping.
   * `step`/`stepCode` already advanced, so a caller that only needs the pose at
   * the render rate reads it once here instead of paying the full-state JSON
   * parse on every 240Hz tick.
   */
  read(): SimPoint;
  /**
   * The engine's terminal-state code at the current tick, without stepping:
   * 0 playing, 1 finish, 2 dead. `step` already advanced, so callers that need
   * both the sample and the code use this instead of `stepCode`.
   */
  code(): number;
  /** Serialize the full engine state so a later `restore` can resume exactly. */
  snapshot(): string;
  /** Rebuild the engine from a snapshot, returning the pose at that tick. */
  restore(snapshot: string): SimPoint;
  /** Release the underlying WASM object. */
  free(): void;
}

/**
 * Build an engine from a level and arrow so callers can drive it tick by tick.
 * Resolves to null if the engine cannot be initialised, mirroring
 * `simulateRun`'s fallback.
 */
export async function createReplayEngine(
  data: RawLevelData | null | undefined,
  arrowName?: string | null,
): Promise<ReplayEngine | null> {
  if (!data) return null;
  let mod: EngineModule;
  try {
    mod = await loadEngine();
  } catch {
    return null;
  }

  const base = mod.create_default_game_state();
  const map = {
    game_mode: data.game_mode ?? "speedrun",
    map_name: data.map_name ?? "",
    obstacles: engineObstacles(data),
  };
  const player = {
    ...base.player,
    constants: { ...base.player.constants, ...arrowConstants(arrowName) },
  };
  const state = () => ({ player, map: map as unknown as ApiMap, ticks: 0, effects: base.effects });

  const read = (engine: InstanceType<EngineModule["GameMechanicsEngine"]>): SimPoint => {
    const s = JSON.parse(engine.state) as EnginePlayerState;
    return {
      x: s.player.translation.x,
      y: s.player.translation.y,
      rot: s.player.rotation - Math.PI / 2,
      finished: s.player.state === "finish",
      thrustPower: s.player.thrust_power ?? 0,
    };
  };

  // Wind/suction fields are not part of the engine, so they are applied here as
  // a per-tick velocity delta: step, then add the field's force to the arrow's
  // velocity and rebuild the engine from that state. The rebuild is ~25x the
  // cost of a raw step, so it is skipped entirely on levels with no fields and
  // whenever the arrow is outside every field.
  const fields = levelGeometry(data).forceFields ?? [];
  const hasFields = fields.length > 0;
  const triggers = levelGeometry(data).triggers ?? [];
  const hasTriggers = triggers.length > 0;

  // Moving blocks are the same story on the geometry side: the engine can spin
  // an obstacle but not slide one, so each tick we rebuild the engine from its
  // own state with the block's points offset by the animation curve. A block is
  // authored as a plain wall, so its base points are known from the level and
  // the offset is a pure function of the tick — which also keeps `snapshot`
  // clean (see below).
  const allObstacles = data.obstacles ?? [];
  // Engine obstacle index for each authored index; force fields are stripped
  // before the engine sees the list, so the two indices diverge when a field
  // precedes a block.
  const engineIndexOf: number[] = [];
  let engineCount = 0;
  for (const o of allObstacles) {
    if (isForceField(o)) {
      engineIndexOf.push(-1);
    } else {
      engineIndexOf.push(engineCount);
      engineCount++;
    }
  }
  const engineObstacleList = engineObstacles(data);
  const motions = levelMotions(data)
    .map((m) => {
      const engineIndex = engineIndexOf[m.obstacleIndex] ?? -1;
      const base = (engineObstacleList[engineIndex]?.points ?? []) as Array<{
        x: number;
        y: number;
      }>;
      return { ...m, engineIndex, base };
    })
    .filter((m) => m.engineIndex >= 0 && m.base.length > 0);
  const hasMotions = motions.length > 0;

  let engine: InstanceType<EngineModule["GameMechanicsEngine"]>;
  try {
    engine = new mod.GameMechanicsEngine(state());
  } catch {
    return null;
  }

  /** Translate every moving block to its offset at the engine's current tick. */
  const applyMotions = (): void => {
    const tick = engine.get_ticks();
    const s = JSON.parse(engine.state) as EnginePlayerState & {
      map?: { obstacles?: Array<{ points?: Array<{ x: number; y: number }> }> };
    };
    const obs = s.map?.obstacles;
    if (!obs) return;
    let changed = false;
    for (const m of motions) {
      const o = obs[m.engineIndex];
      if (!o) continue;
      const off = motionOffsetAt(m.dx, m.dy, m.period, tick);
      o.points = m.base.map((p) => ({ x: p.x + off.x, y: p.y + off.y }));
      changed = true;
    }
    if (!changed) return;
    engine.free();
    engine = new mod.GameMechanicsEngine(s as never);
  };

  /** Apply the fields' force at the arrow's current pose, if any apply. */
  const applyFields = (): void => {
    const s = JSON.parse(engine.state) as EnginePlayerState;
    const f = forceAt(fields, s.player.translation.x, s.player.translation.y);
    if (f.x === 0 && f.y === 0) return;
    const v = s.player.velocity ?? { x: 0, y: 0, r: 0 };
    s.player.velocity = { ...v, x: v.x + f.x, y: v.y + f.y };
    engine.free();
    engine = new mod.GameMechanicsEngine(s as never);
  };

  // The accelerator is the first mechanic here with *memory*: crossing a wire
  // captures the thrust direction and arms a charge. That charge lives in this
  // closure and travels in the snapshot envelope (see `snapshot`/`restore`),
  // because the editor and the brute-forcer both re-simulate through a wire from
  // a checkpoint taken before it — state the snapshot did not carry would
  // silently change the run and diverge from the live one.
  let wire: WireState = { armed: false, dirX: 0, dirY: 0, targetSpeed: 0, accel: 0 };

  /**
   * Detect a wire crossing against the previous tick's position (segment
   * intersection, so a fast arrow cannot tunnel through). On a crossing, arm
   * the charge with the wire's normal oriented the way the arrow is *facing*
   * (its heading), not the way its momentum happens to point — after a turn or
   * a brake the two differ, and a thrust oriented by momentum would fire
   * against the arrow's nose.
   */
  const armWire = (prevX: number, prevY: number): void => {
    const s = JSON.parse(engine.state) as EnginePlayerState;
    const t = s.player.translation;
    const heading = s.player.rotation - Math.PI / 2;
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    for (const trig of triggers) {
      const hit = segmentsIntersect(
        { x: prevX, y: prevY },
        { x: t.x, y: t.y },
        { x: trig.ax, y: trig.ay },
        { x: trig.bx, y: trig.by },
      );
      if (!hit) continue;
      const along = hx * trig.dirX + hy * trig.dirY >= 0 ? 1 : -1;
      wire = {
        armed: true,
        dirX: trig.dirX * along,
        dirY: trig.dirY * along,
        targetSpeed: trig.targetSpeed,
        accel: trig.accel,
      };
      return;
    }
  };

  /**
   * Thrust the armed charge for one tick. The boost stays in the player's hands:
   * it only fires while the player is coasting straight, so any steering input —
   * a brake, a turn, a zig-zag or a spin — cuts the thrust and hands the arrow
   * back to its own (draggy) physics, letting it slow down to clear a wall. The
   * thrust is oriented and gated by the arrow's *heading* (its nose), so it can
   * only ever push the arrow forwards; a brake or a 360 preserves the momentum
   * without re-firing the boost until the nose swings back along the wire. The
   * push fades linearly to zero as the speed nears `targetSpeed` so the ceiling
   * is soft, never a hard cap.
   */
  const applyWire = (symbol: number): void => {
    if (!wire.armed) return;
    if (symbol !== 0) return; // any steer or brake starves the charge
    const s = JSON.parse(engine.state) as EnginePlayerState;
    const v = s.player.velocity ?? { x: 0, y: 0, r: 0 };
    const speed = Math.hypot(v.x, v.y);
    if (speed <= 0) return;
    const heading = s.player.rotation - Math.PI / 2;
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    const align = hx * wire.dirX + hy * wire.dirY;
    if (align <= ACCELERATOR_MIN_ALIGN) return; // nose off the thrust: no boost
    const fade = Math.min(1, Math.max(0, 1 - speed / wire.targetSpeed));
    const push = wire.accel * align * fade;
    s.player.velocity = {
      ...v,
      x: v.x + wire.dirX * push,
      y: v.y + wire.dirY * push,
    };
    engine.free();
    engine = new mod.GameMechanicsEngine(s as never);
  };

  return {
    step(symbol) {
      const before = read(engine);
      engine.process_ticks([symbolToInput(symbol)]);
      if (engine.player_state_code() === 0) {
        if (hasMotions) applyMotions();
        if (hasFields) applyFields();
        if (hasTriggers) {
          armWire(before.x, before.y);
          applyWire(symbol);
        }
      }
      return read(engine);
    },
    stepCode(symbol) {
      const before = read(engine);
      engine.process_ticks([symbolToInput(symbol)]);
      const code = engine.player_state_code();
      if (code === 0) {
        if (hasMotions) applyMotions();
        if (hasFields) applyFields();
        if (hasTriggers) {
          armWire(before.x, before.y);
          applyWire(symbol);
        }
      }
      return code;
    },
    reset() {
      engine.free();
      engine = new mod.GameMechanicsEngine(state());
      wire = { armed: false, dirX: 0, dirY: 0, targetSpeed: 0, accel: 0 };
      if (hasMotions) applyMotions();
      return read(engine);
    },
    read() {
      return read(engine);
    },
    code() {
      return engine.player_state_code();
    },
    snapshot() {
      // Levels without a wire keep the raw engine state (cheap, and the format
      // every existing checkpoint already uses). A wired level wraps it so the
      // armed charge travels with the checkpoint.
      return hasTriggers
        ? JSON.stringify({ engine: JSON.parse(engine.state), wire })
        : engine.state;
    },
    restore(snapshot) {
      const parsed = JSON.parse(snapshot) as { engine?: unknown; wire?: WireState };
      const engineState = parsed.engine !== undefined ? parsed.engine : parsed;
      engine.free();
      engine = mod.GameMechanicsEngine.from_state(engineState as never);
      wire = parsed.wire ?? { armed: false, dirX: 0, dirY: 0, targetSpeed: 0, accel: 0 };
      return read(engine);
    },
    free() {
      engine.free();
    },
  };
}

/**
 * Map a decoded 2-bit symbol to the engine's input. Symbol mapping is pinned
 * in `replay.ts`: 1 = right steer, 2 = left steer, 3 = brake (both held).
 */
function symbolToInput(symbol: number): EngineInput {
  switch (symbol) {
    case 1:
      return { left: false, right: true };
    case 2:
      return { left: true, right: false };
    case 3:
      return { left: true, right: true };
    default:
      return { left: false, right: false };
  }
}

/**
 * Reconstruct a run by stepping the real engine over its recorded inputs.
 * Returns an empty path (and null finish) if the engine cannot be initialised,
 * so callers can fall back to the input breakdown.
 */
export async function simulateRun(
  inputsBase64: string,
  inputCount: number | undefined,
  data: RawLevelData | null | undefined,
  options: SimOptions = {},
  arrowName?: string | null,
): Promise<SimResult> {
  const empty: SimResult = {
    path: [],
    finishTick: null,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  if (!data || !inputsBase64) return empty;

  const { decodeInputSymbols } = await import("./replay");
  const symbols = decodeInputSymbols(inputsBase64, inputCount);
  if (symbols.length === 0) return empty;

  const replay = await createReplayEngine(data, arrowName);
  if (!replay) return empty;

  const n = Math.min(symbols.length, options.maxTicks ?? symbols.length);
  const path: SimPoint[] = [];
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let finishTick: number | null = null;

  // Initial pose is part of the path (index 0 = spawn), matching the renderer's
  // expectation that `path[0]` is the start.
  path.push(replay.reset());

  // Advance one 240Hz tick per recorded input and record every sample, so a
  // spin that never translates still shows up in the path.
  for (let i = 0; i < n; i++) {
    const point = replay.step(symbols[i]);
    point.input = symbols[i];
    path.push(point);
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
    if (finishTick === null && point.finished) finishTick = path.length - 1;
  }

  replay.free();
  return { path, finishTick, bounds };
}
