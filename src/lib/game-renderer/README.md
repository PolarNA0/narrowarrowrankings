# Game renderer

This directory is the game's own renderer, ported so the site can draw a replay
the way the game draws it, instead of the schematic 2D canvas in
`src/components/ReplayViewer.tsx`.

The physics was never the gap: `src/lib/physics/rust_bg.wasm` is byte-identical
to the engine the game ships, and the site has always stepped it to reconstruct
a run. Only the _drawing_ was approximated. This closes that gap.

## What is verbatim, and what is adapted

Copied unchanged from the game (via `replay-tools`, which recovered them from
APK v2.4.8):

| File               | Source                  | What it is                                                        |
| ------------------ | ----------------------- | ----------------------------------------------------------------- |
| `shaders.js`       | `assets/shaders/*.frag` | Backgrounds, walls, finish checker, portals, thrust, wall contact |
| `trail-shaders.js` | `assets/shaders/*.frag` | The trajectory ribbon styles                                      |
| `gl.js`            | —                       | The WebGL2 `Renderer`: programs, buffers, the two-pass background |
| `render.js`        | —                       | Camera model, and the `draw*` calls that compose a frame          |

Adapted (the only edits, each marked in-file):

- `render.js` imports `ARROWS` from `./arrows.js` instead of the game's
  `engine.js`, so the port does not drag in the whole game runtime.
- `render.js` loads skins from `/assets/skins/` (the site's `public/`) rather
  than `./assets/`.

`arrows.js` is the one file written for the site: the arrow `visual` palette and
the sprite sizes, which `render.js` reads. The `consts` it carries match
`ARROW_CONSTANTS` in `src/lib/replay-sim.ts`.

`index.ts` is the typed facade. The ported files stay JS on purpose — retyping
~3k lines would make the diff impossible to check against the original — so the
facade is the single typed boundary, with `gl.d.ts` / `render.d.ts` declaring
just the surface the app calls.

## Using it

```ts
import { GameRenderer, ensureSkins, gameArrowType } from "@/lib/game-renderer";

await ensureSkins();
const renderer = new GameRenderer(canvas);
const size = renderer.resize(cssWidth, cssHeight);
renderer.draw({ player, map, effects, trail, arrowType: "narrow" }, size, performance.now());
```

`GameCanvas.tsx` is the React wrapper: it drives a private engine instance at
the engine's own 240 Hz and draws every animation frame. It steps its own engine
rather than replaying the site's sampled path because the renderer needs the
engine's _live_ obstacle list (so rotating walls and portals animate) and its
per-tick effects (wall contact, thrust), which only the engine exposes.

The mode is opt-in in the replay viewer ("Game (WebGL)"); "Simple lines" and
"Game" still use the 2D canvas, so nothing regresses if WebGL2 is unavailable.

## Assets

`public/assets/skins/{narrow,speedy,energy}.svg` are the game's arrow sprites.
They are loaded at runtime and are not fatal if missing: `drawArrow` skips the
sprite and still draws the thrust and the hitbox.
