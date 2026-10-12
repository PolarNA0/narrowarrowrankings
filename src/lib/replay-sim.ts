/**
 * Reconstructs a run's trajectory from its recorded inputs and the level
 * geometry, so a replay can be played back as an animation rather than only a
 * list of timestamps.
 *
 * The model is a port of the game's `Player` (RigidBody2D) script and its
 * `_physics_process`. Three details matter and the first two were wrong in the
 * original cut:
 *
 *   - The game forces `delta = 1/60` at the top of `_physics_process`, so the
 *     physics runs at 60Hz. Inputs are sampled at 240Hz (4.1667ms), i.e. four
 *     input symbols per physics step. Stepping once per input symbol made every
 *     event happen 4x too late in wall-clock time — the reported "inputs start
 *     too late" symptom — and the 1/240 `delta` also under-applied the
 *     per-step damping.
 *   - Symbol 1 is the "right" steer and symbol 2 is "left". Getting this
 *     backwards sends the arrow into the walls on the first corner.
 *   - Neutral (symbol 0) spins the throttle *up*, not down: the game only
 *     brakes when both steer directions are held (symbol 3).
 *
 * Per step, with `delta = 1/60`:
 *   - steering applies an angular impulse of +/-100000 * delta
 *   - holding either steer spins the throttle up by delta, brake (both held)
 *     spins it down; throttle is clamped to [-0.1, 1]
 *   - forward thrust is an impulse of 2000 * delta * throttle along facing
 *   - linear damp 1, angular damp 4 (both tripled while braking)
 *   - walls push the player out; normal walls reflect with restitution 0.25,
 *     bouncy walls with 1.2, death and boost walls are solid
 *
 * This is still an approximation: the exact collision shape, zone effects and
 * mass/inertia of the shipped player scene are not reproduced, so the result is
 * directionally faithful but not a frame-exact reproduction of the game.
 */

import { decodeInputSymbols } from "./replay";

export interface SimPoint {
  x: number;
  y: number;
  rot: number;
}

export interface SimWall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  type: string;
  /** Wall thickness, used to size the player's push-out radius. */
  thickness: number;
}

export interface SimResult {
  path: SimPoint[];
  /** Step index (60Hz) at which the finish line was crossed, or null. */
  finishTick: number | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Raw level payload as returned by `/level-details`. */
export interface RawLevelData {
  obstacles?: Array<{
    points?: Array<{ x?: number; y?: number }>;
    wall_type?: string;
    wall_thickness?: number;
  }>;
}

/**
 * Milliseconds per simulation step. The game's `_physics_process` forces
 * `delta = 1/60`, so one physics step is one 60Hz frame = four recorded input
 * samples (inputs are 240Hz).
 */
export const SIM_TICK_MS = 1000 / 60;
const DT = SIM_TICK_MS / 1000;
/** Input symbols consumed per physics step (240Hz inputs / 60Hz physics). */
const INPUTS_PER_STEP = 4;
const TORQUE = 100_000;
const THRUST = 2000;
/**
 * Effective rotational inertia of the shipped player scene. The scene mass and
 * inertia are not in the exported build, so this is the value that best tracks
 * real runs across multiple levels. Too small a value makes the arrow pivot on
 * a dime and spin itself into the walls on every corner.
 */
const INERTIA = 4000;
const LINEAR_DAMP = 1;
const ANGULAR_DAMP = 4;
const BRAKE_DRAG = 3;
const RESTITUTION = 0.25;
const BOUNCY_RESTITUTION = 1.2;
/** Player collision radius in level units. */
const PLAYER_RADIUS = 16;
/** Steer symbol (1 or 2) mapped to -1 (left) / +1 (right); see module docs. */
const SYMBOL_TO_STEER: Record<number, number> = { 1: 1, 2: -1 };

/** Flatten a level's obstacles into line segments. */
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

interface ResolvedWall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  type: string;
  dx: number;
  dy: number;
  len2: number;
  /** Push-out radius: player radius plus half the wall's thickness. */
  radius: number;
  restitution: number;
  finish: boolean;
}

