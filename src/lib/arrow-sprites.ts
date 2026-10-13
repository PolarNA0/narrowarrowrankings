/**
 * The arrow sprites the game itself ships, recovered from the v2.4.8 APK
 * (`assets/flutter_assets/assets/skins/*.svg`). Each is a 64x64 sprite with the
 * nose pointing up (-y): a `#bfbfbf` exhaust tail and a `#ffffff` body. The
 * game tints both with the run's skin, so we keep the same two-tone split and
 * substitute the body/tail colours at draw time.
 *
 * The path data is copied verbatim from the SVGs; only the fill/stroke colours
 * are dropped so the canvas can tint them.
 */

export type ArrowKind = "narrow" | "speedy" | "energy";

interface Sprite {
  tail: string;
  body: string;
}

const SPRITES: Record<ArrowKind, Sprite> = {
  narrow: {
    tail: "M32 40 20 44 16 60 32 52 48 60 44 44Z",
    body: "M8 48 32 4 56 48 32 40Z",
  },
  speedy: {
    tail: "M32 39l-8 3-12 17 20-8 20 8-12-17Z",
    body: "M8 47l14-16 10-28 10 28 14 16-24-8Z",
  },
  energy: {
    tail: "M32 40l-12 4 2 16 10-4 10 4 2-16Z",
    body: "M8 56V42L32 4 56 42V56L32 40Z",
  },
};

/** The sprite's native width in the 64x64 viewBox; the tip sits at y=4. */
const SPRITE_SIZE = 64;
const SPRITE_TIP_Y = 4;

/** Resolve a run's `arrow_name` to the sprite it flies (default: Narrow). */
export function arrowKind(arrowName: string | null | undefined): ArrowKind {
  const name = (arrowName ?? "").toLowerCase();
  if (name.includes("speedy")) return "speedy";
  if (name.includes("energy")) return "energy";
  return "narrow";
}

const cache = new Map<string, { tail: Path2D; body: Path2D }>();

function pathsFor(kind: ArrowKind) {
  const cached = cache.get(kind);
  if (cached) return cached;
  const sprite = SPRITES[kind];
  const paths = { tail: new Path2D(sprite.tail), body: new Path2D(sprite.body) };
  cache.set(kind, paths);
  return paths;
}

/**
 * Draw the run's arrow sprite at `(x, y)`, facing `heading`, scaled to a world
 * radius of `worldRadius` and tinted with the skin's body/tail colours. The
 * caller has already mapped world units to canvas px via `scale`.
 */
export function drawArrowSprite(
  ctx: CanvasRenderingContext2D,
  kind: ArrowKind,
  x: number,
  y: number,
  heading: number,
  scale: number,
  worldRadius: number,
  bodyColor: string,
  tailColor: string,
) {
  const { tail, body } = pathsFor(kind);
  const size = worldRadius * scale * 2;
  ctx.save();
  ctx.translate(x, y);
  // The sprite points up; the engine's heading is a canvas angle, so add 90deg.
  ctx.rotate(heading + Math.PI / 2);
  ctx.scale(size / SPRITE_SIZE, size / SPRITE_SIZE);
  ctx.translate(-SPRITE_SIZE / 2, -SPRITE_TIP_Y);
  // A soft glow behind the body so the arrow reads against bright walls.
  ctx.shadowColor = bodyColor;
  ctx.shadowBlur = 6;
  ctx.fillStyle = tailColor;
  ctx.strokeStyle = tailColor;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fill(tail);
  ctx.stroke(tail);
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = bodyColor;
  ctx.fill(body);
  ctx.stroke(body);
  ctx.restore();
}
