import React from "react";

import {
  GameRenderer,
  type GameBackground,
  type RendererFrame,
  ensureSkins,
  gameArrowType,
  webgl2Available,
} from "@/lib/game-renderer";
import { drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import { decodeInputSymbols } from "@/lib/replay";
import {
  arrowConstants,
  createReplayEngine,
  type RawLevelData,
  type SimResult,
} from "@/lib/replay-sim";

/** Another run drawn on the WebGL stage as a ghost. */
export interface GameGhost {
  id: string;
  sim: SimResult;
  color: string;
  arrow: ArrowKind;
  arrowRadius: number;
  label?: string;
}

interface GameCanvasProps {
  data: RawLevelData | null | undefined;
  inputs: string;
  inputCount?: number;
  arrowName?: string | null;
  background?: GameBackground;
  className?: string;
  /**
   * Colour overrides for the arrow body / thrust / trail (hex strings). An
   * omitted field keeps the run's own skin colour.
   */
  colors?: { body?: string; thrust?: string; trail?: string };
  /** Ghost runs to draw over the scene, tinted and labelled like the 2D stage. */
  ghosts?: GameGhost[];
  /** Height of the stage in CSS px. */
  height?: number;
  /** Show the collision hitbox (the game always does; off for a clean look). */
  showHitbox?: boolean;
}

/**
 * Replay playback through the game's own WebGL renderer.
 *
 * The site's older `ReplayViewer` canvas draws a schematic; this plays the run
 * with the real engine's shaders (walls, finish checker, portals, thrust, the
 * animated backgrounds), the real camera model and the game's arrow sprites.
 * The physics was already the real WASM engine, so this is purely a fidelity
 * upgrade for how the run looks.
 *
 * It steps a private engine instance rather than replaying the site's sampled
 * `path`: the renderer reads the live obstacle list and the per-tick effects
 * (wall contact, thrust), which only the engine has, and that is what makes
 * rotating walls and portals animate in step with the physics.
 *
 * Playback is driven from the *parent's* transport (the shared play/pause,
 * scrubber and speed) through {@link GameCanvasHandle}, so the viewer keeps a
 * single set of controls rather than this stage growing its own.
 */
export interface GameCanvasHandle {
  /** Render the run at `frame`, stepping the private engine to match. */
  render(frame: number): void;
}

export const GameCanvas = React.forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  {
    data,
    inputs,
    inputCount,
    arrowName,
    background = "grid",
    className,
    colors,
    ghosts,
    height = 340,
    showHitbox = true,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Live refs so the imperative render reads current values without being
  // re-created (and without re-rendering the tree per frame).
  const colorsRef = React.useRef(colors);
  colorsRef.current = colors;
  const ghostsRef = React.useRef(ghosts);
  ghostsRef.current = ghosts;
  const showHitboxRef = React.useRef(showHitbox);
  showHitboxRef.current = showHitbox;

  const symbols = React.useMemo(
    () => (inputs ? decodeInputSymbols(inputs, inputCount) : []),
    [inputs, inputCount],
  );

  // Engine/renderer state, shared by the init effect and the imperative render.
  const engineRef = React.useRef<Awaited<ReturnType<typeof createReplayEngine>>>(null);
  const rendererRef = React.useRef<GameRenderer | null>(null);
  const cursorRef = React.useRef(0);
  const trailRef = React.useRef<Array<{ x: number; y: number }>>([]);
  // The frame the parent last asked for. The engine/renderer are built async, so
  // a scrub that arrives before they are ready is remembered and drawn once they
  // are, instead of snapping back to frame 0.
  const wantRef = React.useRef(0);
  const symbolsRef = React.useRef(symbols);
  symbolsRef.current = symbols;
  const arrowNameRef = React.useRef(arrowName);
  arrowNameRef.current = arrowName;
  const backgroundRef = React.useRef(background);
  backgroundRef.current = background;

  const TRAIL_MAX = 2000;

  /** Step the private engine forward to `target`, rebuilding on a rewind. */
  const stepTo = React.useCallback((target: number) => {
    const engine = engineRef.current;
    const syms = symbolsRef.current;
    if (!engine) return;
    let cursor = cursorRef.current;
    if (target < cursor) {
      // A scrub backwards re-runs from the spawn; replays are short enough that
      // this is cheaper than maintaining a snapshot cache.
      engine.reset();
      cursor = 0;
      trailRef.current = [];
    }
    while (cursor < target && cursor < syms.length) {
      engine.step(syms[cursor]);
      cursor += 1;
      const p = engine.pose();
      trailRef.current.push({ x: p.x, y: p.y });
      if (trailRef.current.length > TRAIL_MAX) trailRef.current.shift();
    }
    cursorRef.current = cursor;
  }, []);

  /**
   * Ghosts are drawn on a transparent 2D canvas stacked over the GL canvas,
   * using the GL camera's own projection so they line up with the scene. The
   * overlay is sized to the GL backing store (device px), so the projection is
   * identical to `gl.project`.
   */
  const paintGhosts = React.useCallback((size: { width: number; height: number }) => {
    const overlay = overlayRef.current;
    const renderer = rendererRef.current;
    if (!overlay || !renderer) return;
    const list = ghostsRef.current ?? [];
    if (overlay.width !== size.width || overlay.height !== size.height) {
      overlay.width = size.width;
      overlay.height = size.height;
    }
    const g = overlay.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, size.width, size.height);
    if (list.length === 0) return;
    const cam = renderer.camera;
    const { width: W, height: H } = size;
    const tx = (x: number) => W / 2 + (x - cam.x) * cam.zoom;
    const ty = (y: number) => H / 2 + (y - cam.y) * cam.zoom;
    const upto = cursorRef.current;
    for (const ghost of list) {
      const gp = ghost.sim.path;
      if (gp.length < 2) continue;
      const end = Math.max(0, Math.min(upto, gp.length - 1));
      g.save();
      g.globalAlpha = 0.5;
      g.strokeStyle = ghost.color;
      g.lineWidth = 2;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      for (let i = 0; i <= end; i++) {
        const p = gp[i];
        if (i === 0) g.moveTo(tx(p.x), ty(p.y));
        else g.lineTo(tx(p.x), ty(p.y));
      }
      g.stroke();
      g.restore();
      const p = gp[end];
      g.save();
      g.globalAlpha = 0.6;
      drawArrowSprite(
        g,
        ghost.arrow,
        tx(p.x),
        ty(p.y),
        p.rot,
        cam.zoom,
        ghost.arrowRadius,
        ghost.color,
        ghost.color,
      );
      g.restore();
      if (ghost.label) {
        g.font = "bold 10px ui-monospace, monospace";
        g.fillStyle = ghost.color;
        g.fillText(ghost.label, tx(p.x) + 9, ty(p.y) - 9);
      }
    }
  }, []);

  /** Draw the current frame: the GL scene, then the ghost overlay on top. */
  const paint = React.useCallback(
    (snap = false) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      const engine = engineRef.current;
      if (!canvas || !renderer || !engine) return;
      const parent = canvas.parentElement;
      const cssW = parent?.clientWidth || canvas.clientWidth || 640;
      const cssH = parent?.clientHeight || canvas.clientHeight || height;
      const size = renderer.resize(cssW, cssH);

      const state = engine.readFull();
      const player = state.player;
      renderer.draw(
        {
          player: {
            translation: player.translation,
            // The engine's rotation already has 0 = up, which is what the
            // renderer expects; do not apply the -90° the sampled path uses.
            rotation: player.rotation,
            velocity: player.velocity ?? { x: 0, y: 0 },
            thrust_power: player.thrust_power,
            constants: { radius: arrowConstants(arrowNameRef.current).radius },
          },
          map: (state.map ?? null) as RendererFrame["map"],
          effects: state.effects,
          trail: trailRef.current,
          arrowType: gameArrowType(arrowNameRef.current),
          background: backgroundRef.current,
          colors: colorsRef.current,
          showHitbox: showHitboxRef.current,
          snap,
        },
        size,
        performance.now(),
      );

      paintGhosts(size);
    },
    [height, paintGhosts],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      render: (target: number) => {
        const max = Math.max(0, symbolsRef.current.length - 1);
        const clamped = Math.max(0, Math.min(Math.floor(target), max));
        wantRef.current = clamped;
        const rewound = clamped < cursorRef.current;
        stepTo(clamped);
        paint(rewound);
      },
    }),
    [stepTo, paint],
  );

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || symbols.length === 0) return;
    if (!webgl2Available()) {
      setError("This browser does not support WebGL2, which the game renderer needs.");
      return;
    }

    let cancelled = false;

    (async () => {
      await ensureSkins();
      const engine = await createReplayEngine(data, arrowName);
      if (cancelled) {
        engine?.free();
        return;
      }
      if (!engine) {
        setError("The replay engine could not be initialised for this level.");
        return;
      }
      engineRef.current = engine;
      cursorRef.current = 0;
      trailRef.current = [];
      rendererRef.current = new GameRenderer(canvas, { preset: "normal" });
      // Draw the frame the parent last asked for (0 on a fresh open, or the
      // scrub position if the user moved before the renderer was ready); the
      // parent's transport drives every frame after.
      stepTo(wantRef.current);
      paint(true);
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      engineRef.current?.free();
      engineRef.current = null;
    };
  }, [data, symbols, arrowName, paint, stepTo]);

  // Re-render when the colour/ghost props change so the choice applies at once,
  // even while paused.
  React.useEffect(() => {
    paint(false);
  }, [colors, ghosts, showHitbox, paint]);

  if (error) {
    return (
      <div className={className}>
        <div className="rounded-lg border border-white/10 bg-[#07070b] p-6 text-sm text-slate-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-[#07070b]">
        <canvas ref={canvasRef} className="w-full block" style={{ height }} />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden
        />
      </div>
    </div>
  );
});
