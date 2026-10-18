/**
 * Types for the ported renderer. The implementation is a verbatim copy of the
 * game's own renderer, so it stays JS; only the surface the app calls is typed.
 */

export class Renderer {
  constructor(canvas: HTMLCanvasElement);
  setSize(width: number, height: number): void;
  begin(W: number, H: number, t: number, bgVariant: string, cam: unknown): void;
}
