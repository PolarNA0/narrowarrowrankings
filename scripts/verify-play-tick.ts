/**
 * The Play tab renders per-tick geometry (spinning obstacles, moving blocks)
 * from a tick. `path` is sampled once per *rendered frame* while the physics
 * runs at a fixed 240Hz, so `path.length - 1` is the frame count, not the tick.
 * Drawing a spinner from it lags the hitbox by the tick-per-frame ratio.
 *
 * This drives the real PlayGame loop at a throttled frame rate and asserts the
 * true tick is exposed (pathTicks / currentTick) and agrees with the engine,
 * and that the old frame-derived tick would be badly wrong.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { PlayGame } from "@/lib/play-game";
import { createReplayEngine, SIM_TICK_MS, type RawLevelData } from "@/lib/replay-sim";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

const ROTATION_SPEED = 0.05; // rad/tick

const level: RawLevelData = {
  map_name: "spintest",
  game_mode: "speedrun",
  obstacles: [
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: 40, y: -30 },
        { x: 90, y: -30 },
      ],
      rotation_pivot: { x: 60, y: -30 },
      rotation_speed: ROTATION_SPEED,
    },
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: 300, y: 400 },
        { x: 300, y: -4000 },
      ],
    },
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: -300, y: 400 },
        { x: -300, y: -4000 },
      ],
    },
  ] as RawLevelData["obstacles"],
};

const game = new PlayGame({ data: level, arrowName: "Narrow Arrow", sampleInput: () => 0 });
if (!(await game.load())) throw new Error("no engine");
game.restart();

// Throttle to ~30fps: each frame runs ~8 physics ticks but pushes one point.
const FRAME_MS = 1000 / 30;
const FRAMES = 60;
for (let i = 0; i < FRAMES; i++) game.advance(FRAME_MS);

const trueTick = game.currentTick;
const frameTick = game.path.length - 1;
const stampsOk =
  game.pathTicks.length === game.path.length &&
  game.pathTicks[game.pathTicks.length - 1] === trueTick;

console.log(`\n[play] frames=${FRAMES} trueTick=${trueTick} frameTick(path.length-1)=${frameTick}`);
console.log(`[play] pathTicks aligned to true tick: ${stampsOk ? "OK" : "BROKEN"}`);
console.log(
  `[play] path is frame-sampled: ${frameTick < trueTick ? "YES (bug window)" : "no"} — ${(trueTick / Math.max(1, frameTick)).toFixed(2)} ticks/frame`,
);

// The engine's own obstacle rotation at the true tick, and the angle the
// renderer would draw if it used the frame count instead.
const eng = await createReplayEngine(level, "Narrow Arrow");
if (!eng) throw new Error("no probe engine");
for (let t = 0; t < trueTick; t++) eng.step(0);
const state = JSON.parse(eng.snapshot()) as {
  map: { obstacles: Array<{ points: Array<{ x: number; y: number }> }> };
};
const engAngle = Math.atan2(
  state.map.obstacles[0].points[0].y - -30,
  state.map.obstacles[0].points[0].x - 60,
);
// The renderer rotates the base points by `rotationSpeed * tick`; the engine
// bakes the same rotation in, so compare the angle each predicts.
const baseAngle = Math.atan2(-30 - -30, 40 - 60); // = π
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const trueErr = angDiff(engAngle, baseAngle + ROTATION_SPEED * trueTick);
const frameErr = angDiff(engAngle, baseAngle + ROTATION_SPEED * frameTick);
console.log(`[play] engine angle=${engAngle.toFixed(3)} rad`);
console.log(
  `[play] draw w/ true tick err=${trueErr.toFixed(4)} rad -> ${trueErr < 1e-3 ? "MATCHES hitbox" : "MISMATCH"}`,
);
console.log(
  `[play] draw w/ frame tick err=${frameErr.toFixed(4)} rad (${((frameErr * 180) / Math.PI).toFixed(1)}°) -> ${frameErr > 0.1 ? "LAGS hitbox (the bug)" : "ok"}`,
);
eng.free();

// Rewind must trim frame samples by their tick stamp, not by index.
game.setCheckpoint();
const cpTick = game.currentTick;
for (let i = 0; i < 10; i++) game.advance(FRAME_MS);
game.restartFromCheckpoint();
const rewoundOk =
  game.currentTick === cpTick &&
  game.pathTicks.length === game.path.length &&
  game.pathTicks[game.pathTicks.length - 1] === cpTick &&
  game.pathTicks.every((t) => t <= cpTick);
console.log(
  `\n[play] rewind to tick ${cpTick}: ${rewoundOk ? "OK" : "BROKEN"} (last stamp ${game.pathTicks[game.pathTicks.length - 1]})`,
);
