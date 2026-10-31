// Level/arrow drawing on top of the WebGL renderer (js/gl.js).
//
// The real game shaders are used where the game uses them:
//   - finish line  -> finish_line_grid.frag (black/white checker)
//   - portals      -> portal_particles.frag (particle band along the segment)
//   - wall contact -> wall_contact.frag overlay, driven by the engine's own
//                     wall_contact_effects (intensity/translation/direction)
//   - thrust       -> thrust_<style>.frag, driven by the engine's thrust effects
// Walls themselves are drawn solid (a wall_contact shader is a *contact* effect,
// not the resting wall look). Obstacles come from the engine's live map each
// frame, so rotating walls/zones/portals animate with the physics.
import { ARROWS, THRUST_LENGTH_SCALE, THRUST_WIDTH_SCALE } from './arrows.js';

// Wall / zone colours, verbatim from the game (Color constructor is alpha,r,g,b).
const WALL_COLORS = {
  normal: [1, 1, 1],            // #ffffff
  boost: [0.0667, 0.5333, 1],   // #1188ff — blue (Dart C(1, .0667, .5333, 1))
  bouncy: [0.2, 1, 0.2],        // #33ff33 — green (Dart C(1, .2, 1, .2))
  death: [1, 0.4, 0.0667],      // #ff6611
  finish: [1, 1, 1],
};
const ZONE_COLORS = {
  // Zone colours from the game's Dart palette (`bCp`): the engine's `boost` zone
  // is the GREEN one and `ice` is the BLUE one — the editor labels ("Blue Zone",
  // "Green Zone") are the inverse, because the loader maps editor-blue -> `ice`
  // and editor-green -> `boost` (`aZt`/`bZS`). Verified in the compiled build.
  boost: [0, 1, 0],                              // Green Zone, C(.5,0,1,0) -> #00ff00
  ice: [0x55 / 255, 0x99 / 255, 1],              // Blue Zone, C(.5,.333,.6,1) -> #5599ff
  nosteer: [1, 0, 0],                            // Red Zone, C(.5,1,0,0) -> #ff0000
  steer: [0xff / 255, 0xeb / 255, 0x3b / 255],   // Yellow (steer) #ffeb3b
  rail: [0xb0 / 255, 0x6a / 255, 0xff / 255],    // Rails Zone (v2.4.8) - violet
};
// Portal particle colours: the two ends of a linked pair are the game's
// magenta pair `#ff4fd8` and `#cc33ff` (from the compiled Dart palette).
const PORTAL_COLORS = [[1, 0.3098, 0.8471], [0.8, 0.2, 1.0]];
const PORTAL_HALF_WIDTH = 16;   // world units, matches the shader's 18-unit falloff
const FINISH_THICKNESS = 32;
const DEFAULT_THICKNESS = 8;
const CONTACT_HALF_WIDTH = 30;  // screen px around a contact point

const SKIN_FILES = { narrow: 'skins/narrow.svg', speedy: 'skins/speedy.svg', energy: 'skins/energy.svg' };
const skinImages = {};

// The game's default collision-circle colour, verbatim from the compiled Dart:
// `B.dd = C(1, 0, 1, 0)` (alpha, r, g, b) = pure green. A skin with no
// `collisionCircle`/`collision`/`outline` uses this, so the three default arrows
// (whose skinConfigs only carry theme/thrust/shader) draw a GREEN circle — not
// one in the arrow's theme colour.
const DEFAULT_COLLISION = [0, 1, 0];

// Thrust shader style per arrow skin (the game loads thrust_<style>.frag; the
// three shipped arrows use the default style).
const THRUST_STYLE = { narrow: 'default', speedy: 'default', energy: 'default' };

