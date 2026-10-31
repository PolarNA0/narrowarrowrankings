import type { ApiEffects, ApiMap } from "./physics/rust";
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
  /**
   * Which site-only puzzle mechanic this wall belongs to, when it is one, plus
   * its index in that mechanic's array in `SimGeometry`. `paintWalls` skips
   * these (they are drawn by `paintSiteMechanics`, which knows their state);
   * without the tag a door or breakable would render as a plain white wall.
   */
  siteKind?: "door" | "gate" | "blink" | "breakable";
  siteIndex?: number;
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
 * A grip zone (site-only): a polygon the arrow flies into where it turns far
 * tighter and slides less. The engine cannot express this — it has no
 * friction/grip zone, and an unknown `zone_type` is silently ignored — so the
 * sim swaps the player's constants while the arrow is inside and rebuilds the
 * engine (the same continuous-rebuild trick as the force fields).
 */
export interface GripZone {
  /** The zone's polygon, in world units. */
  points: Array<{ x: number; y: number }>;
  /** Multiplier on the arrow's `turning_speed` inside the zone. */
  multiplier: number;
  /** Multiplier on the arrow's `traction_power` inside the zone. */
  traction: number;
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

/**
 * A switch/door pair (site-only). A switch is a sensor area; entering it (with
 * the right `switch_action`) flips every door that shares its `switch_group`.
 * A door is a wall whose solidity is controlled: while open the simulation
 * rebuilds the engine with the door's points collapsed to a degenerate segment
 * at its midpoint, so the arrow passes through; while shut it is a normal wall.
 * The engine has no concept of a door, so this is applied exactly like the
 * moving blocks — by rewriting the obstacle's points each tick.
 */
export interface SimDoor {
  /** Index into the level's obstacle list. */
  obstacleIndex: number;
  /** Engine obstacle index (force fields are stripped, so the two diverge). */
  engineIndex: number;
  /** Base (drawn) points, so an offset never compounds across ticks. */
  base: Array<{ x: number; y: number }>;
  /** Group id shared with the switch that drives it. */
  group: string;
  /** True when the door starts open (inverted by the switch's action). */
  startOpen: boolean;
}

/** A switch that flips the doors in its group when the arrow enters its area. */
export interface SimSwitch {
  /** Polygon area the arrow must enter. */
  points: Array<{ x: number; y: number }>;
  group: string;
  /** `toggle` flips the group; `on`/`off` latch it. */
  action: "toggle" | "on" | "off";
}

/**
 * A one-way gate (site-only): a wall that is solid only from one side. The
 * engine has no per-side walls, so the sim rebuilds the gate as a solid wall
 * while the arrow is on the blocked side and as a degenerate point while it is
 * on the passable side. `nx`/`ny` is the outward normal of the *blocked* face:
 * an arrow approaching against the normal (from the blocked side) hits a wall,
 * an arrow travelling with it passes through.
 */
export interface SimGate {
  obstacleIndex: number;
  engineIndex: number;
  base: Array<{ x: number; y: number }>;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
}

/**
 * A blinking (timed) block (site-only): a wall that is solid for part of a
 * fixed period and passable for the rest, so the player times the crossing. The
 * sim collapses its points to a degenerate segment while it is "off". The
 * engine cannot toggle an obstacle, so this is applied the same way as a door.
 */
export interface SimBlink {
  obstacleIndex: number;
  engineIndex: number;
  base: Array<{ x: number; y: number }>;
  /** Ticks for one full on/off cycle. */
  period: number;
  /** Fraction of the period the block is solid, 0..1. */
  duty: number;
  /** Tick offset of the cycle, so several blocks can be desynchronised. */
  phase: number;
}

/**
 * A breakable wall (site-only): a wall that vanishes once the arrow touches it.
 * The engine has no destructible obstacles, so the sim watches the engine's
 * wall-contact effects each tick and collapses the wall's points once its own
 * obstacle index is reported. The wall never comes back within a run, so the
 * broken set travels in the snapshot envelope.
 */
export interface SimBreakable {
  obstacleIndex: number;
  engineIndex: number;
  base: Array<{ x: number; y: number }>;
}

/** Everything the renderer needs, split by how each obstacle is drawn. */
export interface SimGeometry {
  walls: SimWall[];
  zones: SimZone[];
  portals: SimPortal[];
  /** Site-only wind/suction fields, drawn as faint white areas with particles. */
  forceFields?: ForceField[];
  /** Site-only grip zones, drawn as hatched high-friction areas. */
  gripZones?: GripZone[];
  /** Site-only accelerator wires, drawn as thin charged lines. */
  triggers?: SimTrigger[];
  /** Site-only moving blocks, drawn at their current-tick offset. */
  movingBlocks?: SimMotion[];
  /** Site-only switch/door pairs. */
  doors?: SimDoor[];
  /** Site-only switch sensors that drive the doors. */
  switches?: SimSwitch[];
  /** Site-only one-way gates. */
  gates?: SimGate[];
  /** Site-only blinking (timed) blocks. */
  blinks?: SimBlink[];
  /** Site-only breakable walls. */
  breakables?: SimBreakable[];
}

export interface SimResult {
  path: SimPoint[];
  /** Tick (input index) at which the finish was reached, or null. */
  finishTick: number | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * The site-only events the run produced (switch fires, broken walls), so the
   * renderer can reproduce a door's open state or a broken wall at any tick.
   * Absent on levels with no such mechanic.
   */
  timeline?: SiteTimeline;
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
    /**
     * Site-only grip zone. While the arrow is inside the polygon the sim scales
     * the player's `turning_speed` by `grip_multiplier` and `traction_power` by
     * `grip_traction`, then rebuilds the engine — a high-friction surface. The
     * engine has no grip zone (an unknown `zone_type` is silently ignored), so
     * this is applied here and stripped from the game export.
     */
    grip_multiplier?: number;
    grip_traction?: number;
    /**
     * Site-only switch/door. A `switch` obstacle is a sensor polygon carrying a
     * `switch_group` and a `switch_action` ("toggle" | "on" | "off"); a `door`
     * wall carries the same `switch_group` and a `door_start_open` flag. The sim
     * tracks each group's open state and rebuilds a shut door as a real wall and
     * an open one as a degenerate point, so the engine never needs a door.
     */
    switch_group?: string;
    switch_action?: string;
    door_start_open?: boolean;
    /**
     * Site-only one-way gate. `gate_normal` is the outward normal of the blocked
     * face; an arrow on the blocked side collides, one travelling with the
     * normal passes through.
     */
    gate_normal?: { x?: number; y?: number } | null;
    /**
     * Site-only blinking (timed) block. `blink_period` is the full on/off cycle
     * in ticks, `blink_duty` the fraction solid (0..1) and `blink_phase` a tick
     * offset so several blocks can be desynchronised.
     */
    blink_period?: number;
    blink_duty?: number;
    blink_phase?: number;
    /** Site-only breakable wall: vanishes once the arrow touches it. */
    breakable?: boolean;
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
  const gripZones: GripZone[] = [];
  const triggers: SimTrigger[] = [];
  const obstacles = data?.obstacles ?? [];
  const motionByObstacle = new Map<number, number>();
  for (let i = 0; i < obstacles.length; i++) {
    if (isMovingBlock(obstacles[i])) motionByObstacle.set(i, motionByObstacle.size);
  }
  // Engine index for each authored index: force fields, wires and switch
  // sensors never reach the engine, so the two indices diverge when one of them
  // precedes a wall. Doors, gates, blinks and breakables DO reach the engine
  // (they are real walls in some states), so they are counted.
  const engineIndexOf: number[] = [];
  let engineCount = 0;
  for (const o of obstacles) {
    if (isNonEngineObstacle(o)) {
      engineIndexOf.push(-1);
    } else {
      engineIndexOf.push(engineCount);
      engineCount++;
    }
  }
  const engineBase = (i: number): Array<{ x: number; y: number }> =>
    (
      (obstacles[i]?.points ?? []).filter(
        (p): p is { x: number; y: number } => p?.x != null && p?.y != null,
      ) ?? []
    ).map((p) => ({ x: p.x, y: p.y }));

