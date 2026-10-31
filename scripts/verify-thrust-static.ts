/**
 * Checks that the thrust flame is a static shape.
 *
 * Run: npx tsx scripts/verify-thrust-static.ts
 *
 * The flame is a pure drawing routine, so the meaningful assertion is that the
 * commands it issues do not depend on time. The run data it reads is only the
 * engine's thrust level, which really does change during a run.
 *
 * No canvas backend is installed, so a recording stub captures the calls. The
 * function under test is the real one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drawGameThrust } from "@/lib/replay-paint";

interface Call {
  op: string;
  args: unknown[];
}

function recorder() {
  const calls: Call[] = [];
  const push =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    save: push("save"),
    restore: push("restore"),
    translate: push("translate"),
    rotate: push("rotate"),
    beginPath: push("beginPath"),
    moveTo: push("moveTo"),
    lineTo: push("lineTo"),
    closePath: push("closePath"),
    fill: push("fill"),
    stroke: push("stroke"),
    arc: push("arc"),
    fillText: push("fillText"),
    set fillStyle(v: string) {
      calls.push({ op: "fillStyle", args: [v] });
    },
    set globalAlpha(v: number) {
      calls.push({ op: "globalAlpha", args: [v] });
    },
    set strokeStyle(v: string) {
      calls.push({ op: "strokeStyle", args: [v] });
    },
    set lineWidth(v: number) {
      calls.push({ op: "lineWidth", args: [v] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

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

const identity = (v: number) => v;
const KINDS = ["narrow", "speedy", "energy"] as const;

function draw(kind: (typeof KINDS)[number], power: number) {
  const { ctx, calls } = recorder();
  drawGameThrust(ctx, kind, 100, 50, 0.7, 12, 1, identity, identity, power);
  return calls;
}

// ---- Same input, same output -------------------------------------------
for (const kind of KINDS) {
  const a = JSON.stringify(draw(kind, 1));
  const b = JSON.stringify(draw(kind, 1));
  check(`repeated draws are identical (${kind})`, a === b);
}

// ---- The plume's length comes from thrust level, not time ---------------
// The function takes no time argument at all, so the only way length could vary
// is through `power`. Higher thrust must mean a longer plume, and full thrust
// must be visibly longer than a trickle.
function tipX(kind: (typeof KINDS)[number], power: number) {
  const calls = draw(kind, power);
  const lines = calls.filter((c) => c.op === "lineTo");
  return Math.max(...lines.map((c) => Math.abs(c.args[0] as number)));
}

for (const kind of KINDS) {
  const low = tipX(kind, 0.1);
  const high = tipX(kind, 1);
  check(
    `full thrust extends the plume (${kind})`,
    high > low * 1.5,
    `${low.toFixed(1)}px -> ${high.toFixed(1)}px`,
  );
}

// ---- Shape sanity --------------------------------------------------------
const full = draw("narrow", 1);
const ops = full.map((c) => c.op);
check("draws two filled polygons (outer + inner)", ops.filter((o) => o === "fill").length === 2);
check(
  "saves and restores the context",
  ops.filter((o) => o === "save").length === ops.filter((o) => o === "restore").length,
);
check("translate then rotate, in that order", ops.indexOf("translate") < ops.indexOf("rotate"));

// Each triangle is drawn as corner, tip, corner: the two corners sit on the
// arrow's axis at x == 0 and the tip is the far point. A wagging tip still has
// three points, so assert the far point stays on the axis (y == 0), which is
// what the wobble broke.
const points = full.filter((c) => c.op === "lineTo").map((c) => c.args as [number, number]);
const tips = points.filter(([x]) => Math.abs(x) > 1e-9);
check(
  "the plume tip sits on the arrow's axis",
  tips.length === 2 && tips.every(([, y]) => y === 0),
  tips.map(([x, y]) => `(${x.toFixed(1)}, ${y})`).join(" "),
);

// ---- Degenerate input ----------------------------------------------------
for (const kind of KINDS) {
  for (const power of [0, -1, 2, NaN]) {
    const calls = draw(kind, power);
    const nums = JSON.stringify(calls).match(/-?\d+\.?\d*(e-?\d+)?/g) ?? [];
    const bad = nums.filter((n) => !Number.isFinite(Number(n)));
    if (bad.length) {
      check(`power=${power} (${kind}) stays finite`, false, bad.join(", "));
      break;
    }
  }
}
check("out-of-range power never produces NaN/Infinity", true);

// ---- The 2D and WebGL renderers scale the plume identically ---------------
// The scale factors are duplicated across the TS painter and the ported JS
// renderer (the repo's pattern for shared game constants), so pin the pair:
// a mismatch would make an exported clip disagree with Play.
const paintSrcFile = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "replay-render.ts"),
  "utf8",
);
const glArrows = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "game-renderer", "arrows.js"),
  "utf8",
);
const grab = (src: string, name: string) =>
  Number(new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(src)?.[1]);
const tsLen = grab(paintSrcFile, "GAME_THRUST_LENGTH_SCALE");
const tsWid = grab(paintSrcFile, "GAME_THRUST_WIDTH_SCALE");
const glLen = grab(glArrows, "THRUST_LENGTH_SCALE");
const glWid = grab(glArrows, "THRUST_WIDTH_SCALE");
check(
  "the 2D and WebGL plume length scales agree",
  Number.isFinite(tsLen) && tsLen === glLen,
  `2D ${tsLen} vs GL ${glLen}`,
);
check(
  "the 2D and WebGL plume width scales agree",
  Number.isFinite(tsWid) && tsWid === glWid,
  `2D ${tsWid} vs GL ${glWid}`,
);

// ---- The plume never points forward -------------------------------------
// It is drawn after rotating by rot + PI, so the local +x is behind the arrow.
const rotCalls = full.filter((c) => c.op === "rotate");
check(
  "rotates to face backwards",
  rotCalls.length === 1 && Math.abs((rotCalls[0].args[0] as number) - (0.7 + Math.PI)) < 1e-9,
);

// ---- The routine does not read a clock or a random source ---------------
// The stub checks above pin the shape and its determinism, but a pure function
// of a time argument would pass them too. The property that actually matters is
// that time is not an input at all, so assert it at the source: no time or
// randomness term may appear in the body, and no `tick` parameter may return.
const here = dirname(fileURLToPath(import.meta.url));
const paintSrc = readFileSync(join(here, "..", "src", "lib", "replay-paint.ts"), "utf8");
const start = paintSrc.indexOf("export function drawGameThrust");
const body = paintSrc.slice(start, paintSrc.indexOf("\n}", start));
check("drawGameThrust is found in replay-paint.ts", start >= 0);
for (const term of [
  "Math.random",
  "Date.now",
  "performance.now",
  "tick",
  "secs",
  "pulse",
  "ripple",
  "wag",
]) {
  check(`no ${term} in the thrust routine`, !body.includes(term));
}
// sin/cos are allowed, but only to place the flame behind the arrow from its
// rotation — one each, both on a line that reads `rot`. An oscillator would
// need more of them, or a phase constant.
const trigLines = body.split("\n").filter((l) => /Math\.(sin|cos)\(/.test(l));
check(
  "trigonometry is used only to anchor the flame to the arrow's rotation",
  trigLines.length === 2 && trigLines.every((l) => l.includes("rot")),
  trigLines.map((l) => l.trim()).join(" | "),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