// A run's skin (from /runs/:id skinConfig) overrides the arrow's colours and
// thrust shader; defaults come from the arrow constants in engine.js.
export function skinFor(arrowType, skinConfig) {
  const vis = ARROWS[arrowType].visual;
  const s = {
    theme: hexToRgb(vis.theme),
    thrust: hexToRgb(vis.thrust),
    thrustStyle: THRUST_STYLE[arrowType] ?? 'default',
    collision: DEFAULT_COLLISION,
  };
  if (!skinConfig) return s;
  const code = (c) => (c && (c.code ?? c)) || null;
  const rgb = parseColor(code(skinConfig.themeColor));
  if (rgb) s.theme = rgb;
  const cc = skinConfig.themeColor && skinConfig.themeColor.collisionCircle;
  if (cc != null) s.collision = parseColor(cc);
  const tc = parseColor(code(skinConfig.thrustColor));
  if (tc) s.thrust = tc;
  const ts = skinConfig.thrustShader && (skinConfig.thrustShader.name ?? skinConfig.thrustShader);
  if (ts && String(ts).toLowerCase() !== 'default') s.thrustStyle = String(ts).toLowerCase().replace(/\s+/g, '_');
  // Trail style (one of the game's 14 mesh shaders) and colour come from the run's
  // skin config when present, else the arrow default.
  const tsh = skinConfig.trailShader && (skinConfig.trailShader.name ?? skinConfig.trailShader);
  if (tsh) s.trailShader = String(tsh).toLowerCase().replace(/\s+/g, '_').replace(/^trail_/, '');
  const trc = parseColor(code(skinConfig.trailColor));
  if (trc) s.trailColor = trc;
  return s;
}

/**
 * Apply the viewer's colour overrides to a resolved skin. Each field is
 * optional, so a caller can override just the trail. An unparsable value is
 * ignored rather than blanking the colour.
 */
export function withColorOverrides(skin, colors) {
  if (!colors) return skin;
  const s = { ...skin };
  const body = parseColor(colors.body);
  if (body) s.theme = body;
  const thrust = parseColor(colors.thrust);
  if (thrust) s.thrust = thrust;
  const trail = parseColor(colors.trail);
  if (trail) s.trailColor = trail;
  return s;
}


// Accepts "#rrggbb", "0xRRGGBB" or a 24-bit number.
function parseColor(v) {
  if (v == null) return null;
  if (typeof v === 'number') return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  const s = String(v).trim();
  if (s.startsWith('#')) return hexToRgb(s);
  if (/^0x[0-9a-f]+$/i.test(s)) return parseColor(parseInt(s, 16));
  return null;
}

export async function loadSkins() {
  await Promise.all(Object.entries(SKIN_FILES).map(([k, url]) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { skinImages[k] = img; res(); };
    img.onerror = () => res();
    img.src = `/assets/${url}`;
  })));
}

// Camera preset bundles (from the game's Settings → Camera). Selecting a preset
// fills the sliders; the sliders then override individual values.
export const CAMERA_PRESETS = {
  normal: { zoom: 1.9, dynamicZoom: 1.2, zoomSmoothness: 4, moveAhead: 2.5, movementSmoothness: 5 },
  smooth: { zoom: 2.1, dynamicZoom: 1.2, zoomSmoothness: 7, moveAhead: 3.5, movementSmoothness: 3 },
  locked: { zoom: 2.4, dynamicZoom: 0, zoomSmoothness: 4, moveAhead: 0, movementSmoothness: 7 },
};

