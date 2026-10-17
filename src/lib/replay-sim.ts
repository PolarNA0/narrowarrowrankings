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
}

/** A filled zone (boost/ice/nosteer/steer/rail), given as an axis-aligned box. */
export interface SimZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  type: string;
}

/** A portal, drawn as a segment with an arrow showing the travel direction. */
export interface SimPortal {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Everything the renderer needs, split by how each obstacle is drawn. */
export interface SimGeometry {
  walls: SimWall[];
  zones: SimZone[];
  portals: SimPortal[];
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
  for (const obstacle of data?.obstacles ?? []) {
    const pts = obstacle.points ?? [];
    const isZone = obstacle.zone_type != null || obstacle.obstacle_type === "zone";
    const isPortal = obstacle.portal_id != null || obstacle.obstacle_type === "portal";

    if (isZone) {
      const xs = pts.map((p) => p?.x).filter((x): x is number => x != null);
      const ys = pts.map((p) => p?.y).filter((y): y is number => y != null);
      if (xs.length === 0 || ys.length === 0) continue;
      zones.push({
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

    // Some obstacles carry a single point, not a polyline: the editor lets you
    // drop a wall as a dot, and the engine still collides with it (a
    // zero-length segment with the same thickness). Rendering it as a dot keeps
    // those collisions visible instead of reading as a bonk against nothing.
    const valid = pts.filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null);
    if (valid.length === 1) {
      const p = valid[0];
      walls.push({ ax: p.x, ay: p.y, bx: p.x, by: p.y, type, thickness, pivot, rotationSpeed });
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
      });
    }
  }
  return { walls, zones, portals };
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
  return (data.obstacles ?? []).map((o) => {
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

/** Minimal shape of the engine state the replay reads. */
interface EnginePlayerState {
  player: {
    translation: { x: number; y: number };
    rotation: number;
    state?: string;
    /** Engine's current thrust level (0..1); drives the flame length. */
    thrust_power?: number;
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

  let engine: InstanceType<EngineModule["GameMechanicsEngine"]>;
  try {
    engine = new mod.GameMechanicsEngine(state());
  } catch {
    return null;
  }

  return {
    step(symbol) {
      engine.process_ticks([symbolToInput(symbol)]);
      return read(engine);
    },
    stepCode(symbol) {
      engine.process_ticks([symbolToInput(symbol)]);
      return engine.player_state_code();
    },
    reset() {
      engine.free();
      engine = new mod.GameMechanicsEngine(state());
      return read(engine);
    },
    snapshot() {
      return engine.state;
    },
    restore(snapshot) {
      engine.free();
      engine = mod.GameMechanicsEngine.from_state(JSON.parse(snapshot) as never);
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
