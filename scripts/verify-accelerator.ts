/**
 * Verify the accelerator wire against the REAL site sim (createReplayEngine):
 * crossing arms a charge, the charge pushes along the captured direction until
 * the target speed, and the armed flag survives snapshot/restore — including a
 * checkpoint taken *before* the wire, which the editor and brute-forcer both
 * re-simulate through.
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

/** Fly straight (coast) for `ticks`, returning the path. */
async function fly(data: RawLevelData, ticks: number, steerFrom = Infinity, steer = 0) {
  const engine = await createReplayEngine(data, "narrow");
  if (!engine) throw new Error("engine failed to initialise");
  engine.reset();
  const path: Array<{ x: number; y: number }> = [{ x: engine.read().x, y: engine.read().y }];
  for (let i = 0; i < ticks; i++) {
    const p = engine.step(i >= steerFrom ? steer : 0);
    path.push({ x: p.x, y: p.y });
  }
  engine.free();
  return path;
}

const TICKS = 1400;
const WIRE_Y = -150;
const ACCEL = 0.05;
// The arrow reaches the wire around tick 500 at roughly 0.4 units/tick, so these
// targets bracket its speed: NEVER never disarms, 0.5 disarms just past the
// wire, 2.0 keeps feeding for a long tail.
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

// --- Crossing arms a real, persistent push. ---------------------------------
check("the baseline actually crosses the wire", crossTick > 0, `tick ${crossTick}`);
check(
  "crossing the wire accelerates the arrow",
  armed[TICKS].y < baseY - 50,
  `${(baseY - armed[TICKS].y).toFixed(1)} units further`,
);

// --- The charge is speed-gated: a lower target disarms sooner. --------------
check(
  "a lower target speed stops the charge sooner",
  gatedLow[TICKS].y > gatedHigh[TICKS].y,
  `gated@${GATE_LOW} ${gatedLow[TICKS].y.toFixed(1)} > gated@${GATE_HIGH} ${gatedHigh[TICKS].y.toFixed(1)}`,
);
check("the never-disarming charge outruns the gated one", armed[TICKS].y < gatedHigh[TICKS].y);
check("a gated charge still beats no wire", gatedHigh[TICKS].y < baseY);

// --- A wire never crossed does nothing. -------------------------------------
const untouched = await fly(level({ y: -100000, targetSpeed: NEVER, accel: ACCEL }), TICKS);
check("an uncrossed wire is inert", Math.abs(untouched[TICKS].y - baseY) < 1e-9);

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

// --- Direction is captured at the crossing, then fixed. ---------------------
// Steer hard away from the wire's line after crossing: the push must keep adding
// along the original -y direction even though the heading no longer points down.
const steerAt = crossTick + 30;
const steered = await fly(
  level({ y: WIRE_Y, targetSpeed: NEVER, accel: ACCEL }),
  TICKS,
  steerAt,
  2,
);
const steeredBase = await fly(level(), TICKS, steerAt, 2);
check(
  "the push follows the captured direction, not the current heading",
  steered[TICKS].y < steeredBase[TICKS].y - 50,
  `${(steeredBase[TICKS].y - steered[TICKS].y).toFixed(1)} units further after steering`,
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