// Camera model matching the game's Settings → Camera options. Movement
// Smoothness is the position-follow exponent; Zoom Smoothness is the zoom
// exponent. `locked` snaps the camera to the arrow with a fixed zoom.
export class Camera {
  constructor(opt = {}) {
    this.x = 0; this.y = 0; this.tx = 0; this.ty = 0;
    this.zoom = 1.9; this.tz = 1.9;
    this.preset = opt.preset ?? 'normal';
    const p = CAMERA_PRESETS[this.preset] ?? CAMERA_PRESETS.normal;
    this.baseZoom = opt.zoom ?? p.zoom;
    this.dynamicZoom = opt.dynamicZoom ?? p.dynamicZoom;
    this.zoomSmoothness = opt.zoomSmoothness ?? p.zoomSmoothness;
    this.moveAhead = opt.moveAhead ?? p.moveAhead;
    this.movementSmoothness = opt.movementSmoothness ?? p.movementSmoothness;
  }
  static from(s = {}) { return new Camera(s); }
  // Live-apply settings changes without resetting the smoothed position/zoom.
  applySettings(s = {}) {
    this.preset = s.preset ?? this.preset;
    this.baseZoom = s.zoom ?? this.baseZoom;
    this.dynamicZoom = s.dynamicZoom ?? this.dynamicZoom;
    this.zoomSmoothness = s.zoomSmoothness ?? this.zoomSmoothness;
    this.moveAhead = s.moveAhead ?? this.moveAhead;
    this.movementSmoothness = s.movementSmoothness ?? this.movementSmoothness;
  }
  follow(p) {
    const v = p.velocity, sp = Math.hypot(v.x, v.y);
    this.tx = p.translation.x + v.x * this.moveAhead;
    this.ty = p.translation.y + v.y * this.moveAhead;
    // Dynamic Zoom widens the view as the arrow speeds up; at 0 the zoom is fixed.
    this.tz = this.baseZoom / (1 + sp * 0.0025 * this.dynamicZoom);
  }
  update(dt) {
    if (this.preset === 'locked') { this.x = this.tx; this.y = this.ty; this.zoom = this.tz; return; }
    const posK = 1 - Math.pow(0.0005, dt * (this.movementSmoothness / 5));
    const zoomK = 1 - Math.pow(0.0005, dt * (this.zoomSmoothness / 4));
    this.x += (this.tx - this.x) * posK;
    this.y += (this.ty - this.y) * posK;
    this.zoom += (this.tz - this.zoom) * zoomK;
  }
}

const hashSeed = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000);
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

// Draw the whole level from the engine's live map (rotations already applied).
export function drawLevel(r, map, cam, W, H, t, bg = 'grid') {
  r.begin(W, H, t, bg, cam);
  const P = (x, y) => r.project(cam, W, H, x, y);

  // Pass 1: zones and portals (under the walls).
  for (const o of map?.obstacles ?? []) {
    const pts = o.points ?? [];
    if (o.obstacle_type === 'zone') {
      if (pts.length < 3) continue;
      const c = ZONE_COLORS[o.zone_type] ?? ZONE_COLORS.boost;
      r.drawPoly(W, H, pts.map(p => P(p.x, p.y)), c[0], c[1], c[2], 0.22);
    } else if (o.obstacle_type === 'portal') {
      if (pts.length < 2) continue;
      const A = P(pts[0].x, pts[0].y), B = P(pts[1].x, pts[1].y);
      const col = PORTAL_COLORS[o.side === 'b' ? 1 : 0];
      r.drawPortal(W, H, t, A, B, cam.zoom, PORTAL_HALF_WIDTH, col, [1, 1, 1], hashSeed(String(o.portal_id ?? '0')));
    }
  }

  // Pass 2: walls and the finish line.
  for (const o of map?.obstacles ?? []) {
    if (o.obstacle_type !== 'wall') continue;
    const pts = o.points ?? [];
    if (pts.length < 1) continue;
    const isFinish = o.wall_type === 'finish';
    const thickness = isFinish ? FINISH_THICKNESS : (o.wall_thickness || DEFAULT_THICKNESS);
    const half = Math.max(1.5, thickness / 2) * cam.zoom;
    const c = WALL_COLORS[o.wall_type] ?? WALL_COLORS.normal;
    // A one-point wall is a degenerate segment: the game strokes it with a round
    // cap, so it renders as a dot of the wall's thickness.
    if (pts.length === 1) {
      const A = P(pts[0].x, pts[0].y);
      r.drawCircle(W, H, A.x, A.y, half, c[0], c[1], c[2], 1, 0);
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const A = P(pts[i - 1].x, pts[i - 1].y), B = P(pts[i].x, pts[i].y);
      if (isFinish) r.drawFinish(W, H, t, A, B, half, cam.zoom);
      else r.drawWall(W, H, A, B, half, c);
    }
  }
}

