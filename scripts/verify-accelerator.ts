/**
 * Verify the accelerator wire against the REAL site sim (createReplayEngine):
 * crossing arms a charge, the charge thrusts along the wire's normal, the boost
 * is controllable (braking and off-axis spins starve it, the target speed is a
 * soft fade not a hard cap), and the armed charge survives snapshot/restore —
 * including a checkpoint taken *before* the wire, which the editor and
 * brute-forcer both re-simulate through.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine, levelGeometry, type RawLevelData } from "@/lib/replay-sim";
import {
  DEFAULT_ACCELERATOR_ACCEL,
  DEFAULT_ACCELERATOR_SPEED,
  defaultObstacle,
  nalvlToRawLevelData,
  nalvlToGameData,
  rawLevelDataToNalvl,
} from "@/lib/nalvl";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const CORRIDOR: RawLevelData["obstacles"] = [
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: -200, y: 200 },
      { x: -200, y: -40000 },
    ],
  },
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: 200, y: 200 },
      { x: 200, y: -40000 },
    ],
  },
];

/** An open corridor; `wire` (if given) sits across it. */
function level(wire?: { y: number; targetSpeed: number; accel: number }): RawLevelData {
  return {
    map_name: "acctest",
    game_mode: "speedrun",
    obstacles: [
      ...CORRIDOR,
      ...(wire
        ? [
            {
              obstacle_type: "wall",
              wall_type: "normal",
              points: [
                { x: -200, y: wire.y },
                { x: 200, y: wire.y },
              ],
              accelerator_speed: wire.targetSpeed,
              accelerator_accel: wire.accel,
            },
          ]
        : []),
    ] as RawLevelData["obstacles"],
  };
}

/** Fly `ticks` ticks, choosing the input symbol per tick via `symAt`. Returns the
 *  per-tick path (index 0 is the spawn pose). */
async function flyPattern(data: RawLevelData, ticks: number, symAt: (i: number) => number) {
  const engine = await createReplayEngine(data, "narrow");
  if (!engine) throw new Error("engine failed to initialise");
  engine.reset();
  const path: Array<{ x: number; y: number }> = [{ x: engine.read().x, y: engine.read().y }];
  for (let i = 0; i < ticks; i++) {
    const p = engine.step(symAt(i));
    path.push({ x: p.x, y: p.y });
  }
  engine.free();
  return path;
}

/** Fly straight (coast), optionally holding one steer from `steerFrom` on. */
const fly = (data: RawLevelData, ticks: number, steerFrom = Infinity, steer = 0) =>
  flyPattern(data, ticks, (i) => (i >= steerFrom ? steer : 0));

/** Speed between two consecutive path samples, in world units/tick. */
const speedAt = (path: Array<{ x: number; y: number }>, i: number) =>
  i <= 0 ? 0 : Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);

const TICKS = 1400;
const WIRE_Y = -150;
const ACCEL = 0.05;
// The arrow reaches the wire around tick 500 at roughly 0.4 units/tick, so these
// targets bracket its speed: a huge target keeps feeding with a full-strength
// push, while a small one fades out almost immediately (a soft speed ceiling).
const NEVER = 1000;
const GATE_LOW = 0.5;
const GATE_HIGH = 2.0;

const baseline = await fly(level(), TICKS);
const crossTick = baseline.findIndex((p) => p.y <= WIRE_Y);
const baseY = baseline[TICKS].y;
console.log(`baseline crosses y=${WIRE_Y} at tick ${crossTick}, ends at y=${baseY.toFixed(1)}`);

const armed = await fly(level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL }), TICKS);
const gatedLow = await fly(level({ y: WIRE_Y, targetSpeed: GATE_LOW, accel: ACCEL }), TICKS);
const gatedHigh = await fly(level({ y: WIRE_Y, targetSpeed: GATE_HIGH, accel: ACCEL }), TICKS);
console.log(
  `final y — baseline ${baseY.toFixed(1)}, armed ${armed[TICKS].y.toFixed(1)}, ` +
    `gated@${GATE_LOW} ${gatedLow[TICKS].y.toFixed(1)}, gated@${GATE_HIGH} ${gatedHigh[TICKS].y.toFixed(1)}`,
);

// --- Crossing arms a real, persistent thrust. -------------------------------
check("the baseline actually crosses the wire", crossTick > 0, `tick ${crossTick}`);
check(
  "crossing the wire accelerates the arrow",
  armed[TICKS].y < baseY - 50,
  `${(baseY - armed[TICKS].y).toFixed(1)} units further`,
);

