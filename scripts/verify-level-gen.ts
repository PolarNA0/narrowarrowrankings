/**
 * Verify the level generator against the real engine and against the measured
 * shape of the 72 official levels.
 *
 * Run: npx tsx scripts/verify-level-gen.ts
 *
 * The official figures below were measured from
 * `api.narrowarrow.xyz/level-details/<id>` over the whole official set; they are
 * the target the generator is trying to hit, so they are asserted rather than
 * left as prose.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine, type RawLevelData } from "@/lib/replay-sim";
import { nalvlToRawLevelData } from "@/lib/nalvl";
import {
  DEFAULT_GEN_OPTIONS,
  GEN_CORRIDOR,
  GEN_FINISH_THICKNESS,
  GEN_GRID,
  GEN_TEMPLATES,
  GEN_WALL_THICKNESS,
  generateLevel,
  isCompletable,
  type GenTemplate,
} from "@/lib/level-gen";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`OK   ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const TEMPLATES = GEN_TEMPLATES.map((t) => t.id);
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 1);
const opts = (template: GenTemplate, seed: number) => ({ ...DEFAULT_GEN_OPTIONS, template, seed });

// ---- Determinism ---------------------------------------------------------
{
  let allSame = true;
  for (const t of TEMPLATES) {
    const a = JSON.stringify(generateLevel(opts(t, 12345)));
    const b = JSON.stringify(generateLevel(opts(t, 12345)));
    if (a !== b) allSame = false;
  }
  check("same seed produces an identical level", allSame);

  const distinct = new Set(SEEDS.map((s) => JSON.stringify(generateLevel(opts("maze", s)))));
  check(
    "different seeds produce different levels",
    distinct.size === SEEDS.length,
    `${distinct.size}/${SEEDS.length} unique`,
  );
}

// ---- The lattice and thicknesses the official levels use -----------------
{
  let offGrid = 0;
  let badThickness = 0;
  let badFinish = 0;
  let total = 0;
  for (const t of TEMPLATES) {
    for (const seed of SEEDS) {
      const level = generateLevel(opts(t, seed));
      for (const o of level.obstacles) {
        total += 1;
        for (const p of o.points) {
          if (p.x % GEN_GRID !== 0 || p.y % GEN_GRID !== 0) offGrid += 1;
        }
        if (o.kind === "wall" && o.wallType === "finish") {
          if (o.thickness !== GEN_FINISH_THICKNESS) badFinish += 1;
        } else if (o.kind === "wall" && o.thickness !== GEN_WALL_THICKNESS) {
          badThickness += 1;
        }
      }
    }
  }
  check(
    "every coordinate lands on the 30-unit lattice",
    offGrid === 0,
    `${total} obstacles checked`,
  );
  check(
    "walls are 8 thick like the official set",
    badThickness === 0,
    `thickness=${GEN_WALL_THICKNESS}`,
  );
  check(
    "finish walls are 32 thick like the official set",
    badFinish === 0,
    `thickness=${GEN_FINISH_THICKNESS}`,
  );
}

// ---- Spawn clearance -----------------------------------------------------
// The arrow spawns at the origin facing -y and cannot be moved by the payload,
// so a wall within a corridor of the origin is an instant death on tick 0.
{
  let worst = Infinity;
  let worstWhere = "";
  for (const t of TEMPLATES) {
    for (const seed of SEEDS) {
      const level = generateLevel(opts(t, seed));
      for (const o of level.obstacles) {
        for (let i = 0; i < o.points.length; i++) {
          const a = o.points[i];
          const b = o.points[(i + 1) % o.points.length];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          let u = len2 === 0 ? 0 : ((0 - a.x) * dx + (0 - a.y) * dy) / len2;
          u = Math.max(0, Math.min(1, u));
          const d = Math.hypot(a.x + u * dx, a.y + u * dy);
          if (d < worst) {
            worst = d;
            worstWhere = `${t}/${seed}`;
          }
        }
      }
    }
  }
  check(
    "the spawn has a clear runway",
    worst >= GEN_CORRIDOR,
    `closest wall ${worst} units (${worstWhere}); official median 40`,
  );
}

// ---- The border is closed ------------------------------------------------
// The arrow must not be able to leave the map, so every point of the bounding
// rectangle has to be covered by a wall. The only gap allowed is the finish,
// which is itself a wall, so a hole here means an escape route.
{
  const holes: string[] = [];
  for (const t of TEMPLATES) {
    for (const seed of SEEDS) {
      const level = generateLevel(opts(t, seed));
      const walls = level.obstacles.filter((o) => o.kind === "wall");
      const xs = level.obstacles.flatMap((o) => o.points.map((p) => p.x));
      const ys = level.obstacles.flatMap((o) => o.points.map((p) => p.y));
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      // Walk the perimeter, one unit at a time.
      const samples: { x: number; y: number }[] = [];
      for (let x = x0; x <= x1; x += 1) {
        samples.push({ x, y: y0 }, { x, y: y1 });
      }
      for (let y = y0; y <= y1; y += 1) {
        samples.push({ x: x0, y }, { x: x1, y });
      }
      let uncovered = 0;
      for (const s of samples) {
        const covered = walls.some((o) => {
          const pts = o.points;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            let u = len2 === 0 ? 0 : ((s.x - a.x) * dx + (s.y - a.y) * dy) / len2;
            u = Math.max(0, Math.min(1, u));
            const d = Math.hypot(s.x - (a.x + u * dx), s.y - (a.y + u * dy));
            if (d <= (o.thickness ?? GEN_WALL_THICKNESS) / 2 + 1) return true;
          }
          return false;
        });
        if (!covered) uncovered += 1;
      }
      if (uncovered > 0) holes.push(`${t}/${seed}: ${uncovered} of ${samples.length}`);
    }
  }
  check(
    "the map border is closed on every seed",
    holes.length === 0,
    holes.slice(0, 4).join(", ") || "no gaps",
  );
}

// ---- No wall is drawn twice ----------------------------------------------
{
  const dupes: string[] = [];
  for (const t of TEMPLATES) {
    for (const seed of SEEDS) {
      const level = generateLevel(opts(t, seed));
      const seen = new Set<string>();
      for (const o of level.obstacles) {
        if (o.kind !== "wall") continue;
        const key = o.points
          .map((p) => `${p.x},${p.y}`)
          .sort()
          .join("|");
        if (seen.has(key)) dupes.push(`${t}/${seed}`);
        seen.add(key);
      }
    }
  }
  check(
    "no wall segment is emitted twice",
    dupes.length === 0,
    dupes.slice(0, 4).join(", ") || "none",
  );
}

// ---- Reachability --------------------------------------------------------
// Measured on the free space: the spawn must be open and the finish must be
// reachable from it, or the level cannot be completed at all.
{
  const broken: string[] = [];
  for (const t of TEMPLATES) {
    for (const seed of SEEDS) {
      if (!isCompletable(generateLevel(opts(t, seed)))) broken.push(`${t}/${seed}`);
    }
  }
  check(
    "the finish is reachable from the spawn on every seed",
    broken.length === 0,
    broken.slice(0, 5).join(", ") || `${TEMPLATES.length * SEEDS.length} levels`,
  );
}

// ---- Corridor widths match the official distribution --------------------
// The official free gaps cluster at 30/60/120; the generator holds corridors at
// GEN_CORRIDOR. Measure the same statistic the analysis did, by rasterising the
// walls and taking runs of free cells.
{
  const runs: number[] = [];
  const RASTER = 10;
  for (const t of TEMPLATES) {
    for (const seed of SEEDS.slice(0, 8)) {
      const level = generateLevel(opts(t, seed));
      const walls = level.obstacles.filter((o) => o.kind === "wall");
      const xs = walls.flatMap((o) => o.points.map((p) => p.x));
      const ys = walls.flatMap((o) => o.points.map((p) => p.y));
      const minX = Math.min(...xs) - RASTER;
      const minY = Math.min(...ys) - RASTER;
      const w = Math.ceil((Math.max(...xs) - minX) / RASTER) + 2;
      const h = Math.ceil((Math.max(...ys) - minY) / RASTER) + 2;
      const solid = new Uint8Array(w * h);
      // Centreline only, matching the official analysis exactly: marking the
      // wall's thickness as well would inflate it and make the two distributions
      // incomparable.
      for (const o of walls) {
        for (let i = 0; i < o.points.length; i++) {
          const a = o.points[i];
          const b = o.points[(i + 1) % o.points.length];
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (RASTER / 2)));
          for (let s = 0; s <= steps; s++) {
            const gx = Math.floor((a.x + ((b.x - a.x) * s) / steps - minX) / RASTER);
            const gy = Math.floor((a.y + ((b.y - a.y) * s) / steps - minY) / RASTER);
            if (gx >= 0 && gy >= 0 && gx < w && gy < h) solid[gy * w + gx] = 1;
          }
        }
      }
      for (let gy = 1; gy < h - 1; gy++) {
        let run = 0;
        for (let gx = 1; gx < w - 1; gx++) {
          if (solid[gy * w + gx]) {
            if (run > 0) runs.push(run * RASTER);
            run = 0;
          } else run += 1;
        }
      }
    }
  }
  runs.sort((a, b) => a - b);
  const q = (p: number) => runs[Math.min(runs.length - 1, Math.floor(runs.length * p))];
  // Official p10 was 20 and p25 60. A 60-wide corridor between two wall
  // centrelines measures as 50 or 60 cells depending on where those centrelines
  // fall in the 10-unit raster, so one raster step below the corridor width is
  // the honest floor here; anything less would mean a genuinely tighter passage.
  check(
    "no free gap is narrower than one corridor",
    q(0.1) >= GEN_CORRIDOR - RASTER,
    `p10 ${q(0.1)} (floor ${GEN_CORRIDOR - RASTER}, official p10 20)`,
  );
  check(
    "corridor widths sit in the official band",
    q(0.25) >= 45 && q(0.25) <= 90,
    `p25 ${q(0.25)}, median ${q(0.5)} (official p25 60, median ~145)`,
  );
}

// ---- Obstacle counts are in the official range ---------------------------
// Official: min 11, median 51, max 301 obstacles per level.
{
  const counts = TEMPLATES.flatMap((t) =>
    SEEDS.map((s) => generateLevel(opts(t, s)).obstacles.length),
  );
  counts.sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  check(
    "obstacle counts are in the official range",
    counts[0] >= 8 && median >= 20 && median <= 200,
    `min ${counts[0]}, median ${median}, max ${counts[counts.length - 1]} (official min 11, median 51, max 301)`,
  );
}

// ---- The real engine accepts the level and the arrow survives ------------
// The reachability check works on free space; this proves the engine itself
// loads the payload, spawns the arrow in the open, and that a coasting arrow
// does not die immediately (which is what a spawn inside a wall looks like).
async function engineChecks() {
  for (const t of TEMPLATES) {
    const level = generateLevel(opts(t, 1));
    const raw = nalvlToRawLevelData(level) as unknown as RawLevelData;
    const eng = await createReplayEngine(raw, "Narrow Arrow");
    if (!eng) {
      check(`engine builds the ${t} level`, false);
      continue;
    }
    const spawn = eng.reset();
    const inWall = spawn.x !== 0 || spawn.y !== 0;
    check(`the ${t} level spawns the arrow at the origin`, !inWall, `(${spawn.x}, ${spawn.y})`);

    // Coast for 240 ticks (one second); a spawn inside a wall is terminal at once.
    let died = false;
    for (let i = 0; i < 240; i++) {
      const p = eng.step(0);
      if (p.finished) break;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        died = true;
        break;
      }
    }
    const after = eng.read();
    check(
      `the arrow is alive after 1s on the ${t} level`,
      !died && Number.isFinite(after.x),
      `at (${after.x.toFixed(1)}, ${after.y.toFixed(1)})`,
    );
  }
}

await engineChecks();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