function prepare(walls: SimWall[], radius: number): ResolvedWall[] {
  return walls.map((w) => {
    const dx = w.bx - w.ax;
    const dy = w.by - w.ay;
    return {
      ax: w.ax,
      ay: w.ay,
      bx: w.bx,
      by: w.by,
      type: w.type,
      dx,
      dy,
      len2: dx * dx + dy * dy,
      radius: radius + w.thickness / 2,
      restitution: w.type === "bouncy" ? BOUNCY_RESTITUTION : RESTITUTION,
      finish: w.type === "finish",
    };
  });
}

function closestDistance(w: ResolvedWall, x: number, y: number): number {
  const t =
    w.len2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * w.dx + (y - w.ay) * w.dy) / w.len2)) : 0;
  return Math.hypot(x - (w.ax + t * w.dx), y - (w.ay + t * w.dy));
}

/** Push the player out of any wall it overlaps and reflect its velocity. */
function resolveCollisions(
  x: number,
  y: number,
  vx: number,
  vy: number,
  walls: ResolvedWall[],
): [number, number, number, number] {
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      if (w.finish) continue;
      const t =
        w.len2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * w.dx + (y - w.ay) * w.dy) / w.len2)) : 0;
      let nx = x - (w.ax + t * w.dx);
      let ny = y - (w.ay + t * w.dy);
      const dist = Math.hypot(nx, ny);
      if (dist >= w.radius || dist < 1e-6) continue;
      nx /= dist;
      ny /= dist;
      const penetration = w.radius - dist;
      x += nx * penetration;
      y += ny * penetration;
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        vx -= (1 + w.restitution) * vn * nx;
        vy -= (1 + w.restitution) * vn * ny;
      }
    }
  }
  return [x, y, vx, vy];
}

function withinFinish(x: number, y: number, walls: ResolvedWall[], radius: number): boolean {
  for (const w of walls) {
    if (w.finish && closestDistance(w, x, y) <= radius + 2) return true;
  }
  return false;
}

export interface SimOptions {
  /** Maximum number of input samples to simulate (guards very long runs). */
  maxTicks?: number;
  inertia?: number;
  radius?: number;
}

/**
 * Run the physics forward over the decoded input stream and return the path.
 * One physics step is one 60Hz frame (four 240Hz input samples).
 */
export function simulateRun(
  inputsBase64: string,
  inputCount: number | undefined,
  data: RawLevelData | null | undefined,
  options: SimOptions = {},
): SimResult {
  const symbols = decodeInputSymbols(inputsBase64, inputCount);
  const radius = options.radius ?? PLAYER_RADIUS;
  const inertia = options.inertia ?? INERTIA;
  const walls = prepare(levelWalls(data), radius);

  let x = 0;
  let y = 0;
  let rot = -Math.PI / 2;
  let vx = 0;
  let vy = 0;
  let av = 0;
  let throttle = 0;

  const maxTicks = options.maxTicks ?? 60 * 180;
  const steps = Math.min(Math.ceil(symbols.length / INPUTS_PER_STEP), maxTicks);

  const path: SimPoint[] = [{ x, y, rot }];
  let finishTick: number | null = null;
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  for (let f = 0; f < steps; f++) {
    // A physics step spans four 240Hz input samples; the game reads the key
    // state once at the top of the frame, so use the first sample in the group.
    const start = f * INPUTS_PER_STEP;
    const symbol = symbols[Math.min(start, symbols.length - 1)];
    const steer = SYMBOL_TO_STEER[symbol] ?? 0;
    const braking = symbol === 3;

    if (steer !== 0) av += (steer * DT * TORQUE) / inertia;

    let linearDamp = LINEAR_DAMP;
    let angularDamp = ANGULAR_DAMP;
    if (braking) {
      throttle = Math.max(-0.1, throttle - DT);
      linearDamp *= BRAKE_DRAG;
      angularDamp *= BRAKE_DRAG;
    } else {
      throttle = Math.min(1, throttle + DT);
    }

    vx += Math.cos(rot) * THRUST * DT * throttle;
    vy += Math.sin(rot) * THRUST * DT * throttle;
    vx *= 1 - linearDamp * DT;
    vy *= 1 - linearDamp * DT;
    av *= 1 - angularDamp * DT;

    x += vx * DT;
    y += vy * DT;
    rot += av * DT;

    [x, y, vx, vy] = resolveCollisions(x, y, vx, vy, walls);

    path.push({ x, y, rot });
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;

    if (finishTick === null && withinFinish(x, y, walls, radius)) finishTick = f;
  }

  return { path, finishTick, bounds };
}
