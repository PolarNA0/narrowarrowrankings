/**
 * Ghost overlays for the TAS replay compare view. A ghost is another run of the
 * same level played back at the same time, so several attempts can be watched
 * against each other. Colours are distinct, readable on the dark stage, and
 * deliberately avoid the finish-line green so a ghost can't be mistaken for it.
 */

export const GHOST_PALETTE = [
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#a78bfa",
  "#fb923c",
  "#2dd4bf",
  "#f87171",
  "#4ade80",
] as const;

/** A ghost's colour, cycling the palette so any number of overlays stay distinct. */
export function ghostColor(index: number): string {
  return GHOST_PALETTE[index % GHOST_PALETTE.length];
}
