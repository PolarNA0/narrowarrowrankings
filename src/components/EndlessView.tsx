/**
 * Endless mode: drive a generated course for as long as you can, scoring one
 * point per section passed. It reuses the Play tab's machinery — the real
 * physics engine stepped at a fixed 240Hz by {@link PlayGame}, and the same
 * follow-camera canvas ({@link PlayCanvas}) — so it plays exactly like Play, but
 * the course never ends and the score is sections survived, not time.
 *
 * The course is generated from a seed ({@link buildEndlessCourse}); the same
 * seed always yields the same course, so a run is reproducible.
 */

import * as React from "react";
import {
  Gamepad2,
  Play,
  Pause,
  RotateCcw,
  Dices,
  Trophy,
  Infinity as InfinityIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayCanvas, type PlayCanvasHandle, type PlayFrame } from "@/components/PlayCanvas";
import { DEFAULT_GAME_CAMERA } from "@/lib/replay-render";
import { PlayGame, type PlayResult } from "@/lib/play-game";
import { buildEndlessCourse, type EndlessCourse } from "@/lib/endless";
import {
  DEFAULT_INPUT_SETTINGS,
  firstConnectedGamepad,
  loadInputSettings,
  resolveGamepad,
  resolveKeyboard,
  symbolFromHeld,
  type PlayInputSettings,
} from "@/lib/play-input";
import { SIM_TICK_MS, arrowConstants } from "@/lib/replay-sim";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";
import { themeColor, trailColor } from "@/lib/replay-visuals";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return m > 0 ? `${m}:${s}` : `${s}s`;
}