// wall_contact overlays from the engine's own effect list (effects[playerIndex]).
export function drawWallEffects(r, effects, map, cam, W, H, t) {
  if (!effects) return;
  const P = (x, y) => r.project(cam, W, H, x, y);
  for (const e of effects.wall_contact_effects ?? []) {
    const obs = map?.obstacles?.[e.obstacle_index];
    const c = WALL_COLORS[obs?.wall_type] ?? WALL_COLORS.normal;
    const p = P(e.translation.x, e.translation.y);
    const d = e.direction;
    const len = Math.hypot(d.x, d.y) || 1;
    const ux = d.x / len, uy = d.y / len;
    // Centre the band on the contact point, running along the wall direction.
    const A = { x: p.x - ux * CONTACT_HALF_WIDTH, y: p.y - uy * CONTACT_HALF_WIDTH };
    const B = { x: p.x + ux * CONTACT_HALF_WIDTH, y: p.y + uy * CONTACT_HALF_WIDTH };
    const intensity = Math.max(0.15, Math.min(1, e.intensity * 8));
    r.drawWallContact(W, H, t, A, B, CONTACT_HALF_WIDTH * 0.6, c, intensity);
  }
}

// The game's own arrow sprite size, verbatim from the compiled Dart: the sprite
// is drawn at `32 * (apJ(type) / 16)` where apJ is 16 / 20 / 12 for narrow /
// speedy / energy — i.e. exactly the physics radius. Our drawSprite's `half` is
// half the drawn quad, so half == radius reproduces the APK size (2r across).
// (Scaling by 1.5r, as an earlier version did, rendered 3× too large.)
const SPRITE_HALF = { narrow: 16, speedy: 20, energy: 12 };
export function arrowSpriteHalf(arrowType, zoom = 1) {
  return (SPRITE_HALF[arrowType] ?? 16) * zoom;
}

export function drawArrow(r, p, arrowType, cam, W, H, t, alpha = 1, effects = null, skin = null, showHitbox = true) {
  const vis = ARROWS[arrowType].visual;
  const sk = skin || skinFor(arrowType, null);
  const c = r.project(cam, W, H, p.translation.x, p.translation.y);
  const fx = Math.sin(p.rotation), fy = -Math.cos(p.rotation);   // screen forward
  const zoom = cam.zoom;

  // Thrust from the engine's own thrust effect when available, else the
  // arrow's configured thrust length/width scaled by thrust_power.
  const thrusts = effects?.thrusts ?? [];
  if (thrusts.length && alpha >= 1) {
    const e = thrusts[thrusts.length - 1];
    const ox = r.project(cam, W, H, e.position.x, e.position.y);
    const dl = Math.hypot(e.direction.x, e.direction.y) || 1;
    const dx = e.direction.x / dl, dy = e.direction.y / dl;   // world (y down)
    const length = vis.thrustLength * zoom * THRUST_LENGTH_SCALE;
    const halfW = (vis.thrustWidth / 2) * zoom * THRUST_WIDTH_SCALE;
    r.drawThrust(W, H, t, sk.thrustStyle, ox.x, ox.y, dx, dy, length, halfW, sk.thrust, 0.9);
  } else {
    const thrust = Math.max(0, Math.min(1, p.thrust_power ?? 0));
    if (thrust > 0.02 && alpha >= 1) {
      const length = vis.thrustLength * zoom * (0.4 + 0.6 * thrust) * THRUST_LENGTH_SCALE;
      const halfW = (vis.thrustWidth / 2) * zoom * THRUST_WIDTH_SCALE;
      r.drawThrust(W, H, t, sk.thrustStyle,
        c.x - fx * vis.thrustOffset * zoom, c.y - fy * vis.thrustOffset * zoom,
        -fx, -fy, length, halfW, sk.thrust, 0.55 * thrust);
    }
  }

  const img = skinImages[arrowType];
  if (img) {
    const half = arrowSpriteHalf(arrowType, zoom);
    // The art is white; the game multiplies it by the skin's theme colour. Do
    // NOT over-brighten here: theme*1.5 clips saturated channels to 1.0 and
    // turns the body white (narrow theme #ffaaff -> (1.5,1.0,1.5) -> white).
    r.drawSprite(arrowType, img, W, H, c.x, c.y, half, p.rotation, alpha,
      [sk.theme[0], sk.theme[1], sk.theme[2]]);
  }

  // Collision hitbox: a translucent disc plus a ring at the physics radius,
  // both in the circle colour (green by default) — the game never tints this
  // circle with the arrow's theme.
  if (alpha >= 1 && showHitbox) {
    const rad = p.constants.radius * zoom;
    const cc = sk.collision || sk.theme;
    r.drawCircle(W, H, c.x, c.y, rad, cc[0], cc[1], cc[2], 0.16, 0);
    r.drawCircle(W, H, c.x, c.y, rad, cc[0], cc[1], cc[2], 0.85, Math.max(1.2, zoom * 0.9));
  }
}

