import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine } from "@/lib/replay-sim";
import { buildEndlessCourse } from "@/lib/endless";
initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });
async function main() {
  for (const sections of [20, 400]) {
    const c = buildEndlessCourse({ seed: 7, sections });
    const eng = await createReplayEngine(c.data, "Narrow Arrow");
    if (!eng) throw new Error("no engine");
    let maxErr = 0, mism = 0;
    for (let i=0;i<400;i++) {
      eng.stepCode(i % 4);
      const r = eng.read(); const p = eng.pose();
      maxErr = Math.max(maxErr, Math.abs(r.x-p.x), Math.abs(r.y-p.y));
      // compare velocity against full parse
      const full = JSON.parse((eng as any).snapshot());
      const vx = full.player.velocity.x, vy = full.player.velocity.y;
      if (Math.abs(vx-p.vx) > 1e-9 || Math.abs(vy-p.vy) > 1e-9) mism++;
    }
    console.log(`sections=${sections}: maxErr(x,y)=${maxErr.toExponential(2)}  velMismatch=${mism}`);
    // bench
    for (let i=0;i<2000;i++) eng.read();
    let t=performance.now(); for(let i=0;i<5000;i++) eng.read(); const readMs=(performance.now()-t)/5000;
    t=performance.now(); for(let i=0;i<5000;i++) eng.pose(); const poseMs=(performance.now()-t)/5000;
    console.log(`   read(full parse)=${readMs.toFixed(4)}ms  pose(head)=${poseMs.toFixed(4)}ms  speedup=${(readMs/poseMs).toFixed(1)}x`);
    eng.free();
  }
}
main();