export function EndlessView() {
  const [seedText, setSeedText] = React.useState("1");
  const [arrowName, setArrowName] = React.useState<string>(ARROWS[0]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [phase, setPhase] = React.useState<string>("idle");
  const [score, setScore] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const [best, setBest] = React.useState(0);

  const gameRef = React.useRef<PlayGame | null>(null);
  const canvasRef = React.useRef<PlayCanvasHandle | null>(null);
  const courseRef = React.useRef<EndlessCourse | null>(null);
  const geometryRef = React.useRef<PlayGame["geometry"]>({ walls: [], zones: [], portals: [] });
  const loadSeqRef = React.useRef(0);

  const heldRef = React.useRef<Set<string>>(new Set());
  const touchRef = React.useRef({ left: false, right: false });
  const inputSymbolRef = React.useRef(0);
  const markerIdxRef = React.useRef(0);
  const scoreRef = React.useRef(0);
  const settingsRef = React.useRef<PlayInputSettings>(DEFAULT_INPUT_SETTINGS);

  const arrow: ArrowKind = arrowKind(arrowName);
  const arrowRadius = arrowConstants(arrowName).radius ?? 16;
  const skinColors = React.useMemo(() => ({ body: themeColor(null), trail: trailColor(null) }), []);

  const sampleInput = React.useCallback((): number => {
    const s = settingsRef.current;
    const kSym = resolveKeyboard(s, heldRef.current);
    const pad = resolveGamepad(s, firstConnectedGamepad());
    const left =
      kSym === 2 || kSym === 3 || pad.symbol === 2 || pad.symbol === 3 || touchRef.current.left;
    const right =
      kSym === 1 || kSym === 3 || pad.symbol === 1 || pad.symbol === 3 || touchRef.current.right;
    const brake = kSym === 3 || pad.brake;
    const symbol = symbolFromHeld(left, right, brake);
    inputSymbolRef.current = symbol;
    return symbol;
  }, []);

  const resetScore = () => {
    markerIdxRef.current = 0;
    scoreRef.current = 0;
    setScore(0);
  };

  const loadCourse = React.useCallback(
    async (seed: number, arrowToUse: string) => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const course = buildEndlessCourse({ seed });
        gameRef.current?.free();
        const game = new PlayGame({
          data: course.data,
          arrowName: arrowToUse,
          sampleInput,
          onEnd: (r: PlayResult) => {
            setPhase(game.phase);
            setTick(game.tick);
            if (!r.finished) {
              setBest((prev) => {
                const next = Math.max(prev, scoreRef.current);
                try {
                  window.localStorage.setItem("endless:best", String(next));
                } catch {
                  /* storage blocked — the best just isn't kept */
                }
                return next;
              });
            }
          },
        });
        const ok = await game.load();
        if (seq !== loadSeqRef.current) {
          game.free();
          return;
        }
        if (!ok) throw new Error("Physics engine failed to initialise");
        gameRef.current = game;
        courseRef.current = course;
        geometryRef.current = game.geometry;
        resetScore();
        setTick(0);
        setPhase("idle");
        canvasRef.current?.redraw();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        gameRef.current = null;
      } finally {
        setLoading(false);
      }
    },
    [sampleInput],
  );

  React.useEffect(() => {
    settingsRef.current = loadInputSettings();
    try {
      const stored = Number(window.localStorage.getItem("endless:best") ?? "0");
      if (Number.isFinite(stored)) setBest(stored);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    void loadCourse(1, ARROWS[0]);
    // Load once on mount; the seed/arrow controls reload explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the frame loop -------------------------------------------------------

  React.useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastUi = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const game = gameRef.current;
      if (!game) return;
      const dt = last ? Math.min(100, ts - last) : 1000 / 60;
      last = ts;

      const ran = game.advance(dt);
      if (ran > 0) {
        // Score increments the moment the arrow passes a section boundary. The
        // arrow only ever moves forward, so a simple forward scan is enough.
        const p = game.current;
        const markers = courseRef.current?.markers;
        if (p && markers) {
          while (markerIdxRef.current < markers.length && p.y <= markers[markerIdxRef.current].y) {
            markerIdxRef.current++;
            scoreRef.current++;
          }
        }
        canvasRef.current?.redraw();
      }
      if (ts - lastUi > 50 || game.phase !== phase) {
        lastUi = ts;
        setTick(game.tick);
        setPhase(game.phase);
        setScore((prev) => (prev === scoreRef.current ? prev : scoreRef.current));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // ---- keyboard -------------------------------------------------------------

  React.useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = settingsRef.current;
      const code = e.code;
      const binds = [s.keybinds.left, s.keybinds.right, s.keybinds.brake];
      if (!binds.includes(code)) return;
      e.preventDefault();
      if (e.repeat) return;
      heldRef.current.add(code);
    };
    const up = (e: KeyboardEvent) => heldRef.current.delete(e.code);
    const blur = () => heldRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ---- run control ----------------------------------------------------------

  const togglePause = () => {
    const game = gameRef.current;
    if (!game) return;
    if (game.phase === "idle" || game.phase === "dead") {
      resetScore();
      game.restart();
    } else if (game.phase === "running") {
      game.pause();
    } else if (game.phase === "paused") {
      game.resume();
    }
    setPhase(game.phase);
    setTick(game.tick);
  };

  const newCourse = () => {
    const seed = Math.floor(Math.random() * 1_000_000);
    setSeedText(String(seed));
    void loadCourse(seed, arrowName);
  };

  const applySeed = () => {
    const seed = Math.max(1, Math.floor(Number(seedText) || 1));
    setSeedText(String(seed));
    void loadCourse(seed, arrowName);
  };

  const getFrame = React.useCallback((): PlayFrame => {
    const game = gameRef.current;
    return {
      path: game?.path ?? [],
      pathTicks: game?.pathTicks,
      tick: game?.tick ?? 0,
      input: inputSymbolRef.current,
    };
  }, []);

  const dead = phase === "dead";
  const running = phase === "running";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <InfinityIcon className="w-5 h-5 text-[var(--app-accent)]" /> Endless
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          Survive a generated course for as long as you can — one point per section passed. Tap the
          left/right half of the stage on mobile, or the arrow keys on desktop.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-400">Seed</Label>
          <div className="flex gap-2">
            <Input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySeed()}
              className="w-28 font-mono"
              inputMode="numeric"
            />
            <Button variant="outline" size="sm" onClick={applySeed} disabled={loading}>
              Load
            </Button>
            <Button variant="outline" size="sm" onClick={newCourse} disabled={loading}>
              <Dices className="w-4 h-4 mr-1" /> New
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-slate-400">Arrow</Label>
          <Select
            value={arrowName}
            onValueChange={(v) => {
              setArrowName(v);
              void loadCourse(Math.max(1, Math.floor(Number(seedText) || 1)), v);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARROWS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-slate-400">Score</div>
            <div className="font-mono text-2xl font-bold text-[var(--app-accent)] leading-none">
              {score}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Time</div>
            <div className="font-mono text-lg leading-none">
              {fmtTime((tick * SIM_TICK_MS) / 1000)}
            </div>
          </div>
          {best > 0 && (
            <div className="text-right">
              <div className="text-xs text-slate-400">Best</div>
              <div className="font-mono text-lg leading-none flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                {best}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        <PlayCanvas
          ref={canvasRef}
          geometry={geometryRef.current}
          getFrame={getFrame}
          arrow={arrow}
          arrowRadius={arrowRadius}
          bodyColor={skinColors.body}
          tailColor={skinColors.trail}
          trailColor={skinColors.trail}
          cameraSettings={DEFAULT_GAME_CAMERA}
          height={520}
        />

        {loading && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/60">
            <span className="text-sm text-slate-300 animate-pulse">Building course…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/70 p-4 text-center">
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {dead && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/70">
            <div className="text-center space-y-3">
              <div className="text-sm uppercase tracking-widest text-slate-400">Game over</div>
              <div className="text-5xl font-bold font-mono text-[var(--app-accent)]">{score}</div>
              <div className="text-xs text-slate-400">
                {score === 1 ? "1 section" : `${score} sections`} ·{" "}
                {fmtTime((tick * SIM_TICK_MS) / 1000)}
              </div>
              <Button onClick={togglePause}>
                <RotateCcw className="w-4 h-4 mr-1" /> Retry seed
              </Button>
            </div>
          </div>
        )}

        {phase === "paused" && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/50">
            <Button onClick={togglePause}>
              <Play className="w-4 h-4 mr-1" /> Resume
            </Button>
          </div>
        )}

        {/* Mobile touch zones: left half steers left, right half right. A tap
            while idle also starts the run, so a phone player can go straight
            from the menu into a game. */}
        <div className="absolute inset-0 flex lg:hidden">
          {(["left", "right"] as const).map((side) => (
            <div
              key={side}
              className="flex-1 touch-none select-none"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                touchRef.current[side] = true;
                const game = gameRef.current;
                if (game && game.phase !== "running" && game.phase !== "paused") {
                  resetScore();
                  game.restart();
                  setPhase(game.phase);
                }
              }}
              onPointerUp={() => (touchRef.current[side] = false)}
              onPointerCancel={() => (touchRef.current[side] = false)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button onClick={togglePause} disabled={loading || !!error}>
          {running ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
          {running ? "Pause" : phase === "paused" ? "Resume" : phase === "dead" ? "Retry" : "Start"}
        </Button>
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <Gamepad2 className="w-3.5 h-3.5" /> Tap left/right on mobile · arrow keys on desktop
        </span>
      </div>
    </div>
  );
}