  const doors: SimDoor[] = [];
  const switches: SimSwitch[] = [];
  const gates: SimGate[] = [];
  const blinks: SimBlink[] = [];
  const breakables: SimBreakable[] = [];
  // Obstacle index → dense index in each mechanic's array, so the wall loop can
  // tag a wall with the mechanic that owns it.
  const siteTagByObstacle = new Map<
    number,
    { siteKind: NonNullable<SimWall["siteKind"]>; siteIndex: number }
  >();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (isSwitchObstacle(o)) {
      const valid = (o.points ?? []).filter(
        (p): p is { x: number; y: number } => p?.x != null && p?.y != null,
      );
      if (valid.length < 3) continue;
      switches.push({
        points: valid.map((p) => ({ x: p.x, y: p.y })),
        group: o.switch_group ?? "a",
        action: (o.switch_action as SimSwitch["action"]) ?? "toggle",
      });
      continue;
    }
    const engineIndex = engineIndexOf[i] ?? -1;
    if (engineIndex < 0) continue;
    const base = engineBase(i);
    if (base.length === 0) continue;
    if (isDoorObstacle(o)) {
      siteTagByObstacle.set(i, { siteKind: "door", siteIndex: doors.length });
      doors.push({
        obstacleIndex: i,
        engineIndex,
        base,
        group: o.switch_group as string,
        startOpen: o.door_start_open === true,
      });
    }
    if (isOneWayGate(o)) {
      const a = base[0];
      const b = base[base.length - 1];
      siteTagByObstacle.set(i, { siteKind: "gate", siteIndex: gates.length });
      gates.push({
        obstacleIndex: i,
        engineIndex,
        base,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        nx: o.gate_normal?.x ?? 0,
        ny: o.gate_normal?.y ?? 0,
      });
    }
    if (isBlinkBlock(o)) {
      siteTagByObstacle.set(i, { siteKind: "blink", siteIndex: blinks.length });
      blinks.push({
        obstacleIndex: i,
        engineIndex,
        base,
        period: o.blink_period as number,
        duty: isFiniteNum(o.blink_duty) ? Math.min(1, Math.max(0, o.blink_duty)) : 0.5,
        phase: isFiniteNum(o.blink_phase) ? o.blink_phase : 0,
      });
    }
    if (isBreakableWall(o)) {
      siteTagByObstacle.set(i, { siteKind: "breakable", siteIndex: breakables.length });
      breakables.push({ obstacleIndex: i, engineIndex, base });
    }
  }
  for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
    const obstacle = obstacles[obstacleIndex];
    const pts = obstacle.points ?? [];

