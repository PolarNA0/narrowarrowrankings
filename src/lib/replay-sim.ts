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
 * input tick; the viewer samples it every four ticks (one 60Hz frame) to match
 * the render rate.
 */
export const SIM_TICK_MS = 1000 / 60;

/** Input ticks consumed per rendered step (240Hz inputs / 60Hz frames). */
const INPUTS_PER_STEP = 4;

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
}

export interface SimWall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  type: string;
  thickness: number;
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
    portal_id?: string;
    side?: string;
    speed?: number;
  }>;
}

export interface SimOptions {
  /** Maximum number of input samples to simulate (guards very long runs). */
  maxTicks?: number;
}

/** Flatten a level's obstacles into line segments for rendering. */
export function levelWalls(data: RawLevelData | null | undefined): SimWall[] {
  const walls: SimWall[] = [];
  for (const obstacle of data?.obstacles ?? []) {
    const pts = obstacle.points ?? [];
    const type = obstacle.wall_type ?? "normal";
    const thickness = obstacle.wall_thickness ?? 8;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a?.x == null || a?.y == null || b?.x == null || b?.y == null) continue;
      walls.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, type, thickness });
    }
  }
  return walls;
}

/**
 * Build the obstacle list the engine expects. `ApiObstacle` is an internally
 * tagged enum: walls carry `wall_type`/`wall_thickness`, zones carry
 * `zone_type` (boost/ice/nosteer/steer), and portals carry
 * `portal_id`/`side`. Every field the level uses is passed through verbatim
 * and only `obstacle_type` is inferred when the payload omits it, because the
 * engine rejects an entry whose type does not match its required fields.
 */
function engineObstacles(data: RawLevelData) {
  const fields = [
    "wall_type",
    "wall_thickness",
    "zone_type",
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

  let mod: EngineModule;
  try {
    mod = await loadEngine();
  } catch {
    return empty;
  }

  const base = mod.create_default_game_state();
  const maxTicks = options.maxTicks ?? symbols.length;
  const n = Math.min(symbols.length, maxTicks);

  const map = {
    game_mode: data.game_mode ?? "speedrun",
    map_name: data.map_name ?? "",
    obstacles: engineObstacles(data),
  };

  // The engine's default constants are a mix of two arrows; override them with
  // the run's own arrow so the reconstruction matches what was actually played.
  const player = {
    ...base.player,
    constants: { ...base.player.constants, ...arrowConstants(arrowName) },
  };

  let engine: InstanceType<EngineModule["GameMechanicsEngine"]>;
  try {
    engine = new mod.GameMechanicsEngine({
      player,
      map,
      ticks: 0,
      effects: base.effects,
    });
  } catch {
    return empty;
  }

  const path: SimPoint[] = [];
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let finishTick: number | null = null;

  // Initial pose is part of the path (index 0 = spawn), matching the renderer's
  // expectation that `path[0]` is the start.
  {
    const s0 = JSON.parse(engine.state) as {
      player: { translation: { x: number; y: number }; rotation: number };
    };
    path.push({
      x: s0.player.translation.x,
      y: s0.player.translation.y,
      rot: s0.player.rotation - Math.PI / 2,
    });
  }

  // Advance the engine one 240Hz tick at a time and record one point per 60Hz
  // frame (every fourth tick), so playback spans the same wall-clock time as
  // the run.
  for (let i = 0; i < n; i += INPUTS_PER_STEP) {
    const group = symbols.slice(i, i + INPUTS_PER_STEP);
    engine.process_ticks(group.map(symbolToInput));
    const state = JSON.parse(engine.state) as {
      player: {
        translation: { x: number; y: number };
        rotation: number;
        state?: string;
      };
    };
    const { translation, rotation, state: playerState } = state.player;
    path.push({ x: translation.x, y: translation.y, rot: rotation - Math.PI / 2 });
    bounds.minX = Math.min(bounds.minX, translation.x);
    bounds.minY = Math.min(bounds.minY, translation.y);
    bounds.maxX = Math.max(bounds.maxX, translation.x);
    bounds.maxY = Math.max(bounds.maxY, translation.y);
    if (finishTick === null && playerState === "finish") finishTick = path.length - 1;
  }

  engine.free();
  return { path, finishTick, bounds };
}
