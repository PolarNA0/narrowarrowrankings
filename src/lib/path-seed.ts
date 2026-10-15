/**
 * Turn a hand-drawn line into an input stream.
 *
 * The game only takes a steering input (left / right / both-to-brake) and
 * thrusts automatically, so a drawn route is followed with a pure-pursuit
 * controller: aim at the first waypoint at least `lookahead` ahead and steer
 * toward it, braking when the heading error is large. The result is a real,
 * simulatable run — usually a few seconds off the pace — which the brute
 * optimizer then refines into a line. It is the manual equivalent of tracing a
 * route on the map and asking the engine "how would I drive that?".
 */
import { createReplayEngine, type RawLevelData, type SimPoint } from "@/lib/replay-sim";

export interface Waypoint {
  x: number;
  y: number;
}

export interface PathSeedOptions {
  waypoints: Waypoint[];
  levelData: RawLevelData;
  arrowName: string;
  /** How far ahead (world units) to aim; larger cuts corners, smaller hugs them. */
  lookahead?: number;
  /** Heading error (radians) below which the arrow coasts straight. */
  deadband?: number;
  /** Heading error (radians) above which the arrow brakes instead of steering. */
  brakeError?: number;
  /** Hard cap on generated ticks so a loop cannot run away. */
  maxTicks?: number;
}

/** Symbols: 0 coast, 1 right, 2 left, 3 brake (both held). */
const COAST = 0;
const RIGHT = 1;
const LEFT = 2;
const BRAKE = 3;

/** Shortest signed angle from `b` to `a`, in (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Drop points closer than `spacing` to the previous kept point, so a raw
 * pointer stroke becomes a handful of waypoints instead of thousands.
 */
export function simplifyStroke(points: Waypoint[], spacing = 24): Waypoint[] {
  if (points.length <= 2) return points.slice();
  const out: Waypoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= spacing) out.push(points[i]);
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last.x - prev.x, last.y - prev.y) > 1) out.push(last);
  return out;
}

/**
 * Drive the arrow along `waypoints` with the real engine and return the input
 * symbols that steer it. Returns an empty array if the engine cannot start; the
 * run may still DNF (a line drawn through a wall), which the brute then repairs.
 */
export async function waypointsToSymbols(options: PathSeedOptions): Promise<number[]> {
  const { waypoints } = options;
  if (waypoints.length < 2) return [];

  const engine = await createReplayEngine(options.levelData, options.arrowName);
  if (!engine) return [];

  const lookahead = options.lookahead ?? 56;
  const deadband = options.deadband ?? 0.04;
  // Braking kills speed and, once stopped in a corner, never recovers, so it is
  // reserved for genuinely impossible headings and left off by default.
  const brakeError = options.brakeError ?? 1.6;
  const maxTicks = options.maxTicks ?? 8000;

  const symbols: number[] = [];
  let pose: SimPoint = engine.reset();
  let target = 1;

  try {
    for (let t = 0; t < maxTicks; t++) {
      // Advance the target to the first waypoint at least `lookahead` ahead.
      while (
        target < waypoints.length - 1 &&
        Math.hypot(waypoints[target].x - pose.x, waypoints[target].y - pose.y) < lookahead
      ) {
        target++;
      }
      const wp = waypoints[target];
      const err = angleDiff(Math.atan2(wp.y - pose.y, wp.x - pose.x), pose.rot);
      const symbol =
        Math.abs(err) > brakeError
          ? BRAKE
          : Math.abs(err) > deadband
            ? err > 0
              ? RIGHT
              : LEFT
            : COAST;

      symbols.push(symbol);
      pose = engine.step(symbol);
      if (pose.finished) break;
    }
  } finally {
    engine.free();
  }
  return symbols;
}
