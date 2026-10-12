/**
 * Reconstructs a run's trajectory from its recorded inputs and the level
 * geometry, so a replay can be played back as an animation rather than only a
 * list of timestamps.
 *
 * The model is a straight port of the game's `Player` (RigidBody2D) script and
 * its `_physics_process`, which runs at a fixed 60Hz:
 *
 *   - no gravity; steering applies an angular impulse of 100000 * dt
 *   - holding either steer spins the throttle up by dt, brake (both held) spins
 *     it down; throttle is clamped to [-0.1, 1]
 *   - forward thrust is an impulse of 2000 * dt * throttle along facing
 *   - linear damp 1, angular damp 4 (both tripled while braking)
 *   - walls push the player out; normal walls reflect with restitution 0.25,
 *     bouncy walls with 1.2, death/boost/finish walls are treated as solid
 *
 * The recorded input stream is 240Hz, so four samples make one physics frame;
 * the sample at the frame boundary is the one the physics step reacts to. Which
 * of the two steer symbols is "left" cannot be recovered (a mirrored run is
 * physically identical), so `symbolToSteer` keeps that in one spot.
 *
 * This is an approximation: exact collision shapes, zone multipliers and
 * per-frame input latency are not reproduced, so the result is directionally
 * correct rather than frame-perfect.
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
}

export interface SimResult {
  path: SimPoint[];
  /** Tick index (60Hz) at which the finish line was crossed, or null. */
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

const DT = 1 / 60;
const TORQUE = 100_000;
const THRUST = 2000;
/** Effective rotational inertia; tuned so turns match the game's pace. */
const INERTIA = 4000;
const LINEAR_DAMP = 1;
const ANGULAR_DAMP = 4;
const BRAKE_DRAG = 3;
const RESTITUTION = 0.25;
const BOUNCY_RESTITUTION = 1.2;
/** Player collision radius in level units. */
const PLAYER_RADIUS = 16;
/** Steer symbol (1 or 2) mapped to -1 (left) / +1 (right); see module docs. */
const SYMBOL_TO_STEER: Record<number, number> = { 1: -1, 2: 1 };

/** Flatten a level's obstacles into line segments. */
export function levelWalls(data: RawLevelData | null | undefined): SimWall[] {
  const walls: SimWall[] = [];
  for (const obstacle of data?.obstacles ?? []) {
    const pts = obstacle.points ?? [];
    const type = obstacle.wall_type ?? "normal";
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a?.x == null || a?.y == null || b?.x == null || b?.y == null) continue;
      walls.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, type });
    }
  }
  return walls;
}

interface ResolvedWall extends SimWall {
  dx: number;
  dy: number;
  len2: number;
  radius: number;
  restitution: number;
}

function prepare(walls: SimWall[], radiiByType?: (type: string) => number): ResolvedWall[] {
  return walls.map((w) => {
    const dx = w.bx - w.ax;
    const dy = w.by - w.ay;
    const half = radiiByType ? radiiByType(w.type) : 0;
    return {
      ...w,
      dx,
      dy,
      len2: dx * dx + dy * dy,
      radius: PLAYER_RADIUS + half,
      restitution: w.type === "bouncy" ? BOUNCY_RESTITUTION : RESTITUTION,
    };
  });
}

function resolveCollisions(
  x: number,
  y: number,
  vx: number,
  vy: number,
  walls: ResolvedWall[],
): [number, number, number, number] {
  for (const w of walls) {
    if (w.type === "finish") continue;
    let t = 0;
    if (w.len2 > 0) t = Math.max(0, Math.min(1, ((x - w.ax) * w.dx + (y - w.ay) * w.dy) / w.len2));
    const cx = w.ax + t * w.dx;
    const cy = w.ay + t * w.dy;
    let nx = x - cx;
    let ny = y - cy;
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
  return [x, y, vx, vy];
}

function withinFinish(x: number, y: number, walls: ResolvedWall[]): boolean {
  for (const w of walls) {
    if (w.type !== "finish") continue;
    let t = 0;
    if (w.len2 > 0) t = Math.max(0, Math.min(1, ((x - w.ax) * w.dx + (y - w.ay) * w.dy) / w.len2));
    const cx = w.ax + t * w.dx;
    const cy = w.ay + t * w.dy;
    if (Math.hypot(x - cx, y - cy) <= w.radius) return true;
  }
  return false;
}

/**
 * Run the physics forward over the decoded input stream and return the path.
 * `maxTicks` bounds the work for very long or stuck runs.
 */
export function simulateRun(
  inputsBase64: string,
  inputCount: number | undefined,
  data: RawLevelData | null | undefined,
  maxTicks = 3600,
): SimResult {
  const symbols = decodeInputSymbols(inputsBase64, inputCount);
  const walls = prepare(levelWalls(data), (type) =>
    type === "finish" || type === "normal" ? 4 : 0,
  );

  let x = 0;
  let y = 0;
  let rot = -Math.PI / 2;
  let vx = 0;
  let vy = 0;
  let av = 0;
  let throttle = 0;

  const path: SimPoint[] = [{ x, y, rot }];
  let finishTick: number | null = null;
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const frames = Math.min(Math.floor(symbols.length / 4), maxTicks);
  for (let f = 0; f < frames; f++) {
    const steer = SYMBOL_TO_STEER[symbols[f * 4]] ?? 0;
    const braking = symbols[f * 4] === 3;

    if (steer !== 0) av += (steer * DT * TORQUE) / INERTIA;

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

    if (finishTick === null && withinFinish(x, y, walls)) finishTick = f;
  }

  return { path, finishTick, bounds };
}

/** Tick rate of a simulated path (matches the game's physics rate). */
export const SIM_TICK_MS = 1000 / 60;