    // Site-only grip zones are neither walls nor zones: the sim swaps the
    // player's constants while the arrow is inside, so they must never be
    // emitted as an engine obstacle.
    if (isGripZone(obstacle)) {
      const valid = pts.filter((p): p is { x: number; y: number } => p?.x != null && p?.y != null);
      if (valid.length < 3) continue;
      gripZones.push({
        points: valid.map((p) => ({ x: p.x, y: p.y })),
        multiplier: isFiniteNum(obstacle.grip_multiplier) ? obstacle.grip_multiplier : 1,
        traction: isFiniteNum(obstacle.grip_traction) ? obstacle.grip_traction : 1,
      });
      continue;
    }

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

    // Switch sensors are site-only: the sim reads them, the engine must never
    // collide with them (they would be an invisible wall in the arrow's path).
    if (isSwitchObstacle(obstacle)) continue;

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

    // A door, one-way gate, blinking block or breakable wall is drawn by
    // `paintSiteMechanics` (which knows its live state), so it is tagged here and
    // skipped by `paintWalls` rather than drawn as a plain wall.
    const siteTag = siteTagByObstacle.get(obstacleIndex);

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
        siteKind: siteTag?.siteKind,
        siteIndex: siteTag?.siteIndex,
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
        siteKind: siteTag?.siteKind,
        siteIndex: siteTag?.siteIndex,
      });
    }
  }
  return {
    walls,
    zones,
    portals,
    forceFields,
    gripZones: gripZones.length > 0 ? gripZones : undefined,
    triggers,
    movingBlocks: levelMotions(data),
    doors,
    switches,
    gates,
    blinks,
    breakables,
  };
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
    .filter((o) => !isNonEngineObstacle(o))
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
/** True for a site-only grip zone (a high-friction surface the engine cannot express). */
export function isGripZone(o: {
  obstacle_type?: string;
  field_type?: string;
  zone_type?: string;
}): boolean {
  return o.obstacle_type === "grip";
}

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
 * True for a site-only switch sensor. A switch is a polygon the arrow enters;
 * it is never an engine obstacle (the engine would collide with it), so it is
 * stripped from the payload exactly like a force field.
 */
export function isSwitchObstacle(o: { switch_action?: string }): boolean {
  return o.switch_action === "toggle" || o.switch_action === "on" || o.switch_action === "off";
}

/**
 * True for a site-only door: a wall whose solidity is driven by the switch that
 * shares its `switch_group`. A switch obstacle also carries a `switch_group`, so
 * the switch check is excluded here to keep the two disjoint.
 */
export function isDoorObstacle(o: { switch_group?: string; switch_action?: string }): boolean {
  return typeof o.switch_group === "string" && o.switch_group.length > 0 && !isSwitchObstacle(o);
}

/** True for a site-only one-way gate (a blocked-face normal is present). */
export function isOneWayGate(o: { gate_normal?: { x?: number; y?: number } | null }): boolean {
  return (
    o.gate_normal != null &&
    isFiniteNum(o.gate_normal.x) &&
    isFiniteNum(o.gate_normal.y) &&
    (o.gate_normal.x !== 0 || o.gate_normal.y !== 0)
  );
}

/** True for a site-only blinking (timed) block. */
export function isBlinkBlock(o: { blink_period?: number }): boolean {
  return isFiniteNum(o.blink_period) && o.blink_period > 0;
}

/** True for a site-only breakable wall. */
export function isBreakableWall(o: { breakable?: boolean }): boolean {
  return o.breakable === true;
}

