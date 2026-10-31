/**
 * Checks the viewer's colour overrides.
 *
 * Run: npx tsx scripts/verify-render-colors.ts
 *
 * The replay viewer lets a run's arrow, thrust and trail colours be overridden
 * for the "Game" (2D) and "Game (WebGL)" render modes. Both paths resolve the
 * same override into a per-part colour, so the two renderers must agree: the
 * WebGL side goes through `withColorOverrides`, and the 2D side through the
 * `body`/`thrust`/`trail` fields the caller passes to the painters.
 *
 * The helper is pure, so it can be asserted directly. An omitted or unparsable
 * override must leave the run's own skin colour alone, otherwise a blank picker
 * would repaint the arrow.
 */
import { skinFor, withColorOverrides } from "@/lib/game-renderer/render.js";

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

const base = skinFor("narrow", null);
const rgb = (c: number[] | undefined) => (c ? c.map((n) => Math.round(n * 255)) : undefined);

// No overrides: the skin is returned untouched.
{
  const same = withColorOverrides(base, undefined);
  check("no overrides leaves the skin as-is", same === base);
  const empty = withColorOverrides(base, {});
  check(
    "an empty override object leaves the colours alone",
    rgb(empty.theme)!.join() === rgb(base.theme)!.join(),
  );
}

// Each part overrides independently and does not touch the others.
{
  const o = withColorOverrides(base, { body: "#123456" });
  check("body overrides the theme", rgb(o.theme)!.join() === "18,52,86", rgb(o.theme)!.join());
  check("body leaves the thrust alone", rgb(o.thrust)!.join() === rgb(base.thrust)!.join());
}
{
  const o = withColorOverrides(base, { thrust: "#ff0000" });
  check("thrust overrides the thrust", rgb(o.thrust)!.join() === "255,0,0");
  check("thrust leaves the theme alone", rgb(o.theme)!.join() === rgb(base.theme)!.join());
}
{
  const o = withColorOverrides(base, { trail: "#abcdef" });
  check("trail overrides the trail", rgb(o.trailColor)!.join() === "171,205,239");
}

// All three at once.
{
  const o = withColorOverrides(base, { body: "#010203", thrust: "#040506", trail: "#070809" });
  check(
    "body, thrust and trail can all be set at once",
    rgb(o.theme)!.join() === "1,2,3" &&
      rgb(o.thrust)!.join() === "4,5,6" &&
      rgb(o.trailColor)!.join() === "7,8,9",
  );
}

// A 0xRRGGBB and a bare number are accepted too, matching the engine's own parser.
{
  const o = withColorOverrides(base, { body: "0x00ff00" });
  check("a 0xRRGGBB override is parsed", rgb(o.theme)!.join() === "0,255,0");
}

// An unparsable value is ignored, so a bad string cannot blank the arrow.
{
  const o = withColorOverrides(base, { body: "not-a-colour", trail: "" });
  check("an unparsable override is ignored", rgb(o.theme)!.join() === rgb(base.theme)!.join());
  check("an empty-string override is ignored", o.trailColor === base.trailColor);
}

// The base skin object must never be mutated (it is the shared default).
{
  const before = rgb(base.theme)!.join();
  withColorOverrides(base, { body: "#ffffff" });
  check("the base skin is not mutated", rgb(base.theme)!.join() === before);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
