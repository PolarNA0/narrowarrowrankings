/**
 * Types for the ported renderer. The implementation is a verbatim copy of the
 * game's own renderer, so it stays JS; only the surface the app calls is typed.
 */

export class Camera {
  constructor(opt?: {
    preset?: string;
    zoom?: number;
    dynamicZoom?: number;
    zoomSmoothness?: number;
    moveAhead?: number;
    movementSmoothness?: number;
  });
  x: number;
  y: number;
  zoom: number;
  follow(player: {
    translation: { x: number; y: number };
    velocity: { x: number; y: number };
  }): void;
  update(dt: number): void;
  applySettings(settings: Record<string, unknown>): void;
}

export function loadSkins(): Promise<void>;
export function skinFor(arrowType: string, skinConfig: unknown): unknown;
export function withColorOverrides(
  skin: unknown,
  colors?: { body?: string; thrust?: string; trail?: string },
): unknown;
export function arrowSpriteHalf(arrowType: string, zoom?: number): number;
export function drawLevel(
  r: unknown,
  map: unknown,
  cam: unknown,
  W: number,
  H: number,
  t: number,
  bg?: string,
): void;
export function drawWallEffects(
  r: unknown,
  effects: unknown,
  map: unknown,
  cam: unknown,
  W: number,
  H: number,
  t: number,
): void;
export function drawArrow(
  r: unknown,
  player: unknown,
  arrowType: string,
  cam: unknown,
  W: number,
  H: number,
  t: number,
  alpha?: number,
  effects?: unknown,
  skin?: unknown,
  showHitbox?: boolean,
): void;
export function drawTrajectory(
  r: unknown,
  trail: unknown,
  cam: unknown,
  W: number,
  H: number,
  arrowType: string,
  skin: unknown,
  style?: string | null,
): void;
