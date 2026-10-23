/**
 * Play's countdown and playback-speed controls are integrity features, so they
 * must hold against the real engine, not a mock:
 *
 *  - the 3-2-1 countdown must freeze the run (tick stays 0) and then release it;
 *  - a rate of N× must advance the sim N times as fast for the same wall time,
 *    and a fractional rate must not drift;
 *  - the input stream a run records must be *identical* at 1× and at any other
 *    rate, so a slow run can be replayed exactly (the rate only changes how fast
 *    it is stepped, not what is recorded) — this is what makes a 0.1× run a
 *    usable trace and also what makes it a *different* run from the 1× one;
 *  - the board gate (`isRealTime` / `result.realTime`) must be true only when the
 *    run never left 1×, so switching back to 1× before finishing cannot launder a
 *    slow run.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import {
  PlayGame,
  PLAY_SPEEDS,
  COUNTDOWN_MS,
  countdownDigit,
  stepTicks,
  type PlayResult,
} from "@/lib/play-game";
import { SIM_TICK_MS, type RawLevelData } from "@/lib/replay-sim";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** A straight corridor, so a coasting run survives long enough to measure. */
const level: RawLevelData = {
  map_name: "speedtest",
  game_mode: "speedrun",
  obstacles: [
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: -400, y: 400 },
        { x: -400, y: -200000 },
      ],
    },
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: 400, y: 400 },
        { x: 400, y: -200000 },
      ],
    },
  ] as RawLevelData["obstacles"],
};

function makeGame(speed = 1, input: () => number = () => 0) {
  const game = new PlayGame({
    data: level,
    arrowName: "Narrow Arrow",
    sampleInput: input,
    onEnd: (r) => lastResults.push(r),
  });
  game.setSpeed(speed);
  return game;
}
const lastResults: PlayResult[] = [];

// ---- the pure helpers ------------------------------------------------------

check("countdownDigit counts 3,2,1,0", [3000, 2999, 2001, 2000, 1001, 1000, 1, 0].map(countdownDigit).join(",") === "3,3,3,2,2,1,1,0");
check(
  "stepTicks at 1x is unchanged",
  (() => {
    const a = stepTicks(1000 / 60, 0, 1);
    const b = stepTicks(1000 / 60, 0);
    return a.ticks === b.ticks && a.remainder === b.remainder;
  })(),
  `1/60s -> ${stepTicks(1000 / 60, 0, 1).ticks} ticks`,
);
check("stepTicks scales with speed", stepTicks(100, 0, 2).ticks === 2 * stepTicks(100, 0, 1).ticks);
check("stepTicks caps the burst at high speed", stepTicks(100000, 0, 10).ticks === 400);
check("PLAY_SPEEDS spans 0.1x-10x", PLAY_SPEEDS[0] === 0.1 && PLAY_SPEEDS[PLAY_SPEEDS.length - 1] === 10);

// ---- the countdown freezes the run, then releases it -----------------------

{
  const game = makeGame(1);
  if (!(await game.load())) throw new Error("no engine");
  game.restart();
  check("restart arms the countdown", game.phase === "countdown" && game.countdownMs === COUNTDOWN_MS);

  // Feed ~2s of frames; the run must not have advanced at all.
  let wall = 0;
  while (wall < COUNTDOWN_MS - 200) {
    game.advance(1000 / 60);
    wall += 1000 / 60;
  }
  check("countdown freezes the tick", game.tick === 0, `tick=${game.tick} after ${Math.round(wall)}ms`);
  check("countdown reports a digit", game.countdown === 1 || game.countdown === 2, `digit=${game.countdown}`);

  // Cross the boundary.
  game.advance(400);
  check("countdown releases into running", game.phase === "running" && game.countdown === 0);
  check("run advances once released", game.advance(100) > 0);
  game.free();
}

// ---- a rate of Nx advances N times as fast ---------------------------------