// --- The target speed is a soft ceiling, not a hard stop. -------------------
check(
  "a lower target speed throttles the charge sooner",
  gatedLow[TICKS].y > gatedHigh[TICKS].y,
  `gated@${GATE_LOW} ${gatedLow[TICKS].y.toFixed(1)} > gated@${GATE_HIGH} ${gatedHigh[TICKS].y.toFixed(1)}`,
);
check("the full-strength charge outruns the throttled one", armed[TICKS].y < gatedHigh[TICKS].y);
check("a throttled charge still beats no wire", gatedHigh[TICKS].y < baseY);

// --- A wire never crossed does nothing. -------------------------------------
const untouched = await fly(level({ y: -100000, targetSpeed: NEVER, accel: ACCEL }), TICKS);
check("an uncrossed wire is inert", Math.abs(untouched[TICKS].y - baseY) < 1e-9);

// --- The boost is controllable: braking, turning and spinning starve it. ----
const END = TICKS;
const wireLevel = level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL });
const after = crossTick + 40;
const braked = await flyPattern(wireLevel, END, (i) => (i >= after ? 3 : 0));
const spun = await flyPattern(wireLevel, END, (i) => (i >= after ? 1 : 0)); // hold a steer: a spin
const zig = await flyPattern(wireLevel, END, (i) =>
  i >= after ? (Math.floor((i - after) / 15) % 2 ? 1 : 2) : 0,
);
check(
  "holding the brake after the wire kills the boost",
  speedAt(braked, END) < speedAt(armed, END) - 0.1,
  `braked ${speedAt(braked, END).toFixed(3)} vs armed ${speedAt(armed, END).toFixed(3)}`,
);
check(
  "spinning off-axis after the wire bleeds the speed",
  speedAt(spun, END) < speedAt(armed, END) - 0.1,
  `spun ${speedAt(spun, END).toFixed(3)} vs armed ${speedAt(armed, END).toFixed(3)}`,
);
check(
  "zig-zagging after the wire bleeds the speed",
  speedAt(zig, END) < speedAt(armed, END) - 0.1,
  `zig ${speedAt(zig, END).toFixed(3)} vs armed ${speedAt(armed, END).toFixed(3)}`,
);

// --- Geometry exposes the wire and never lets the engine see it. ------------
const geom = levelGeometry(level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL }));
check("geometry exposes one trigger", (geom.triggers?.length ?? 0) === 1);
check(
  "the wire is not drawn as a wall",
  !geom.walls.some((w) => Math.abs(w.ay - WIRE_Y) < 1e-6 && Math.abs(w.by - WIRE_Y) < 1e-6),
);

// --- Snapshot/restore carries the armed charge, from before AND after. ------
async function snapshotFidelity(cutAt: number): Promise<boolean> {
  const data = level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL });
  const engine = await createReplayEngine(data, "narrow");
  const restored = await createReplayEngine(data, "narrow");
  if (!engine || !restored) throw new Error("engine failed");
  engine.reset();
  for (let i = 0; i < cutAt; i++) engine.step(0);
  restored.restore(engine.snapshot());
  for (let i = cutAt; i < TICKS; i++) {
    const a = engine.step(0);
    const b = restored.step(0);
    if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) {
      engine.free();
      restored.free();
      return false;
    }
  }
  engine.free();
  restored.free();
  return true;
}

// Cut before the wire is crossed (the case a closure-only flag would break) and
// after (the charge is already armed).
check("restore from a checkpoint BEFORE the wire matches", await snapshotFidelity(crossTick - 50));
check("restore from a checkpoint AFTER the wire matches", await snapshotFidelity(crossTick + 100));

// --- The thrust direction is the wire's normal, oriented by the crossing. ---
// Steer hard after crossing but stay roughly on-axis: the charge must keep
// thrusting along -y, so the run still beats the same line with no wire.
const steerAt = crossTick + 30;
const steered = await fly(
  level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL }),
  TICKS,
  steerAt,
  2,
);
const steeredBase = await fly(level(), TICKS, steerAt, 2);
check(
  "the thrust follows the wire's normal while on-axis",
  steered[TICKS].y < steeredBase[TICKS].y - 50,
  `${(steeredBase[TICKS].y - steered[TICKS].y).toFixed(1)} units further after steering`,
);

// The wire exposes a unit normal perpendicular to its segment (the thrust axis);
// the sim orients it along the crossing velocity.
const wireGeom = levelGeometry(level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL }));
const trig = wireGeom.triggers?.[0];
const segX = trig ? trig.bx - trig.ax : 0;
const segY = trig ? trig.by - trig.ay : 0;
const perp = trig ? Math.abs(segX * trig.dirX + segY * trig.dirY) : 1;
check(
  "the wire's thrust axis is its unit normal",
  !!trig &&
    Math.abs(Math.hypot(trig.dirX, trig.dirY) - 1) < 1e-9 &&
    perp < 1e-9 &&
    Math.abs(trig.dirY) > 0.99,
  `normal (${trig?.dirX.toFixed(3)}, ${trig?.dirY.toFixed(3)})`,
);

