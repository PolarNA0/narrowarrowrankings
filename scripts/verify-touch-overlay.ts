/**
 * Checks the site touch-control overlay.
 *
 * Run: npx tsx scripts/verify-touch-overlay.ts
 *
 * The overlay is a pure drawing routine, so the meaningful assertions are about
 * the calls it issues: which zone is filled, and what number is written in it.
 * The symbol it reads is the recorded input, which is the only spatial
 * information a site run carries — the controls are two fixed half-screen zones,
 * so a touch has no position beyond which half it landed in.
 *
 * No canvas backend is installed, so a recording stub captures the calls. The
 * function under test is the real one.
 */
import { drawTouchOverlay } from "@/lib/replay-paint";

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
    beginPath: push("beginPath"),
    arc: push("arc"),
    fill: push("fill"),
    stroke: push("stroke"),
    fillText: push("fillText"),
    set fillStyle(v: string) {
      calls.push({ op: "fillStyle", args: [v] });
    },
    set strokeStyle(v: string) {
      calls.push({ op: "strokeStyle", args: [v] });
    },
    set lineWidth(v: number) {
      calls.push({ op: "lineWidth", args: [v] });
    },
    set font(v: string) {
      calls.push({ op: "font", args: [v] });
    },
    set textAlign(v: string) {
      calls.push({ op: "textAlign", args: [v] });
    },
    set textBaseline(v: string) {
      calls.push({ op: "textBaseline", args: [v] });
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

const W = 800;
const H = 340;

function draw(symbol: number | undefined) {
  const { ctx, calls } = recorder();
  drawTouchOverlay(ctx, symbol, W, H);
  const arcs = calls.filter((c) => c.op === "arc");
  const fills = calls.filter((c) => c.op === "fill");
  const texts = calls.filter((c) => c.op === "fillText");
  return { calls, arcs, fills, texts };
}

// The zones are laid out at the quarter points, matching the half-screen halves
// they stand for: the left half's centre is a quarter of the way across.
{
  const { arcs } = draw(0);
  const xs = arcs.map((a) => a.args[0] as number);
  check(
    "the two zones sit at the quarter points",
    arcs.length === 2 && Math.abs(xs[0] - W * 0.25) < 1 && Math.abs(xs[1] - W * 0.75) < 1,
    `x = ${xs.join(", ")}`,
  );
  const ys = arcs.map((a) => a.args[1] as number);
  check(
    "both zones are vertically centred",
    ys.every((y) => Math.abs(y - H / 2) < 1),
  );
}

// Coasting: the layout is visible but nothing is held, so no zone is filled and
// no hand is numbered.
{
  const { arcs, fills, texts } = draw(0);
  check("coasting outlines both zones", arcs.length === 2);
  check("coasting fills no zone", fills.length === 0);
  check("coasting numbers no hand", texts.length === 0);
}

// Right steer (symbol 1): only the right zone lights, and it is hand "1" because
// it is the only hand down.
{
  const { fills, texts } = draw(1);
  check("steering right fills exactly one zone", fills.length === 1);
  check("steering right numbers it 1", texts.length === 1 && texts[0].args[0] === "1");
}

// Left steer (symbol 2): mirror of the above.
{
  const { fills, texts } = draw(2);
  check("steering left fills exactly one zone", fills.length === 1);
  check("steering left numbers it 1", texts.length === 1 && texts[0].args[0] === "1");
}

// Brake (symbol 3) is both halves held — the two-hand grip. Both zones light and
// are numbered, which is what makes a brake legible at a glance.
{
  const { fills, texts } = draw(3);
  check("braking fills both zones", fills.length === 2);
  const nums = texts.map((t) => t.args[0]).sort();
  check("braking numbers both hands", texts.length === 2 && nums.join("") === "12", nums.join(","));
  // The numbers sit in the left and right zones respectively.
  const pairs = texts.map((t) => ({ label: t.args[0], x: t.args[1] as number }));
  const one = pairs.find((p) => p.label === "1");
  const two = pairs.find((p) => p.label === "2");
  check(
    "hand 1 is on the left and hand 2 on the right",
    !!one && !!two && one.x < two.x,
    `1 at ${one?.x}, 2 at ${two?.x}`,
  );
}

// The spawn sample carries no input. It must draw the layout, not crash and not
// claim a hand is down.
{
  const { arcs, fills, texts } = draw(undefined);
  check(
    "an absent symbol draws the layout without a hand",
    arcs.length === 2 && fills.length === 0 && texts.length === 0,
  );
}

// The overlay must not leak canvas state into whatever draws next.
{
  const { calls } = draw(3);
  const saves = calls.filter((c) => c.op === "save").length;
  const restores = calls.filter((c) => c.op === "restore").length;
  check(
    "the overlay balances save/restore",
    saves === restores && saves > 0,
    `${saves} save, ${restores} restore`,
  );
}

// A tall narrow canvas must not push the circles off the edges: the radius is
// derived from the smaller dimension.
{
  const { ctx, calls } = recorder();
  drawTouchOverlay(ctx, 3, 200, 700);
  const r = calls.find((c) => c.op === "arc")!.args[2] as number;
  check("the radius is clamped to the smaller dimension", r <= 200 * 0.25 + 1, `r = ${r}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