async function runForWallMs(speed: number, wallMs: number) {
  const game = makeGame(speed);
  if (!(await game.load())) throw new Error("no engine");
  game.restart();
  game.advance(COUNTDOWN_MS + 50); // drain the countdown (wall-clock, speed-independent)
  let elapsed = 0;
  while (elapsed < wallMs) {
    game.advance(1000 / 240);
    elapsed += 1000 / 240;
  }
  const ticks = game.tick;
  const symbols = game.recordedSymbols.length;
  const realTime = game.isRealTime;
  game.free();
  return { ticks, symbols, realTime };
}

{
  const wallMs = 500;
  const at1 = await runForWallMs(1, wallMs);
  const at2 = await runForWallMs(2, wallMs);
  const atHalf = await runForWallMs(0.5, wallMs);
  const at10 = await runForWallMs(10, wallMs);
  const ratio2 = at2.ticks / at1.ticks;
  const ratioHalf = atHalf.ticks / at1.ticks;
  console.log(
    `  ..   1x=${at1.ticks} 2x=${at2.ticks} 0.5x=${atHalf.ticks} 10x=${at10.ticks} ticks over ${wallMs}ms`,
  );
  check("2x runs ~twice as many ticks", Math.abs(ratio2 - 2) < 0.15, `ratio=${ratio2.toFixed(3)}`);
  check("0.5x runs ~half as many ticks", Math.abs(ratioHalf - 0.5) < 0.1, `ratio=${ratioHalf.toFixed(3)}`);
  check("10x is faster than 2x", at10.ticks > at2.ticks);
  check("every rate records one symbol per tick", at2.symbols === at2.ticks && at1.symbols === at1.ticks);
}

// ---- the board gate: only a run that stayed at 1x is board-eligible --------

{
  check("1x run is real-time", (await runForWallMs(1, 200)).realTime === true);
  check("2x run is not real-time", (await runForWallMs(2, 200)).realTime === false);
  check("0.1x run is not real-time", (await runForWallMs(0.1, 200)).realTime === false);

  // The laundering case: slow down, then switch back to 1x before the end.
  const game = makeGame(1);
  if (!(await game.load())) throw new Error("no engine");
  game.restart();
  game.advance(COUNTDOWN_MS + 50);
  game.setSpeed(0.25);
  for (let i = 0; i < 60; i++) game.advance(1000 / 240);
  game.setSpeed(1);
  for (let i = 0; i < 60; i++) game.advance(1000 / 240);
  check("switching back to 1x does not launder the run", game.isRealTime === false);
  check("speed reads 1x again", game.speed === 1);

  // A fresh restart clears the latch (it is a new run).
  game.restart();
  check("restart clears the latch", game.isRealTime === true);
  game.free();
}

// ---- the recorded run is identical at any rate -----------------------------

{
  // A deterministic input stream (a fixed press pattern) so both runs are
  // reproducible; the *recorded* symbols must match at 1x and at 4x.
  const pattern = (i: number) => (Math.floor(i / 40) % 2 === 0 ? 1 : 0);
  async function record(speed: number, wallMs: number) {
    let i = 0;
    const game = makeGame(speed, () => pattern(i++));
    if (!(await game.load())) throw new Error("no engine");
    game.restart();
    game.advance(COUNTDOWN_MS + 50);
    let elapsed = 0;
    while (elapsed < wallMs) {
      game.advance(1000 / 240);
      elapsed += 1000 / 240;
    }
    const out = game.recordedSymbols.slice();
    game.free();
    return out;
  }
  // Compare the first 200 symbols, which both runs definitely recorded.
  const a = (await record(1, 1000)).slice(0, 200);
  const b = (await record(4, 1000)).slice(0, 200);
  check(
    "recorded inputs match across rates",
    a.length === 200 && b.length === 200 && a.every((s, k) => s === b[k]),
    `${a.length} vs ${b.length} symbols`,
  );
}

console.log(
  failures === 0
    ? "\nall play-speed checks passed"
    : `\n${failures} play-speed check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