// Viewer-only overlay: a guide line showing where the arrow is directed. This is
// NOT a game feature (the game has no such indicator), so it is drawn only when
// the viewer's Aim Guide setting is on. The line runs forward from the arrow
// along its heading, tapering and fading, ending in a small head dot.
export function drawAimGuide(r, p, arrowType, cam, W, H, alpha = 0.7) {
  const zoom = cam.zoom;
  const c = r.project(cam, W, H, p.translation.x, p.translation.y);
  const fx = Math.sin(p.rotation), fy = -Math.cos(p.rotation);   // screen forward
  const len = (ARROWS[arrowType]?.consts?.radius ?? 16) * 7 * zoom;
  const px = -fy, py = fx;                                       // across the heading
  const N = 6;
  for (let i = 1; i <= N; i++) {
    const f0 = (i - 1) / N, f1 = i / N;
    const a = { x: c.x + fx * len * f0, y: c.y + fy * len * f0 };
    const b = { x: c.x + fx * len * f1, y: c.y + fy * len * f1 };
    const w = Math.max(1, zoom * 1.2 * (1 - f1 * 0.6));
    const A = { x: a.x + px * w, y: a.y + py * w }, B = { x: b.x + px * w, y: b.y + py * w };
    const C = { x: b.x - px * w, y: b.y - py * w }, D = { x: a.x - px * w, y: a.y - py * w };
    r.drawPoly(W, H, [A, B, C, D], 1, 1, 1, alpha * (1 - f1 * 0.75));
  }
  const head = { x: c.x + fx * len, y: c.y + fy * len };
  r.drawCircle(W, H, head.x, head.y, Math.max(2, zoom * 2.4), 1, 1, 1, alpha, 0);
  return head;
}

// The game's HUD input indicator: the current steering direction as a small
// arrow above the arrow. Drawn only when Settings → Graphics enables it.
export function drawInputIndicator(r, p, cam, W, H, input) {
  if (!input) return;
  const dir = input.brake ? 'brake' : input.left ? 'left' : input.right ? 'right' : null;
  if (!dir) return;
  const c = r.project(cam, W, H, p.translation.x, p.translation.y);
  const y = c.y - arrowSpriteHalf('narrow', cam.zoom) - 26;
  const col = dir === 'brake' ? [1, 0.3, 0.3] : [1, 1, 1];
  const s = 9;
  const dx = dir === 'left' ? -s : dir === 'right' ? s : 0;
  const pts = dir === 'brake'
    ? [{ x: c.x - s, y: y - s }, { x: c.x + s, y: y - s }, { x: c.x, y: y + s }]
    : [{ x: c.x + dx - Math.sign(dx) * s, y }, { x: c.x + dx, y: y - s }, { x: c.x + dx, y: y + s }];
  r.drawPoly(W, H, pts, col[0], col[1], col[2], 0.85);
}

// The arrow trail, drawn with the game's own world-space mesh shaders
// (js/trail_shaders.js). `trail` is the rolling window of world-space positions
// the play loop logs; `skin` selects the trail colour, and `trailShader` picks
// one of the game's 14 trail styles (default: ribbon).
export function drawTrajectory(r, trail, cam, W, H, arrowType, skin, style = null) {
  if (!trail || trail.length < 2) return;
  const arrow = ARROWS[arrowType] || ARROWS.narrow;
  const col = skin?.trailColor ?? skin?.theme ?? skinFor(arrowType, null).theme;
  r.drawTrail(style || skin?.trailShader || 'ribbon', trail, cam, W, H, {
    radius: arrow.consts.radius,
    color: col,
    alpha: skin?.trailAlpha ?? 1,
  });
}
