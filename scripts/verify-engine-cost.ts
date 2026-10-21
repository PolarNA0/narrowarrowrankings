/**
 * The engine's per-tick cost must not scale with the *level's* obstacle count.
 *
 * `stepCode` used to read the pose before every step, and reading the pose is
 * `JSON.parse(engine.state)` — a parse of the whole map. On the endless course
 * (~1600 walls) that was ~3ms a tick, ~99% of the frame, and it grew with the
 * course length, which is why endless got laggier the more of it was built.
 * The read is now taken only when a mechanic that needs the *previous* pose is
 * present (a switch, a breakable, or an accelerator wire); endless has none.
 *
 * This drives the real engine and asserts a *many-obstacle* level costs about
 * the same per tick as a small one, and that the total frame is well inside a
 * 60fps budget. It also proves the read still happens when a mechanic needs it —
 * a switch level must still fire, which `verify-site-mechanics` covers too, but
 * a lazy read that never fires would silently break doors.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { PlayGame } from "@/lib/play-game";
import { createReplayEngine, type RawLevelData } from "@/lib/replay-sim";
import { buildEndlessCourse } from "@/lib/endless";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail === undefined ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const TICKS = 800;

/** ms per tick for a raw engine over `data`, stepping with no input. */
async function perTick(data: RawLevelData): Promise<number> {
  const eng = await createReplayEngine(data, "Narrow Arrow");
  if (!eng) throw new Error("no engine");
  for (let i = 0; i < 100; i++) eng.stepCode(0); // warm
  const t = performance.now();
  for (let i = 0; i < TICKS; i++) eng.stepCode(0);
  const ms = (performance.now() - t) / TICKS;
  eng.free();
  return ms;
}

// A long endless course: this is the shape that used to be slow and got slower.
const long = buildEndlessCourse({ seed: 12345, sections: 400 });
// A tenth of the length, as a small-level baseline.
const short = buildEndlessCourse({ seed: 12345, sections: 40 });
check(
  "fixture: the long course really has far more obstacles",
  long.data.obstacles.length > short.data.obstacles.length * 5,
  `${short.data.obstacles.length} vs ${long.data.obstacles.length}`,
);

const shortTick = await perTick(short.data);
const longTick = await perTick(long.data);
console.log(
  `     obstacles=${short.data.obstacles.length} ${shortTick.toFixed(4)}ms/tick  |  ` +
    `obstacles=${long.data.obstacles.length} ${longTick.toFixed(4)}ms/tick`,
);

// The regression: a longer level must not cost meaningfully more per tick. The
// old code scaled linearly (0.0094ms per obstacle), so 10x the obstacles meant
// ~10x the tick.
check(
  "a long course does not cost more than ~2x a short one per tick",
  longTick < shortTick * 2 + 0.01,
  `${longTick.toFixed(4)}ms vs ${shortTick.toFixed(4)}ms`,
);
check(
  "the per-tick cost is a small fraction of a 60fps frame",
  longTick < 0.3,
  `${longTick.toFixed(4)}ms/tick -> ${(longTick * 4).toFixed(2)}ms for a 4-tick frame`,
);

// The whole frame, through the real game loop the views drive.
const game = new PlayGame({ data: long.data, arrowName: "Narrow Arrow", sampleInput: () => 0 });
if (!(await game.load())) throw new Error("no engine");
game.restart();
const FRAMES = 300;
const t0 = performance.now();
for (let i = 0; i < FRAMES; i++) game.advance(1000 / 60);
const perFrame = (performance.now() - t0) / FRAMES;
check(
  "a frame on the long course fits the 60fps budget",
  perFrame < 16.7,
  `${perFrame.toFixed(2)}ms/frame`,
);
game.free();

// A mechanic that *does* need the previous pose must still read it. A switch on
// the spawn-to-barrier line proves the lazy read is not skipped when required.
// The fixture mirrors `verify-site-mechanics`: a 120-wide barrier at y=-80 with
// side walls at ±200, a switch box between the spawn and the barrier, and a door
// on the barrier that starts shut.
const barrier = {
  obstacle_type: "wall",
  wall_type: "normal",
  wall_thickness: 8,
  points: [
    { x: -60, y: -80 },
    { x: 60, y: -80 },
  ],
};
const sideWalls = [
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: 200, y: 200 },
      { x: 200, y: -2000 },
    ],
  },
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: -200, y: 200 },
      { x: -200, y: -2000 },
    ],
  },
];
const switchBox = {
  obstacle_type: "wall",
  wall_thickness: 8,
  points: [
    { x: -80, y: -5 },
    { x: 80, y: -5 },
    { x: 80, y: -40 },
    { x: -80, y: -40 },
  ],
  switch_group: "g",
  switch_action: "on",
};
const door = { ...barrier, switch_group: "g", door_start_open: false };
const withSwitch: RawLevelData = {
  map_name: "switch-cost",
  game_mode: "speedrun",
  obstacles: [door, ...sideWalls, switchBox] as RawLevelData["obstacles"],
};
const eng = await createReplayEngine(withSwitch, "Narrow Arrow");
if (!eng) throw new Error("no engine");
eng.reset();
let y = eng.read().y;
for (let i = 0; i < 1200; i++) {
  eng.stepCode(0);
  y = eng.read().y;
}
check(
  "switch: the door opened, so the arrow passed the barrier",
  y < -120,
  `end y=${y.toFixed(1)} (barrier at -80)`,
);
check(
  "switch: the fire is in the timeline",
  eng.timeline().switchFires.length === 1,
  JSON.stringify(eng.timeline().switchFires),
);
eng.free();

console.log(`\n${failures === 0 ? "all" : `${failures} failing`} engine-cost checks`);
process.exit(failures === 0 ? 0 : 1);
