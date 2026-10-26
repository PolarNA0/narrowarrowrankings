/**
 * Verify the site-only grip zone against the REAL sim (createReplayEngine),
 * not a reimplementation:
 *   - a zone the arrow never enters is a byte-identical no-op
 *   - multiplier 1 is a true no-op (the arrow's own physics)
 *   - inside the zone the arrow turns monotonically tighter with the multiplier
 *   - leaving the zone restores the arrow's stock turn rate
 *   - a grip zone never reaches the engine as an obstacle
 *   - snapshot/restore reproduces a grip tick (the brute-forcer re-simulates
 *     from checkpoints, so a constant swapped outside the snapshot would make
 *     a re-simulated tail diverge from the live run)
 *
 * The multiplier -> turn-rate response is NOT linear: the engine's angular
 * dynamics feed back into the velocity, so 2x on turning_speed buys roughly 3x
 * the accumulated rotation. The assertions test monotonicity and the no-op
 * cases rather than a ratio the physics does not promise.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { ARROW_CONSTANTS, createReplayEngine, levelGeometry, type RawLevelData } from "@/lib/replay-sim";
import {
  defaultObstacle,
  nalvlToRawLevelData,
  rawLevelDataToNalvl,
  NALVL_SITE_ONLY_KINDS,
  type NalvlLevel,
} from "@/lib/nalvl";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

const WALLS = [
  { obstacle_type: "wall", wall_type: "normal", wall_thickness: 8, points: [{ x: 900, y: 900 }, { x: 900, y: -6000 }] },
  { obstacle_type: "wall", wall_type: "normal", wall_thickness: 8, points: [{ x: -900, y: 900 }, { x: -900, y: -6000 }] },
];

/** A box spanning the corridor, from `yTop` down to `yBot`. */
const box = (yTop: number, yBot: number) => [
  { x: -800, y: yTop },
  { x: 800, y: yTop },
  { x: 800, y: yBot },
  { x: -800, y: yBot },
];

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

function level(zone: { points: ReturnType<typeof box>; m: number } | null): RawLevelData {
  return {
    map_name: "griptest",
    game_mode: "speedrun",
    obstacles: [
      ...WALLS,
      ...(zone
        ? [{ obstacle_type: "grip", points: zone.points, grip_multiplier: zone.m, grip_traction: 1 }]
        : []),
    ],
  } as RawLevelData;
}

/** Drive a run and return its per-tick rotation deltas plus the final pose. */
async function run(lvl: RawLevelData, ticks: number, symbol: 0 | 1 = 1) {
  const eng = await createReplayEngine(lvl, "Narrow Arrow");
  if (!eng) throw new Error("no engine");
  eng.reset();
  const deltas: number[] = [];
  let p = eng.read();
  let prev = p.rot;
  for (let i = 0; i < ticks; i++) {
    p = eng.step(symbol);
    deltas.push(p.rot - prev);
    prev = p.rot;
  }
  return { deltas, rot: p.rot, x: p.x, y: p.y };
}

// --- 1. A zone the arrow never enters is a no-op -----------------------------
{
  // The zone sits far down the corridor, so a 240-tick run from the spawn never
  // reaches it and the trajectory must match no zone at all.
  const far = await run(level({ points: box(-5000, -6000), m: 4 }), 240);
  const none = await run(level(null), 240);
  const same = far.deltas.every((d, i) => d === none.deltas[i]) && far.rot === none.rot;
  check(same, "a grip zone the arrow never enters changes nothing", `rot ${far.rot.toFixed(6)} vs ${none.rot.toFixed(6)}`);
}

// --- 2. Multiplier 1 is the arrow's own physics ------------------------------
{
  const one = await run(level({ points: box(500, -800), m: 1 }), 240);
  const none = await run(level(null), 240);
  const same = one.deltas.every((d, i) => d === none.deltas[i]);
  check(same, "multiplier 1 is a byte-identical no-op (stock physics)", `rot ${one.rot.toFixed(6)} vs ${none.rot.toFixed(6)}`);
}

