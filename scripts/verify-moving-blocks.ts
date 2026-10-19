/**
 * Verify moving blocks against the REAL site sim (createReplayEngine), not a
 * reimplementation: a block that slides into the arrow's path must block it,
 * a static block must not, and snapshot/restore must not double-apply.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine, levelGeometry, type RawLevelData } from "@/lib/replay-sim";
import {
  nalvlToRawLevelData,
  nalvlToGameData,
  rawLevelDataToNalvl,
  type NalvlLevel,
} from "@/lib/nalvl";
import { gameLevelId } from "@/lib/nalvl";

// The bundled engine fetches its wasm relative to import.meta.url, which Node
// cannot do. Pre-initialise it synchronously from the file on disk; the module
// caches the instance, so createReplayEngine's own init is a no-op.
initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

function level(motion: boolean): RawLevelData {
  return {
    map_name: "mvtest",
    game_mode: "speedrun",
    obstacles: [
      // gate wall the arrow flies into
      {
        obstacle_type: "wall",
        wall_type: "normal",
        wall_thickness: 8,
        points: [
          { x: -60, y: -80 },
          { x: 60, y: -80 },
        ],
        ...(motion ? { motion_dx: 0, motion_dy: -260, motion_period: 600 } : {}),
      },
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
    ] as RawLevelData["obstacles"],
  };
}

async function run(data: RawLevelData, n: number) {
  const engine = await createReplayEngine(data, "narrow");
  if (!engine) throw new Error("engine failed");
  engine.reset();
  let last = engine.read();
  for (let i = 0; i < n; i++) last = engine.step(0);
  const code = engine.code();
  const geom = levelGeometry(data);
  engine.free();
  return { x: last.x, y: last.y, code, motions: geom.movingBlocks?.length ?? 0 };
}

const still = await run(level(false), 600);
const moving = await run(level(true), 600);
console.log("static:", still);
console.log("moving:", moving);
console.log("=>", still.y !== moving.y ? "motion CHANGES the real sim" : "NO EFFECT (bug)");
console.log("geometry exposes", moving.motions, "moving block(s)");

// snapshot/restore must not double-apply: step 300, snapshot, restore, step 300
const engine = await createReplayEngine(level(true), "narrow");
if (!engine) throw new Error("engine failed");
engine.reset();
for (let i = 0; i < 300; i++) engine.step(0);
const snap = engine.snapshot();
engine.restore(snap);
for (let i = 0; i < 300; i++) engine.step(0);
const viaRestore = engine.read();
engine.free();

const straight = await run(level(true), 600);
const d = Math.hypot(viaRestore.x - straight.x, viaRestore.y - straight.y);
console.log(
  `restore path end=(${viaRestore.x.toFixed(1)},${viaRestore.y.toFixed(1)}) vs straight end=(${straight.x.toFixed(1)},${straight.y.toFixed(1)}) delta=${d.toFixed(3)}`,
);
console.log("=>", d < 0.5 ? "snapshot/restore is consistent" : "SNAPSHOT DOUBLE-APPLIES (bug)");

// --- nalvl round-trip + game-export stripping ---
const authored: NalvlLevel = {
  format: "nalvl",
  formatVersion: 1,
  name: "mvr",
  gameMode: "speedrun",
  obstacles: [
    {
      id: "a",
      kind: "wall",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: -60, y: -80 },
        { x: 60, y: -80 },
      ],
      motionDx: 0,
      motionDy: -260,
      motionPeriod: 600,
    },
    {
      id: "b",
      kind: "wall",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: 200, y: 200 },
        { x: 200, y: -2000 },
      ],
    },
    {
      id: "c",
      kind: "wind",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fieldStrength: 0.05,
    },
  ],
};
const raw = nalvlToRawLevelData(authored);
const first = raw.obstacles?.[0] as {
  motion_dx?: number;
  motion_dy?: number;
  motion_period?: number;
};
console.log(
  "\n[nalvl] raw obstacle 0 motion:",
  first.motion_dx,
  first.motion_dy,
  first.motion_period,
);
const game = nalvlToGameData(authored);
const anyMotion = game.obstacles.some(
  (o) => (o as { motion_period?: number }).motion_period != null,
);
console.log("[nalvl] game export carries motion:", anyMotion, "(must be false)");

const back = rawLevelDataToNalvl(raw, "mvr");
const backWall = back.obstacles.find((o) => o.kind === "wall" && o.motionPeriod != null);
console.log(
  "[nalvl] round-trip motion:",
  backWall?.motionDx,
  backWall?.motionDy,
  backWall?.motionPeriod,
);
console.log("[nalvl] round-trip obstacles:", back.obstacles.map((o) => o.kind).join(","));

const geom2 = levelGeometry(nalvlToRawLevelData(back));
console.log("[nalvl] re-lowered moving blocks:", geom2.movingBlocks?.length, "(must be 1)");

// --- render-index mapping: statics interleaved with movers ---
const mapped = levelGeometry({
  map_name: "map",
  obstacles: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
    {
      points: [
        { x: 0, y: 100 },
        { x: 10, y: 100 },
      ],
      motion_dy: 50,
      motion_period: 100,
    },
    {
      points: [
        { x: 0, y: 200 },
        { x: 10, y: 200 },
      ],
    },
    {
      points: [
        { x: 0, y: 300 },
        { x: 10, y: 300 },
      ],
      motion_dx: -40,
      motion_period: 100,
    },
  ],
});
const movingWalls = mapped.walls.filter((w) => w.motion != null && w.motion >= 0);
const ok =
  movingWalls.length === 2 &&
  mapped.movingBlocks?.length === 2 &&
  movingWalls.every((w) => mapped.movingBlocks![w.motion!] != null) &&
  mapped.movingBlocks![movingWalls[0].motion!].dy === 50 &&
  mapped.movingBlocks![movingWalls[1].motion!].dx === -40;
console.log(
  "[map] walls→movingBlocks mapping:",
  ok ? "OK" : "BROKEN",
  JSON.stringify(movingWalls.map((w) => w.motion)),
);
