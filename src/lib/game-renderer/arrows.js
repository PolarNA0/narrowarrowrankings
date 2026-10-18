/**
 * Arrow constants + visual parameters, the pair `render.js` reads.
 *
 * The `consts` are the physics values the engine already uses (they match
 * `ARROW_CONSTANTS` in `replay-sim.ts`); `visual` is the game's per-arrow
 * thrust palette, recovered from the compiled Dart alongside the shaders.
 * Kept here so the ported renderer stays a verbatim copy with one import
 * rewired, rather than reaching into the physics module.
 */

export const ARROWS = {
  narrow: {
    label: "Narrow Arrow",
    consts: { radius: 16 },
    visual: { theme: "#ffaaff", thrust: "#ff6600", thrustOffset: 10, thrustLength: 40, thrustWidth: 16 },
  },
  speedy: {
    label: "Speedy Arrow",
    consts: { radius: 20 },
    visual: { theme: "#2266ff", thrust: "#cc33ff", thrustOffset: 12, thrustLength: 48, thrustWidth: 24 },
  },
  energy: {
    label: "Energy Arrow",
    consts: { radius: 12 },
    visual: { theme: "#22ff66", thrust: "#ff0033", thrustOffset: 8, thrustLength: 32, thrustWidth: 8 },
  },
};
