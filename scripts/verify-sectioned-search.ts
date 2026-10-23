/**
 * The sectioned optimizer must only ever report a run that actually replays.
 *
 * It searches one section at a time against a gate at the section's end, then
 * stitches the per-section winners and reports the stitched finish tick. The
 * whole feature is worthless — and worse, dishonest — if that stitched line does
 * not finish at the tick it claims, or if the search "improves" by breaking the
 * run. This drives the real engine and asserts:
 *
 *  * the reported run replays to exactly the reported tick,
 *  * the result is never worse than the seed,
 *  * `inputCount` matches the symbol count (so the base64 round-trips),
 *  * a deliberately slowed seed is actually improved (the search does work),
 *  * the section boundaries stay inside the run and rotate round over round.
 *
 * It also pins the fast pose read (`engine.pose`) against the full-state parse,
 * because the sectioned search's inner loop depends on it being exact.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine, type RawLevelData } from "@/lib/replay-sim";
import { optimizeSectioned, sectionBoundaries } from "@/lib/tas-sectioned";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** A straight corridor with a finish wall: an unimprovable-but-finishable floor. */
const CORRIDOR: RawLevelData = {
  map_name: "corridor",
  game_mode: "speedrun",
  obstacles: [
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: -320, y: 40 },
        { x: 320, y: 40 },
      ],
    },
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: -200, y: 40 },
        { x: -200, y: -4000 },
      ],
    },
    {
      obstacle_type: "wall",
      wall_type: "normal",
      wall_thickness: 8,
      points: [
        { x: 200, y: 40 },
        { x: 200, y: -4000 },
      ],
    },
    {
      obstacle_type: "wall",
      wall_type: "finish",
      wall_thickness: 8,
      points: [
        { x: -200, y: -3000 },
        { x: 200, y: -3000 },
      ],
    },
  ],
};

/** Replay `syms` from the spawn; return the finish tick or null. */
async function replayFinish(data: RawLevelData, syms: number[]): Promise<number | null> {
  const eng = await createReplayEngine(data, "Narrow Arrow");
  if (!eng) return null;
  eng.reset();
  for (let i = 0; i < syms.length; i++) {
    const c = eng.stepCode(syms[i]);
    if (c === 1) {
      eng.free();
      return i + 1;
    }
    if (c === 2) {
      eng.free();
      return null;
    }
  }
  eng.free();
  return null;
}

async function main() {
  // ---- sectionBoundaries stays inside the run and rotates -------------------
  {
    const b0 = sectionBoundaries(2264, "auto", 0);
    const b1 = sectionBoundaries(2264, "auto", 1);
    check(
      "boundaries: all inside (60, ticks-60)",
      b0.every((b) => b > 60 && b < 2264 - 60),
    );
    check(
      "boundaries: strictly increasing",
      b0.every((b, i) => i === 0 || b > b0[i - 1]),
    );
    check(
      "boundaries: rotation moves them",
      JSON.stringify(b0) !== JSON.stringify(b1),
      `${b0.slice(0, 3)} vs ${b1.slice(0, 3)}`,
    );
    check("boundaries: short run still splits", sectionBoundaries(600, "auto", 0).length >= 1);
  }

  // ---- the fast pose read is exact ------------------------------------------
  {
    const eng = await createReplayEngine(CORRIDOR, "Narrow Arrow");
    if (!eng) throw new Error("no engine");
    let maxErr = 0;
    let velMismatch = 0;
    for (let i = 0; i < 300; i++) {
      eng.stepCode(i % 4);
      const r = eng.read();
      const p = eng.pose();
      maxErr = Math.max(maxErr, Math.abs(r.x - p.x), Math.abs(r.y - p.y));
      const full = JSON.parse(eng.snapshot()) as {
        player: { velocity: { x: number; y: number } };
      };
      if (
        Math.abs(full.player.velocity.x - p.vx) > 1e-9 ||
        Math.abs(full.player.velocity.y - p.vy) > 1e-9
      )
        velMismatch++;
    }
    check("pose(): matches the full parse on position", maxErr === 0, `maxErr=${maxErr}`);
    check(
      "pose(): matches the full parse on velocity",
      velMismatch === 0,
      `${velMismatch} mismatches`,
    );
    eng.free();
  }

  // ---- a slowed seed is improved, and the result replays --------------------
  {
    // No input finishes the corridor at tick 2264. Sprinkling brake taps in makes
    // it slower, so the search has real work to do and a known optimum to reach.
    const seed = Array(3200).fill(0);
    for (let t = 300; t < 3200; t += 137)
      for (let k = 0; k < 8 && t + k < 3200; k++) seed[t + k] = 3;
    const seedFinish = await replayFinish(CORRIDOR, seed);
    check("fixture: the slowed seed finishes", seedFinish !== null, `seed=${seedFinish}`);

    for (const rng of [1, 7, 99]) {
      const r = await optimizeSectioned({
        seedSymbols: seed,
        levelData: CORRIDOR,
        arrowName: "Narrow Arrow",
        budgetMs: 6000,
        rngSeed: rng,
      });
      if (!r) {
        check(`rng=${rng}: produced a result`, false);
        continue;
      }
      const replayed = await replayFinish(CORRIDOR, r.symbols);
      check(
        `rng=${rng}: reported ${r.bestFinishTick} replays identically`,
        replayed === r.bestFinishTick,
        `replayed=${replayed}`,
      );
      check(
        `rng=${rng}: never worse than the seed`,
        (r.bestFinishTick ?? Infinity) <= (r.seedFinishTick ?? Infinity),
        `${r.bestFinishTick} vs ${r.seedFinishTick}`,
      );
      check(
        `rng=${rng}: inputCount matches symbols`,
        r.inputCount === r.symbols.length,
        `${r.inputCount} vs ${r.symbols.length}`,
      );
      check(
        `rng=${rng}: improved the slowed seed`,
        r.improved && (r.bestFinishTick ?? Infinity) < (seedFinish ?? Infinity),
        `${seedFinish} -> ${r.bestFinishTick}`,
      );
    }
  }

  console.log(failures === 0 ? "\nall sectioned-search checks passed" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
