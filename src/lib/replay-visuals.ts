/**
 * Visual vocabulary for the replay canvas, matched to the real game.
 *
 * Colours are sampled from the official level renders the game itself produces
 * (`api.narrowarrow.xyz/level-image/<id>.png`, drawn with the same engine), and
 * from the shaders/icons shipped in the v2.4.8 Android APK
 * (`assets/flutter_assets/assets/{shaders,images,skins}`). The game draws
 * neutral walls white on black, death walls red, a checkered finish line, and
 * tints zones by effect rather than by level.
 */

export type ObstacleKind = "wall" | "zone" | "portal" | "finish" | "trigger";

export interface WallVisual {
  /** Stroke colour (also the fill tint for zones). */
  color: string;
  kind: ObstacleKind;
  /** Line weight in canvas px, before camera scaling. */
  width: number;
}

/** Engine obstacle type -> how the game draws it. */
const VISUALS: Record<string, WallVisual> = {
  // Walls. Colours sampled from the game's own level renders
  // (`api.narrowarrow.xyz/level-image/<id>.png`): normal walls white, death
  // red, bouncy green, boost blue.
  normal: { color: "#ffffff", kind: "wall", width: 1.6 },
  death: { color: "#ff2020", kind: "wall", width: 2.2 },
  bouncy: { color: "#33ff33", kind: "wall", width: 2.2 },
  boost: { color: "#1188ff", kind: "wall", width: 2.2 },
  // Zones (filled areas, not lines).
  ice: { color: "#2b4d80", kind: "zone", width: 2 },
  rail: { color: "#6b4d80", kind: "zone", width: 2 },
  nosteer: { color: "#ff6611", kind: "zone", width: 2 },
  steer: { color: "#1188ff", kind: "zone", width: 2 },
  // Portals and the finish line.
  portal: { color: "#ff6611", kind: "portal", width: 2.4 },
  finish: { color: "#ffffff", kind: "finish", width: 5 },
  // Site-only accelerator wire.
  accelerator: { color: "#22d3ee", kind: "trigger", width: 2.4 },
};

/** Deterministic hue for a type we have no explicit colour for. */
function hashHue(type: string): number {
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) % 360;
  return h;
}

/** Resolve a `wall_type`/`zone_type` to its game visual. */
export function wallVisual(type: string): WallVisual {
  return VISUALS[type] ?? { color: `hsl(${hashHue(type)} 70% 62%)`, kind: "wall", width: 1.8 };
}

/** Skin config attached to every run; drives arrow/trail/thrust colours. */
export interface SkinConfig {
  themeColor?: { name?: string; code?: string | number };
  thrustColor?: { name?: string; code?: string | number };
  trailColor?: { name?: string; code?: string | number };
  thrustShader?: { name?: string };
  trailShader?: { name?: string };
}

/**
 * Parse a skin colour value. The API mixes formats: `"#RRGGBB"`, `"0xRRGGBB"`,
 * `"0xFFRRGGBB"` and bare integers like `11579568`.
 */
export function parseSkinColor(value: string | number | undefined, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value === "number") return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
  const raw = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{8}$/i.test(raw)) return `#${raw.slice(3)}`;
  if (/^0x[0-9a-f]{6}$/i.test(raw)) return `#${raw.slice(2)}`;
  if (/^0x[0-9a-f]{8}$/i.test(raw)) return `#${raw.slice(4)}`;
  return fallback;
}

/** The run's arrow body colour (the white part of the sprite is tinted). */
export function themeColor(skin: SkinConfig | null | undefined): string {
  return parseSkinColor(skin?.themeColor?.code, "#ffffff");
}

/** The run's trail colour. */
export function trailColor(skin: SkinConfig | null | undefined): string {
  return parseSkinColor(skin?.trailColor?.code, "#808080");
}

/** The run's thrust/exhaust colour. */
export function thrustColor(skin: SkinConfig | null | undefined): string {
  return parseSkinColor(skin?.thrustColor?.code, "#bfbfbf");
}

/** Mix a hex colour toward white by `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Hex + alpha as an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