// --- Authoring round-trip: nalvl ↔ raw, and stripped from the game export. --
const authored = {
  format: "nalvl" as const,
  formatVersion: 1,
  name: "wire test",
  gameMode: "speedrun",
  obstacles: [
    {
      id: "w1",
      kind: "wall" as const,
      points: [
        { x: -200, y: 0 },
        { x: -200, y: -3000 },
      ],
      wallType: "normal" as const,
      thickness: 8,
    },
    {
      id: "t1",
      kind: "accelerator" as const,
      points: [
        { x: -200, y: -150 },
        { x: 200, y: -150 },
      ],
      acceleratorSpeed: 2.5,
      acceleratorAccel: 0.07,
    },
    {
      id: "w2",
      kind: "wall" as const,
      points: [
        { x: 200, y: 0 },
        { x: 200, y: -3000 },
      ],
      wallType: "normal" as const,
      thickness: 8,
    },
  ],
};
const raw = nalvlToRawLevelData(authored);
const back = rawLevelDataToNalvl(raw);
const roundTrip = back.obstacles.find((o) => o.kind === "accelerator");
check(
  "the wire survives nalvl → raw → nalvl",
  roundTrip?.acceleratorSpeed === 2.5 && roundTrip?.acceleratorAccel === 0.07,
);
check("the wire keeps its endpoints", roundTrip?.points[1]?.y === -150);

const exported = nalvlToGameData(authored);
check(
  "the wire is stripped from the game export",
  !exported.obstacles.some(
    (o) => (o as { accelerator_speed?: number }).accelerator_speed != null,
  ) && exported.obstacles.length === 2,
);

// The moving-block engine index must not be thrown off by a wire sitting before
// a mover: a wire is not an engine obstacle, so it must be skipped like a field.
const withMover = nalvlToRawLevelData({
  ...authored,
  obstacles: [
    {
      id: "t1",
      kind: "accelerator",
      points: [
        { x: -200, y: -150 },
        { x: 200, y: -150 },
      ],
      acceleratorSpeed: 2.5,
      acceleratorAccel: 0.07,
    },
    {
      id: "m1",
      kind: "wall",
      points: [
        { x: -60, y: -400 },
        { x: 60, y: -400 },
      ],
      wallType: "normal",
      thickness: 8,
      motionDx: 0,
      motionDy: -260,
      motionPeriod: 600,
    },
  ],
});
const moverGeom = levelGeometry(withMover);
check(
  "a wire before a mover does not shift the mover's engine index",
  (moverGeom.movingBlocks?.length ?? 0) === 1 && (moverGeom.triggers?.length ?? 0) === 1,
);

// The editor's "accelerator" tool builds a wire with `defaultObstacle`, then the
// author's target-speed/push settings. Confirm those defaults are a live wire
// (a non-positive speed would make the trigger inert) and survive a save/load.
const editorWire = {
  ...defaultObstacle("accelerator", [
    { x: -200, y: -150 },
    { x: 200, y: -150 },
  ]),
  acceleratorSpeed: DEFAULT_ACCELERATOR_SPEED,
  acceleratorAccel: DEFAULT_ACCELERATOR_ACCEL,
};
const authoredWithEditorWire = {
  ...authored,
  obstacles: [...authored.obstacles, editorWire],
};
check(
  "the editor's default wire is armed",
  editorWire.kind === "accelerator" &&
    editorWire.acceleratorSpeed === DEFAULT_ACCELERATOR_SPEED &&
    DEFAULT_ACCELERATOR_SPEED > 0,
  `speed ${DEFAULT_ACCELERATOR_SPEED}, push ${DEFAULT_ACCELERATOR_ACCEL}`,
);
const editorWireBack = rawLevelDataToNalvl(
  nalvlToRawLevelData(authoredWithEditorWire),
).obstacles.find(
  (o) => o.kind === "accelerator" && o.acceleratorSpeed === DEFAULT_ACCELERATOR_SPEED,
);
check(
  "an editor-created wire round-trips through the site level format",
  editorWireBack?.acceleratorSpeed === DEFAULT_ACCELERATOR_SPEED &&
    editorWireBack?.acceleratorAccel === DEFAULT_ACCELERATOR_ACCEL,
);
check(
  "the editor's default wire simulates as an accelerator",
  (levelGeometry(nalvlToRawLevelData(authoredWithEditorWire)).triggers?.length ?? 0) === 2,
);

console.log(failures === 0 ? "\nall accelerator checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