// --- 3. Tighter turning, monotonic in the multiplier ------------------------
{
  const stock = await run(level(null), 240);
  const m2 = await run(level({ points: box(500, -800), m: 2 }), 240);
  const m4 = await run(level({ points: box(500, -800), m: 4 }), 240);
  console.log(
    `heading after 240 ticks: stock ${stock.rot.toFixed(3)} | x2 ${m2.rot.toFixed(3)} | x4 ${m4.rot.toFixed(3)}`,
  );
  check(m2.rot > stock.rot * 1.5, "grip x2 turns far tighter than stock", `${stock.rot.toFixed(3)} -> ${m2.rot.toFixed(3)}`);
  check(m4.rot > m2.rot, "grip x4 turns tighter still than x2", `${m2.rot.toFixed(3)} -> ${m4.rot.toFixed(3)}`);
}

// --- 4. Entering and leaving the zone swaps the constant exactly ------------
{
  // Read `turning_speed` straight out of the engine state rather than inferring
  // it from the trajectory. Coast straight through a shallow band: the arrow
  // starts inside it and flies out the far side, so one run covers both the
  // swap and the restore.
  const stockTs = ARROW_CONSTANTS.narrow.turning_speed;
  const eng = await createReplayEngine(level({ points: box(40, -40), m: 4 }), "Narrow Arrow");
  eng!.reset();
  const tsOf = () => {
    const s = JSON.parse(eng!.snapshot());
    return (s.engine ?? s).player.constants.turning_speed;
  };
  // Grip is applied during a step, so sample after the first tick rather than
  // from the pre-step state (which still holds the arrow's own constants).
  eng!.step(0);
  const insideTs = tsOf();
  let leftAt = -1;
  for (let i = 2; i <= 320; i++) {
    eng!.step(0);
    if (leftAt < 0 && Math.abs(eng!.read().y) > 40) leftAt = i;
  }
  const outsideTs = tsOf();
  check(insideTs === stockTs * 4, "inside the zone turning_speed is scaled by the multiplier", `${insideTs} vs ${stockTs * 4}`);
  check(leftAt > 0, "the arrow left the band during the run", `left at tick ${leftAt}`);
  check(outsideTs === stockTs, "leaving the zone restores turning_speed exactly", `${outsideTs} vs ${stockTs}`);
}

// --- 5. A grip zone never reaches the engine --------------------------------
{
  const geom = levelGeometry(level({ points: box(500, -800), m: 2 }));
  check((geom.gripZones?.length ?? 0) === 1, "levelGeometry exposes the grip zone", `n=${geom.gripZones?.length}`);
  check((geom.zones ?? []).length === 0, "the grip zone is not emitted as an engine zone");
  check(!(geom.walls ?? []).some((w) => String(w.type) === "grip"), "the grip zone is not emitted as a wall");
}

// --- 6. Snapshot/restore preserves grip behaviour ---------------------------
{
  const eng = await createReplayEngine(level({ points: box(500, -800), m: 3 }), "Narrow Arrow");
  eng!.reset();
  for (let i = 0; i < 40; i++) eng!.step(1);
  const snap = eng!.snapshot();
  const live = eng!.step(1).rot;
  eng!.restore(snap);
  const restored = eng!.step(1).rot;
  check(
    Math.abs(live - restored) < 1e-9,
    "a restored checkpoint re-simulates the grip tick identically",
    `live ${live.toFixed(6)} vs restored ${restored.toFixed(6)}`,
  );
}

// --- 7. Round-trip through the site level format ----------------------------
{
  const lvl: NalvlLevel = {
    format: "nalvl",
    formatVersion: 1,
    name: "grip round trip",
    gameMode: "speedrun",
    obstacles: [defaultObstacle("grip", box(500, -800))],
  };
  check(NALVL_SITE_ONLY_KINDS.includes("grip"), "grip is site-only (stripped from a game export)");
  const lowered = nalvlToRawLevelData(lvl);
  const grips = (lowered.obstacles ?? []).filter((o) => o.obstacle_type === "grip");
  check(grips.length === 1, "nalvlToRawLevelData keeps the grip zone for the sim");
  const back = rawLevelDataToNalvl(lowered, "grip round trip").obstacles.filter((o) => o.kind === "grip");
  check(back.length === 1, "rawLevelDataToNalvl recovers the grip zone");
  check(back[0]?.gripMultiplier === 2, "the grip multiplier survives the round trip", `got ${back[0]?.gripMultiplier}`);
  const d = defaultObstacle("grip", box(500, -800));
  check(d.gripMultiplier === 2 && d.gripTraction === 1, "defaultObstacle('grip') is the 2x default");
}

console.log();
console.log(failures === 0 ? "ALL GRIP CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
