import React from "react";

import { Button } from "@/components/ui/button";
import {
  GameRenderer,
  type GameBackground,
  type RendererFrame,
  ensureSkins,
  gameArrowType,
  webgl2Available,
} from "@/lib/game-renderer";
import { decodeInputSymbols } from "@/lib/replay";
import { arrowConstants, createReplayEngine, type RawLevelData } from "@/lib/replay-sim";

interface GameCanvasProps {
  data: RawLevelData | null | undefined;
  inputs: string;
  inputCount?: number;
  arrowName?: string | null;
  background?: GameBackground;
  className?: string;
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
 */
export function GameCanvas({
  data,
  inputs,
  inputCount,
  arrowName,
  background = "grid",
  className,
}: GameCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const [totalTicks, setTotalTicks] = React.useState(0);

  // Read by the animation loop, which lives outside React's render cycle.
  const playingRef = React.useRef(true);
  playingRef.current = playing;

  const symbols = React.useMemo(
    () => (inputs ? decodeInputSymbols(inputs, inputCount) : []),
    [inputs, inputCount],
  );

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || symbols.length === 0) return;
    if (!webgl2Available()) {
      setError("This browser does not support WebGL2, which the game renderer needs.");
      return;
    }

    let cancelled = false;
    let raf = 0;
    let engine: Awaited<ReturnType<typeof createReplayEngine>> = null;
    let renderer: GameRenderer | null = null;
    let cursor = 0;
    let acc = 0;
    let last = 0;
    const trail: Array<{ x: number; y: number }> = [];
    const TICK_MS = 1000 / 240;
    const TRAIL_MAX = 2000;

    (async () => {
      await ensureSkins();
      engine = await createReplayEngine(data, arrowName);
      if (cancelled) {
        engine?.free();
        return;
      }
      if (!engine) {
        setError("The replay engine could not be initialised for this level.");
        return;
      }

      renderer = new GameRenderer(canvas, { preset: "normal" });
      setTotalTicks(symbols.length);

      const frame = (now: number) => {
        if (cancelled || !engine) return;
        if (!last) last = now;
        const dt = Math.min(100, now - last);
        last = now;

        // Advance at the engine's own 240Hz rate regardless of display refresh,
        // so a 120Hz screen plays the run at the same speed as a 60Hz one.
        if (playingRef.current) {
          acc += dt;
          while (acc >= TICK_MS && cursor < symbols.length) {
            engine.step(symbols[cursor]);
            cursor += 1;
            acc -= TICK_MS;
            // `pose()` reads only the pose out of the state string; `read()`
            // would JSON.parse the whole map on every 240Hz tick.
            const p = engine.pose();
            trail.push({ x: p.x, y: p.y });
            if (trail.length > TRAIL_MAX) trail.shift();
          }
        }

        const parent = canvas.parentElement;
        const cssW = parent?.clientWidth || canvas.clientWidth || 640;
        const cssH = parent?.clientHeight || canvas.clientHeight || 360;
        const size = renderer!.resize(cssW, cssH);

        const state = engine.readFull();
        const player = state.player;

        renderer!.draw(
          {
            player: {
              translation: player.translation,
              // The engine's rotation already has 0 = up, which is what the
              // renderer expects; do not apply the -90° the sampled path uses.
              rotation: player.rotation,
              velocity: player.velocity ?? { x: 0, y: 0 },
              thrust_power: player.thrust_power,
              constants: { radius: arrowConstants(arrowName).radius },
            },
            map: (state.map ?? null) as RendererFrame["map"],
            effects: state.effects,
            trail,
            arrowType: gameArrowType(arrowName),
            background,
          },
          size,
          now,
        );

        setTick(cursor);

        if (cursor >= symbols.length) {
          playingRef.current = false;
          setPlaying(false);
        }
        raf = requestAnimationFrame(frame);
      };

      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
      renderer = null;
      engine?.free();
      engine = null;
    };
  }, [data, symbols, arrowName, background]);

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
      <div className="rounded-lg overflow-hidden border border-white/10 bg-[#07070b]">
        <canvas ref={canvasRef} className="w-full block" style={{ height: 420 }} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <span className="font-mono text-[11px] text-slate-400">
          {(tick / 240).toFixed(3)}s
          <span className="text-slate-600"> / {(totalTicks / 240).toFixed(3)}s</span>
        </span>
      </div>
    </div>
  );
}