/**
 * True for an obstacle the simulation layer handles itself, so it must never be
 * handed to the engine as-is: force fields, accelerator wires (a one-shot
 * trigger, not a wall) and switch sensors. Everything else — including doors,
 * one-way gates, blinking blocks and breakables, which are real walls in some
 * states — does reach the engine.
 */
export function isNonEngineObstacle(o: {
  field_type?: string;
  zone_type?: string;
  portal_id?: string;
  wall_type?: string;
  obstacle_type?: string;
  accelerator_speed?: number;
  accelerator_accel?: number;
  switch_action?: string;
}): boolean {
  return isForceField(o) || isGripZone(o) || isAcceleratorTrigger(o) || isSwitchObstacle(o);
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

/**
 * Whether a blinking block is solid at `tick`. A pure function of the tick, so
 * the sim, the live render and the offline export all agree without carrying any
 * state: solid for the first `duty` fraction of each period, then passable.
 */
export function blinkSolidAt(
  blink: { period: number; duty: number; phase: number },
  tick: number,
): boolean {
  const { period, duty, phase } = blink;
  if (!isFiniteNum(period) || period <= 0) return true;
  const t = (((tick + phase) % period) + period) % period;
  return t / period < duty;
}

/**
 * Whether a one-way gate is solid for an arrow at (x, y). `nx`/`ny` points from
 * the blocked side toward the passable side, so a negative projection means the
 * arrow is on the blocked side and the gate is a wall; otherwise it is passable.
 * Pure, so the renderer reproduces the sim's decision without extra state.
 */
export function gateSolidAt(
  gate: { ax: number; ay: number; nx: number; ny: number },
  x: number,
  y: number,
): boolean {
  return (x - gate.ax) * gate.nx + (y - gate.ay) * gate.ny < 0;
}

/**
 * The site-only events a run produced, recorded by the sim so the renderer can
 * reproduce a door's open state or a broken wall at any tick without re-running
 * the physics. Gates and blinks are pure functions of position/tick, so they are
 * not recorded here.
 */
export interface SiteTimeline {
  /** Each time a switch fired, in tick order, with the group's resulting state. */
  switchFires: Array<{ tick: number; group: string; open: boolean }>;
  /** Each breakable wall that broke, with the tick the arrow touched it. */
  brokenAt: Array<{ engineIndex: number; tick: number }>;
}

/** True when a level uses any site-only mechanic the renderer must animate. */
export function hasSiteMechanics(geometry: SimGeometry): boolean {
  return (
    (geometry.doors?.length ?? 0) > 0 ||
    (geometry.switches?.length ?? 0) > 0 ||
    (geometry.gates?.length ?? 0) > 0 ||
    (geometry.blinks?.length ?? 0) > 0 ||
    (geometry.breakables?.length ?? 0) > 0
  );
}

/** A door group's open state at `tick`, given the run's switch-fire timeline. */
export function doorOpenAt(
  timeline: SiteTimeline | undefined,
  group: string,
  startOpen: boolean,
  tick: number,
): boolean {
  let open = startOpen;
  for (const f of timeline?.switchFires ?? []) {
    if (f.tick > tick) break;
    if (f.group === group) open = f.open;
  }
  return open;
}

/** Whether a breakable wall has broken by `tick`, given the run's timeline. */
export function isBrokenAt(
  timeline: SiteTimeline | undefined,
  engineIndex: number,
  tick: number,
): boolean {
  return (timeline?.brokenAt ?? []).some((b) => b.engineIndex === engineIndex && b.tick <= tick);
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
export interface EnginePlayerState {
  player: {
    translation: { x: number; y: number };
    rotation: number;
    state?: string;
    /** Engine's current thrust level (0..1); drives the flame length. */
    thrust_power?: number;
    /** Velocity in world units/tick; force fields add to this per tick. */
    velocity?: { x: number; y: number; r?: number };
    /** The player's physics constants; a grip zone scales two of them. */
    constants?: Record<string, number>;
  };
  /** The engine's live obstacle list, with rotations already applied. */
  map?: ApiMap;
  /** Per-tick effects (wall contact, thrust) the shaders are driven from. */
  effects?: ApiEffects;
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
   * Reset to the spawn without the full-map `read` the return value would cost.
   * The optimizer restores a checkpoint per candidate and never uses the pose,
   * so this is the reset its inner loop wants.
   */
  resetQuiet(): void;
  /**
   * Rebuild the engine from a snapshot without returning the pose. The cheap
   * counterpart of {@link restore} for the optimizer's per-candidate restore.
   */
  restoreQuiet(snapshot: string): void;
  /**
   * Parse the engine's current full state into a sample, without stepping.
   * `step`/`stepCode` already advanced, so a caller that only needs the pose at
   * the render rate reads it once here instead of paying the full-state JSON
   * parse on every 240Hz tick.
   */
  read(): SimPoint;
  /**
   * The arrow's position and velocity, read cheaply from the head of the state
   * string rather than a full-map `JSON.parse`. The optimizer's innermost loop
   * calls this once per sampled tick, so it must stay a handful of `indexOf`
   * scans; on a long level the full parse would dominate the search.
   */
  pose(): { x: number; y: number; vx: number; vy: number };
  /**
   * The engine's current full state, including the live obstacle list (with
   * rotations applied) and this tick's effects. The WebGL renderer needs those
   * two — it draws the map the physics actually used, so rotating walls and
   * portals animate — where `read` only carries the pose.
   */
  readFull(): EnginePlayerState;
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
  /**
   * The site-only events the run has produced so far (switch fires, broken
   * walls). Levels with no such mechanic return empty arrays. The renderer reads
   * this after a run so a door's open state or a broken wall can be drawn at any
   * tick without re-running the physics.
   */
  timeline(): SiteTimeline;
  /** Release the underlying WASM object. */
  free(): void;
}

/**
 * The snapshot format for a level that carries site-only run state. It wraps the
 * raw engine state so a checkpoint taken mid-run restores a door's open flag, a
 * broken wall and the switch-fire timeline along with the physics; a level with
 * none of those keeps the bare engine state.
 */
interface SnapshotEnvelope {
  engine?: unknown;
  wire?: WireState;
  doorOpen?: Array<[string, boolean]>;
  broken?: number[];
  timeline?: SiteTimeline;
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
  // The arrow's own constants, captured once so a grip zone scales from a fixed
  // baseline rather than compounding on its own last write.
  const stockConstants = {
    ...base.player.constants,
    ...arrowConstants(arrowName),
  } as typeof base.player.constants;
  const player = {
    ...base.player,
    constants: { ...stockConstants },
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

  // The player block serializes first, so the optimizer's innermost loop can
  // scan the head of the state string instead of parsing the whole map. On a
  // long level the copy out of wasm dominates, and this reads ~1KB of it. Falls
  // back to the full parse if a field is missing, so a shape change degrades to
  // correct-and-slow rather than silently reading garbage.
  const HEAD_BYTES = 2048;
  const numAt = (s: string, key: string, from: number): [number, number] => {
    const i = s.indexOf(key, from);
    if (i < 0) return [NaN, from];
    return [parseFloat(s.slice(i + key.length, i + key.length + 32)), i + key.length];
  };
  const pose = (
    engine: InstanceType<EngineModule["GameMechanicsEngine"]>,
  ): { x: number; y: number; vx: number; vy: number } => {
    const head = engine.head(HEAD_BYTES);
    let o = head.indexOf('"translation"');
    if (o < 0) {
      const p = read(engine);
      return { x: p.x, y: p.y, vx: 0, vy: 0 };
    }
    const [x, ox] = numAt(head, '"x":', o);
    const [y, oy] = numAt(head, '"y":', ox);
    o = head.indexOf('"velocity"', oy);
    const [vx, ovx] = numAt(head, '"x":', o);
    const [vy] = numAt(head, '"y":', ovx);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const p = read(engine);
      return { x: p.x, y: p.y, vx: 0, vy: 0 };
    }
    return { x, y, vx: Number.isFinite(vx) ? vx : 0, vy: Number.isFinite(vy) ? vy : 0 };
  };

  // Wind/suction fields are not part of the engine, so they are applied here as
  // a per-tick velocity delta: step, then add the field's force to the arrow's
  // velocity and rebuild the engine from that state. The rebuild is ~25x the
  // cost of a raw step, so it is skipped entirely on levels with no fields and
  // whenever the arrow is outside every field.
  // One geometry pass serves every site-only mechanic, so the authored→engine
  // index mapping is computed once and the renderer and sim cannot disagree.
  const geom = levelGeometry(data);
  const fields = geom.forceFields ?? [];
  const hasFields = fields.length > 0;
  const grips = geom.gripZones ?? [];
  const hasGrips = grips.length > 0;
  const triggers = geom.triggers ?? [];
  const hasTriggers = triggers.length > 0;

  // Moving blocks are the same story on the geometry side: the engine can spin
  // an obstacle but not slide one, so each tick we rebuild the engine from its
  // own state with the block's points offset by the animation curve. A block is
  // authored as a plain wall, so its base points are known from the level and
  // the offset is a pure function of the tick — which also keeps `snapshot`
  // clean (see below).
  const allObstacles = data.obstacles ?? [];
  // Engine obstacle index for each authored index; force fields, wires and
  // switch sensors are stripped before the engine sees the list, so the two
  // indices diverge when one of them precedes a wall.
  const engineIndexOf: number[] = [];
  let engineCount = 0;
  for (const o of allObstacles) {
    if (isNonEngineObstacle(o)) {
      engineIndexOf.push(-1);
    } else {
      engineIndexOf.push(engineCount);
      engineCount++;
    }
  }
  const engineObstacleList = engineObstacles(data);
  const basePointsOf = (engineIndex: number): Array<{ x: number; y: number }> =>
    (engineObstacleList[engineIndex]?.points ?? []) as Array<{ x: number; y: number }>;
  const motions = levelMotions(data)
    .map((m) => {
      const engineIndex = engineIndexOf[m.obstacleIndex] ?? -1;
      const base = basePointsOf(engineIndex);
      return { ...m, engineIndex, base };
    })
    .filter((m) => m.engineIndex >= 0 && m.base.length > 0);
  const hasMotions = motions.length > 0;

  // Switch/door, one-way gate, blink and breakable state. A door's open flag and
  // a breakable's broken flag are run state (a switch flips them), so they ride
  // in the snapshot envelope; a blink is a pure function of the tick, so it does
  // not. The door/breakable base points are read from the engine list, not the
  // level, so they are already in engine coordinates.
  const doors = (geom.doors ?? []).map((d) => ({ ...d, base: basePointsOf(d.engineIndex) }));
  const switches = geom.switches ?? [];
  const gates = (geom.gates ?? []).map((g) => ({ ...g, base: basePointsOf(g.engineIndex) }));
  const blinks = (geom.blinks ?? []).map((b) => ({ ...b, base: basePointsOf(b.engineIndex) }));
  const breakables = (geom.breakables ?? []).map((b) => ({
    ...b,
    base: basePointsOf(b.engineIndex),
  }));
  const hasDoors = doors.length > 0;
  const hasSwitches = switches.length > 0;
  const hasGates = gates.length > 0;
  const hasBlinks = blinks.length > 0;
  const hasBreakables = breakables.length > 0;
  const hasSiteState =
    hasDoors || hasSwitches || hasGates || hasBlinks || hasBreakables || hasTriggers;
  const hasPointRewrites = hasDoors || hasGates || hasBlinks || hasBreakables;

  /**
   * Move a wall far off-map so the engine no longer collides with it. The engine
   * collides with a zero-length segment too (a single-point obstacle is a dot
   * with the wall's thickness), so "passable" has to mean "elsewhere", not
   * "degenerate". The obstacle entry stays in place, so every index mapping is
   * unchanged.
   */
  const OFF_MAP = 1_000_000;
  const collapsed = (_pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => [
    { x: OFF_MAP, y: OFF_MAP },
  ];

  // Run state carried in the snapshot envelope (see `snapshot`/`restore`).
  const doorOpen = new Map<string, boolean>();
  const broken = new Set<number>();
  // A switch is one-shot per run (a sensor re-entering it must not re-flip a
  // toggle), so the groups already fired are remembered too.
  const firedSwitches = new Set<string>();
  // The site-only events a run produced, so the renderer can reproduce a door's
  // open state or a broken wall at any tick without re-running the physics.
  const timeline: SiteTimeline = { switchFires: [], brokenAt: [] };

  let engine: InstanceType<EngineModule["GameMechanicsEngine"]>;
  try {
    engine = new mod.GameMechanicsEngine(state());
  } catch {
    return null;
  }

  /**
   * Rewrite every site-only obstacle's points for the current tick in a single
   * engine rebuild: moving blocks (translated by the animation curve), doors
   * (collapsed while open), blinking blocks (collapsed while "off"), one-way
   * gates (collapsed while the arrow is on the passable side) and breakables
   * (collapsed once touched). Base points are always used as the source, so
   * offsets never compound across ticks. A level with none of these returns
   * immediately, so the ~25x rebuild cost is never paid on a plain level.
   */
  const applyGeometry = (tick: number): void => {
    if (!hasMotions && !hasPointRewrites) return;
    const s = JSON.parse(engine.state) as EnginePlayerState & {
      map?: { obstacles?: Array<{ points?: Array<{ x: number; y: number }> }> };
    };
    const obs = s.map?.obstacles;
    if (!obs) return;
    let changed = false;
    const setPoints = (engineIndex: number, pts: Array<{ x: number; y: number }>): void => {
      const o = obs[engineIndex];
      if (!o) return;
      o.points = pts.map((p) => ({ x: p.x, y: p.y }));
      changed = true;
    };
    for (const m of motions) {
      const off = motionOffsetAt(m.dx, m.dy, m.period, tick);
      setPoints(
        m.engineIndex,
        m.base.map((p) => ({ x: p.x + off.x, y: p.y + off.y })),
      );
    }
    for (const d of doors) {
      const open = doorOpen.get(d.group) ?? d.startOpen;
      setPoints(d.engineIndex, open ? collapsed(d.base) : d.base);
    }
    for (const b of blinks) {
      setPoints(b.engineIndex, blinkSolidAt(b, tick) ? b.base : collapsed(b.base));
    }
    for (const g of gates) {
      const px = s.player.translation.x;
      const py = s.player.translation.y;
      // `gate_normal` points from the blocked side toward the passable side, so
      // an arrow with a negative dot is on the blocked side and meets a wall.
      const side = (px - g.ax) * g.nx + (py - g.ay) * g.ny;
      setPoints(g.engineIndex, side < 0 ? g.base : collapsed(g.base));
    }
    for (const b of breakables) {
      setPoints(b.engineIndex, broken.has(b.engineIndex) ? collapsed(b.base) : b.base);
    }
    if (!changed) return;
    engine.free();
    engine = new mod.GameMechanicsEngine(s as never);
  };

  /**
   * Fire any switch the arrow has just entered (segment test against the
   * previous tick, so a fast arrow cannot tunnel past a thin sensor) and break
   * any breakable wall the engine reports a contact with. Both mutate run state
   * that `applyGeometry` then reads, so this runs first each tick.
   */
  const applyTriggers = (prevX: number, prevY: number, tick: number): void => {
    if (hasSwitches) {
      const s = JSON.parse(engine.state) as EnginePlayerState;
      const px = s.player.translation.x;
      const py = s.player.translation.y;
      for (const sw of switches) {
        if (firedSwitches.has(sw.group)) continue;
        if (!pointInPolygon(px, py, sw.points)) continue;
        if (pointInPolygon(prevX, prevY, sw.points)) continue;
        firedSwitches.add(sw.group);
        const prev = doorOpen.get(sw.group) ?? true;
        const open = sw.action === "on" ? true : sw.action === "off" ? false : !prev;
        doorOpen.set(sw.group, open);
        timeline.switchFires.push({ tick, group: sw.group, open });
      }
    }
    if (hasBreakables) {
      const s = JSON.parse(engine.state) as EnginePlayerState & {
        effects?: { wall_contact_effects?: Array<{ obstacle_index?: number }> };
      };
      const contacts = s.effects?.wall_contact_effects ?? [];
      for (const c of contacts) {
        if (c.obstacle_index == null) continue;
        if (!breakables.some((b) => b.engineIndex === c.obstacle_index)) continue;
        if (broken.has(c.obstacle_index)) continue;
        broken.add(c.obstacle_index);
        timeline.brokenAt.push({ engineIndex: c.obstacle_index, tick });
      }
    }
  };

  /** Restore the per-run site state to its authored start (spawn / reset). */
  const resetSiteState = (): void => {
    doorOpen.clear();
    for (const d of doors) {
      if (!doorOpen.has(d.group)) doorOpen.set(d.group, d.startOpen);
    }
    broken.clear();
    firedSwitches.clear();
    timeline.switchFires = [];
    timeline.brokenAt = [];
    wire = { armed: false, dirX: 0, dirY: 0, targetSpeed: 0, accel: 0 };
  };

  /**
   * The grip multipliers of every zone the arrow is currently inside. Zones do
   * not stack additively — the strongest wins on each axis — so an overlap is
   * predictable rather than compounding into a spin.
   */
  const gripAt = (x: number, y: number): { multiplier: number; traction: number } => {
    let multiplier = 1;
    let traction = 1;
    for (const g of grips) {
      if (!pointInPolygon(x, y, g.points)) continue;
      if (g.multiplier > multiplier) multiplier = g.multiplier;
      if (g.traction > traction) traction = g.traction;
    }
    return { multiplier, traction };
  };

  /**
   * Apply the grip zone at the arrow's current pose. The engine has no grip
   * zone, so this rebuilds it with the player's `turning_speed` and
   * `traction_power` scaled — the same continuous-rebuild trick as the force
   * fields. Only two constants change, so the pose is unaffected at the swap.
   */
  const applyGrip = (): void => {
    const s = JSON.parse(engine.state) as EnginePlayerState;
    const { multiplier, traction } = gripAt(s.player.translation.x, s.player.translation.y);
    const want = {
      turning_speed: (stockConstants.turning_speed ?? 0) * multiplier,
      traction_power: (stockConstants.traction_power ?? 0) * traction,
    };
    const cur = s.player.constants ?? stockConstants;
    // Compare against the desired values rather than tracking "inside" in a
    // flag: a restored checkpoint carries whatever constants it was saved with,
    // so the current state is the only reliable source of truth.
    if (cur.turning_speed === want.turning_speed && cur.traction_power === want.traction_power) {
      return;
    }
    s.player.constants = { ...cur, ...want };
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

  /**
   * The pose before a step, but only when a mechanic actually needs it. Reading
   * the pose is `JSON.parse(engine.state)` — a parse of the whole level, which
   * costs about 0.002ms per obstacle (3ms on the endless course's ~1600 walls)
   * and dwarfs the physics step itself. Endless has no switch/breakable/wire, so
   * paying it every tick was ~99% of the frame. Read lazily, at most once.
   */
  const needsPrevPose = hasSwitches || hasBreakables || hasTriggers;

  // Restore the run state that rides alongside the engine state in a snapshot
  // envelope: the armed wire, door open flags, broken walls and event timeline.
  const applyEnvelope = (parsed: SnapshotEnvelope): void => {
    wire = parsed.wire ?? { armed: false, dirX: 0, dirY: 0, targetSpeed: 0, accel: 0 };
    doorOpen.clear();
    for (const [group, open] of parsed.doorOpen ?? []) doorOpen.set(group, open);
    broken.clear();
    for (const idx of parsed.broken ?? []) broken.add(idx);
    timeline.switchFires = parsed.timeline?.switchFires ?? [];
    timeline.brokenAt = parsed.timeline?.brokenAt ?? [];
    firedSwitches.clear();
    for (const f of timeline.switchFires) firedSwitches.add(f.group);
  };

  return {
    step(symbol) {
      const before = needsPrevPose ? read(engine) : null;
      engine.process_ticks([symbolToInput(symbol)]);
      if (engine.player_state_code() === 0) {
        if (before && (hasSwitches || hasBreakables))
          applyTriggers(before.x, before.y, engine.get_ticks());
        if (hasMotions || hasPointRewrites) applyGeometry(engine.get_ticks());
        if (hasFields) applyFields();
        if (hasGrips) applyGrip();
        if (hasTriggers && before) {
          armWire(before.x, before.y);
          applyWire(symbol);
        }
      }
      return read(engine);
    },
    stepCode(symbol) {
      const before = needsPrevPose ? read(engine) : null;
      engine.process_ticks([symbolToInput(symbol)]);
      const code = engine.player_state_code();
      if (code === 0) {
        if (before && (hasSwitches || hasBreakables))
          applyTriggers(before.x, before.y, engine.get_ticks());
        if (hasMotions || hasPointRewrites) applyGeometry(engine.get_ticks());
        if (hasFields) applyFields();
        if (hasGrips) applyGrip();
        if (hasTriggers && before) {
          armWire(before.x, before.y);
          applyWire(symbol);
        }
      }
      return code;
    },
    reset() {
      engine.free();
      engine = new mod.GameMechanicsEngine(state());
      resetSiteState();
      if (hasMotions || hasPointRewrites) applyGeometry(0);
      return read(engine);
    },
    // The optimizer restores a checkpoint on every candidate and never uses the
    // returned pose, so the full-map `read` there is pure waste. These skip it.
    resetQuiet() {
      engine.free();
      engine = new mod.GameMechanicsEngine(state());
      resetSiteState();
      if (hasMotions || hasPointRewrites) applyGeometry(0);
    },
    restoreQuiet(snapshot) {
      const parsed = JSON.parse(snapshot) as SnapshotEnvelope;
      const engineState = parsed.engine !== undefined ? parsed.engine : parsed;
      engine.free();
      engine = mod.GameMechanicsEngine.from_state(engineState as never);
      applyEnvelope(parsed);
    },
    read() {
      return read(engine);
    },
    pose() {
      return pose(engine);
    },
    readFull() {
      return JSON.parse(engine.state) as EnginePlayerState;
    },
    code() {
      return engine.player_state_code();
    },
    snapshot() {
      // Levels without any site-only run state keep the raw engine state (cheap,
      // and the format every existing checkpoint already uses). A level with a
      // wire, door or breakable wraps it so that state travels with the
      // checkpoint — without it a re-simulated tail would diverge from the run.
      if (!hasSiteState && !hasBreakables) return engine.state;
      const envelope: SnapshotEnvelope = {
        engine: JSON.parse(engine.state),
        ...(hasTriggers ? { wire } : {}),
        ...(hasDoors ? { doorOpen: [...doorOpen] } : {}),
        ...(hasBreakables ? { broken: [...broken] } : {}),
        ...(hasSiteState ? { timeline } : {}),
      };
      return JSON.stringify(envelope);
    },
    restore(snapshot) {
      const parsed = JSON.parse(snapshot) as SnapshotEnvelope;
      const engineState = parsed.engine !== undefined ? parsed.engine : parsed;
      engine.free();
      engine = mod.GameMechanicsEngine.from_state(engineState as never);
      applyEnvelope(parsed);
      return read(engine);
    },
    timeline() {
      return { switchFires: [...timeline.switchFires], brokenAt: [...timeline.brokenAt] };
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

  const timeline = replay.timeline();
  replay.free();
  return { path, finishTick, bounds, timeline };
}
