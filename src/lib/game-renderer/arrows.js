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

/**
 * The game's plume reads a little small on our canvas, so the WebGL renderer
 * and the 2D "game" painter both scale it by these. They must agree, or an
 * exported clip would not match Play. Kept small: the shape is the game's own.
 */
export const THRUST_LENGTH_SCALE = 1.15;
export const THRUST_WIDTH_SCALE = 1.12;
