/**
 * The Play tab: a sandbox where a run can actually be driven in the browser.
 *
 * Scope, deliberately: this is a *sandbox*. The physics is the real engine, so a
 * played run reproduces exactly and can be replayed; but the loop advances in
 * wall-clock time, so it is not a verified competitive mode. Finished runs can
 * be posted to the site's own community TAS board (which stores the input string
 * and can replay it) — never to the real game leaderboard, which this site is
 * read-only against.
 *
 * The engine is stepped at a fixed 240Hz; the pose is read once per animation
 * frame (the full-state parse is the expensive part) and the canvas repaints
 * imperatively, so nothing here re-renders React at tick rate.
 */

import * as React from "react";
import {
  Gamepad2,
  Keyboard,
  Play,
  Pause,
  RotateCcw,
  Flag,
  Ghost,
  Send,
  Loader2,
  AlertCircle,
  ChevronRight,
  Bookmark,
  Trash2,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Gauge,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayCanvas, type PlayCanvasHandle } from "@/components/PlayCanvas";
import { CameraSettingsPanel } from "@/components/CameraSettingsPanel";
import { DEFAULT_GAME_CAMERA, type CameraSettings } from "@/lib/replay-render";
import { LevelPicker, siteIdOf } from "@/components/LevelPicker";
import { TasSubmitDialog } from "@/components/TasSubmitDialog";
import { nalvlToRawLevelData, type NalvlLevel } from "@/lib/nalvl";
import { PlayGame, PLAY_SPEEDS, type PlayResult, type Split } from "@/lib/play-game";
import {
  actionForKey,
  DEFAULT_INPUT_SETTINGS,
  firstConnectedGamepad,
  keyLabel,
  loadInputSettings,
  resolveGamepad,
  resolveKeyboard,
  saveInputSettings,
  symbolFromHeld,
  type PlayInputSettings,
} from "@/lib/play-input";
import { decodeInputSymbols, encodeInputSymbols } from "@/lib/replay";
import { fetchSiteLevel } from "@/lib/site-levels";
import {
  listPlayCheckpoints,
  playCheckpointsFor,
  deletePlayCheckpoint,
  savePlayCheckpoint,
  type PlayCheckpoint,
} from "@/lib/play-checkpoints";
import {
  arrowConstants,
  SIM_TICK_MS,
  simulateRun,
  type RawLevelData,
  type SimGeometry,
} from "@/lib/replay-sim";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";
import { themeColor, trailColor } from "@/lib/replay-visuals";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;
const LEVELS_URL = "/api/level-details";

interface LevelOption {
  id: string;
  name: string;
}

interface GhostRun {
  label: string;
  timeMs: number;
  path: {
    x: number;
    y: number;
    rot: number;
    finished?: boolean;
    thrustPower?: number;
    input?: number;
  }[];
}

type GhostChoice = "none" | "pb" | "wr";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

const bestKey = (levelId: string, arrow: string) => `naPlayBest:${levelId}:${arrow}`;

/** The pseudo-level id used when playing a level authored in the editor. */
const SITE_LEVEL_ID = "__site__";

/**
 * Site-level handoffs already auto-selected. Module-level so a later visit to
 * the Play tab defaults to the normal level list instead of snapping back to
 * the editor level — the level stays pickable under "In-memory" either way.
 */
const consumedSiteKeys = new Set<string>();

interface StoredBest {
  inputs: string;
  inputCount: number;
  timeMs: number;
}

function loadBest(levelId: string, arrow: string): StoredBest | null {
  try {
    const raw = window.localStorage.getItem(bestKey(levelId, arrow));
    return raw ? (JSON.parse(raw) as StoredBest) : null;
  } catch {
    return null;
  }
}

export function PlayView({
  levels,
  focus,
  onFocusHandled,
  siteLevel,
  onSelectionChange,
}: {
  levels: LevelOption[];
  /** A checkpoint handed over from a TAS viewer, to load and play immediately. */
  focus?: { levelId: string; arrowName: string; tick: number; key: string } | null;
  onFocusHandled?: () => void;
  /**
   * A level authored in the editor, handed over to play in place. It is played
   * from the in-memory payload — no import, no server round-trip — and shows up
   * as a pseudo-entry in the level list.
   */
  siteLevel?: { level: NalvlLevel; key: string } | null;
  /**
   * Reports the level+arrow now loaded, so the shell can keep the URL pointing
   * at what is on screen (a site level is then a shareable link).
   */
  onSelectionChange?: (levelId: string, arrowName: string) => void;
}) {
  const [levelId, setLevelId] = React.useState(levels[0]?.id ?? "");
  const [levelName, setLevelName] = React.useState(levels[0]?.name ?? "");
  const siteLevelRef = React.useRef<{ level: NalvlLevel; data: RawLevelData } | null>(null);
  const [siteRevision, setSiteRevision] = React.useState(0);
  const [arrowName, setArrowName] = React.useState<string>(ARROWS[0]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [phase, setPhase] = React.useState<string>("idle");
  const [tick, setTick] = React.useState(0);
  const [countdown, setCountdown] = React.useState(0);
  const [speed, setSpeed] = React.useState(1);
  const [splits, setSplits] = React.useState<Split[]>([]);
  const [checkpoints, setCheckpoints] = React.useState<number[]>([]);
  const [result, setResult] = React.useState<PlayResult | null>(null);
  const [best, setBest] = React.useState<StoredBest | null>(null);

  const [ghostChoice, setGhostChoice] = React.useState<GhostChoice>("none");
  const [ghost, setGhost] = React.useState<GhostRun | null>(null);
  const [ghostBusy, setGhostBusy] = React.useState(false);
  const [wrTimeMs, setWrTimeMs] = React.useState<number | null>(null);

  const [settings, setSettings] = React.useState<PlayInputSettings>(DEFAULT_INPUT_SETTINGS);
  const [showSettings, setShowSettings] = React.useState(false);
  const [submitOpen, setSubmitOpen] = React.useState(false);

  // Fullscreen play: an immersive overlay with a big canvas, a top-centre clock,
  // a pause button whose popover carries the camera settings, and an exit button.
  const [fullscreen, setFullscreen] = React.useState(false);
  const [cameraSettings, setCameraSettings] = React.useState<CameraSettings>(DEFAULT_GAME_CAMERA);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  // True while a "press a key" capture is armed, so Escape hands the key to the
  // capture instead of leaving fullscreen.
  const keybindCaptureRef = React.useRef(false);

  const [savedCheckpoints, setSavedCheckpoints] = React.useState<PlayCheckpoint[]>([]);
  // A checkpoint the level load should resume from once the engine is ready.
  const pendingCheckpointRef = React.useRef<PlayCheckpoint | null>(null);
  const focusKeyRef = React.useRef<string | null>(null);
  // Set when a handoff asks for the run to begin as soon as the level loads
  // (e.g. the editor's "Open in Play"), so the clock starts without a Start click.
  const autoStartRef = React.useRef(false);

  const gameRef = React.useRef<PlayGame | null>(null);
  const canvasRef = React.useRef<PlayCanvasHandle | null>(null);
  // The countdown digit last pushed into state, so the loop only re-renders when
  // it actually ticks over (the loop closure otherwise compares against state).
  const countdownRef = React.useRef(0);
  // Bumped on every load so a stale (superseded) load can't clobber the engine
  // when the level/arrow changes again before its fetch resolves.
  const loadSeqRef = React.useRef(0);
  const geometryRef = React.useRef<SimGeometry>({ walls: [], zones: [], portals: [] });
  const levelDataRef = React.useRef<RawLevelData | null>(null);
  const heldRef = React.useRef<Set<string>>(new Set());
  const touchRef = React.useRef({ left: false, right: false });
  const inputSymbolRef = React.useRef(0);
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;
  const ghostPathRef = React.useRef<GhostRun["path"] | null>(null);
  ghostPathRef.current = ghost?.path ?? null;
  const checkpointRef = React.useRef<number[]>([]);
  checkpointRef.current = checkpoints;
  const padButtonsRef = React.useRef<{ checkpoint: boolean; restart: boolean }>({
    checkpoint: false,
    restart: false,
  });

  const arrow: ArrowKind = arrowKind(arrowName);
  const arrowRadius = arrowConstants(arrowName).radius ?? 16;
  const skinColors = React.useMemo(
    () => ({
      body: themeColor(null),
      trail: trailColor(null),
    }),
    [],
  );

  // ---- input sampling -------------------------------------------------------

  const sampleInput = React.useCallback((): number => {
    const s = settingsRef.current;
    const kSym = resolveKeyboard(s, heldRef.current);
    const pad = resolveGamepad(s, firstConnectedGamepad());
    const kLeft = kSym === 2 || kSym === 3;
    const kRight = kSym === 1 || kSym === 3;
    const pLeft = pad.symbol === 2 || pad.symbol === 3;
    const pRight = pad.symbol === 1 || pad.symbol === 3;
    const left = kLeft || pLeft || touchRef.current.left;
    const right = kRight || pRight || touchRef.current.right;
    const brake = kSym === 3 || pad.brake;
    const symbol = symbolFromHeld(left, right, brake);
    inputSymbolRef.current = symbol;
    return symbol;
  }, []);

  // ---- level loading --------------------------------------------------------

  const loadLevel = React.useCallback(
    async (id: string, arrowToUse: string) => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        let data: RawLevelData | null;
        if (id === SITE_LEVEL_ID && siteLevelRef.current) {
          // A level authored in the editor: play the in-memory payload directly,
          // with no import and no server round-trip.
          data = siteLevelRef.current.data;
        } else if (siteIdOf(id)) {
          // A published site level: its payload lives on the site, so it loads
          // through our own API rather than the upstream level endpoint.
          const res = await fetch(`/api/site-levels/${encodeURIComponent(siteIdOf(id)!)}`, {
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) throw new Error(`Site level request failed (${res.status})`);
          const payload = (await res.json()) as {
            level?: { data?: RawLevelData };
            error?: string;
          };
          if (!payload.level?.data) throw new Error(payload.error ?? "Level has no geometry");
          data = payload.level.data;
        } else {
          const res = await fetch(`${LEVELS_URL}/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) throw new Error(`Level request failed (${res.status})`);
          const payload = (await res.json()) as { levelInfo?: { data?: RawLevelData } };
          data = payload.levelInfo?.data ?? null;
          if (!data) throw new Error("Level has no geometry");
        }
        if (seq !== loadSeqRef.current) return;

        gameRef.current?.free();
        const game = new PlayGame({
          data,
          arrowName: arrowToUse,
          sampleInput,
          onEnd: (r) => {
            setResult(r);
            setPhase(game.phase);
            setTick(game.tick);
            if (r.finished) handleFinish(r, id, arrowToUse);
          },
        });
        const ok = await game.load();
        if (seq !== loadSeqRef.current) {
          game.free();
          return;
        }
        if (!ok) throw new Error("Physics engine failed to initialise");
        gameRef.current = game;
        levelDataRef.current = data;
        geometryRef.current = game.geometry;
        setTick(0);
        setSplits([]);
        setCheckpoints([]);
        setResult(null);
        setPhase("idle");
        setBest(loadBest(id, arrowToUse));
        setGhost(null);
        setGhostChoice("none");
        setWrTimeMs(null);

        // Resume from a handed-over checkpoint (or one queued while loading).
        const resume = pendingCheckpointRef.current;
        if (resume && resume.levelId === id && resume.arrowName === arrowToUse) {
          pendingCheckpointRef.current = null;
          if (game.playFrom(resume.prefixSymbols)) {
            // Start paused so the player can get ready before the clock runs.
            game.pause();
            setTick(game.tick);
            setCheckpoints(game.checkpointList);
            setPhase(game.phase);
            toast.message(
              `Ready at checkpoint ${fmtTime((resume.tick * SIM_TICK_MS) / 1000)} — press Resume`,
            );
          }
        } else if (autoStartRef.current) {
          // A handoff (e.g. "Open in Play") asked to run straight away.
          autoStartRef.current = false;
          game.restart();
          setCountdown(game.countdown);
          countdownRef.current = game.countdown;
          setPhase(game.phase);
        }
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

  // (Re)load whenever the level or arrow changes. `siteRevision` forces a
  // reload when the editor hands over the same level again after edits.
  React.useEffect(() => {
    if (levelId) void loadLevel(levelId, arrowName);
  }, [levelId, arrowName, siteRevision, loadLevel]);

  // Tell the shell what is loaded, so the URL tracks it. The in-memory editor
  // level has no id to share, so it is not reported.
  React.useEffect(() => {
    if (levelId && levelId !== SITE_LEVEL_ID) onSelectionChange?.(levelId, arrowName);
  }, [levelId, arrowName, onSelectionChange]);

  // A level handed over from the editor: keep its payload in a ref (so the
  // async load can read it without a fetch) and select it. Handing over the
  // same level again after edits bumps `siteRevision` to reload it in place.
  React.useEffect(() => {
    if (!siteLevel) return;
    siteLevelRef.current = { level: siteLevel.level, data: nalvlToRawLevelData(siteLevel.level) };
    // Only auto-select a fresh handoff; a later mount keeps the last selection
    // (the level is still available under "In-memory" in the picker).
    if (consumedSiteKeys.has(siteLevel.key)) return;
    consumedSiteKeys.add(siteLevel.key);
    setLevelId(SITE_LEVEL_ID);
    setLevelName(siteLevel.level.name);
    setSiteRevision((r) => r + 1);
    // "Open in Play" should drop straight into a running run, matching the
    // editor's own Test play, rather than an idle spawn that needs a Start click.
    autoStartRef.current = true;
  }, [siteLevel]);

  // Refresh the saved checkpoints whenever the level or arrow changes, and after
  // any save/delete (bumped through `savedCheckpoints`).
  const refreshSaved = React.useCallback(() => {
    setSavedCheckpoints(playCheckpointsFor(levelId, arrowName));
  }, [levelId, arrowName]);
  React.useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  // A checkpoint handed over from a TAS viewer: switch to its level+arrow and
  // resume from it. If that level+arrow is already loaded the resume is applied
  // here directly; otherwise it is queued for `loadLevel` (the level change
  // re-runs the load effect, which also resets the phase, so applying here would
  // be overwritten).
  React.useEffect(() => {
    if (!focus || focusKeyRef.current === focus.key) return;
    focusKeyRef.current = focus.key;
    // A site level asked to just be opened (its "Play" button): no checkpoint to
    // resume, so switch to it directly. Site levels are not in the `levels`
    // list, so the name has to come from a fetch.
    const siteId = siteIdOf(focus.levelId);
    if (siteId && focus.tick < 0) {
      setLevelId(focus.levelId);
      if (focus.arrowName) setArrowName(focus.arrowName);
      setSiteRevision((r) => r + 1);
      // A bare "open" handoff (a site level's Play button) starts running.
      autoStartRef.current = true;
      void fetchSiteLevel(siteId)
        .then((rec) => {
          if (rec) setLevelName(rec.name);
        })
        .catch(() => {
          /* the loader surfaces any real error */
        });
      onFocusHandled?.();
      return;
    }
    const cp = listPlayCheckpoints().find(
      (c) =>
        c.levelId === focus.levelId && c.arrowName === focus.arrowName && c.tick === focus.tick,
    );
    if (!cp) {
      onFocusHandled?.();
      return;
    }
    const game = gameRef.current;
    if (cp.levelId === levelId && cp.arrowName === arrowName && game) {
      setResult(null);
      if (game.playFrom(cp.prefixSymbols)) {
        game.pause();
        setTick(game.tick);
        setSplits([]);
        setCheckpoints(game.checkpointList);
        setPhase(game.phase);
        canvasRef.current?.redraw();
        toast.message(
          `Ready at checkpoint ${fmtTime((cp.tick * SIM_TICK_MS) / 1000)} — press Resume`,
        );
      }
      onFocusHandled?.();
      return;
    }
    // Different level/arrow: queue the resume and switch, which reloads the level.
    pendingCheckpointRef.current = cp;
    const option = levels.find((l) => l.id === cp.levelId);
    setLevelId(cp.levelId);
    setLevelName(option?.name ?? cp.levelName);
    setArrowName(cp.arrowName);
    onFocusHandled?.();
  }, [focus, levels, onFocusHandled, levelId, arrowName]);

  React.useEffect(() => {
    setSettings(loadInputSettings());
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

      // Gamepad action buttons are edge-triggered here (the engine loop is the
      // natural place to poll them, once per frame).
      const pad = firstConnectedGamepad();
      const gp = resolveGamepad(settingsRef.current, pad);
      if (gp.checkpoint && !padButtonsRef.current.checkpoint) game.setCheckpoint();
      if (gp.restart && !padButtonsRef.current.restart) game.restartFromCheckpoint();
      padButtonsRef.current = { checkpoint: gp.checkpoint, restart: gp.restart };

      const ran = game.advance(dt);
      if (ran > 0) canvasRef.current?.redraw();
      const cd = game.countdown;
      if (ts - lastUi > 50 || game.phase !== phase || cd !== countdownRef.current) {
        lastUi = ts;
        countdownRef.current = cd;
        setCountdown(cd);
        setTick(game.tick);
        setPhase(game.phase);
        // Return the previous array when nothing changed so React bails out of
        // the re-render instead of repainting the whole view ~20x/s.
        const nextSplits = game.splits;
        setSplits((prev) =>
          prev.length === nextSplits.length &&
          prev[prev.length - 1]?.tick === nextSplits[nextSplits.length - 1]?.tick
            ? prev
            : nextSplits.slice(),
        );
        const nextCheckpoints = game.checkpointList;
        setCheckpoints((prev) =>
          prev.length === nextCheckpoints.length &&
          prev[prev.length - 1] === nextCheckpoints[nextCheckpoints.length - 1]
            ? prev
            : nextCheckpoints,
        );
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
      const action = actionForKey(settingsRef.current, e.code);
      if (!action) return;
      e.preventDefault();
      if (e.repeat) return;
      if (action === "checkpoint") {
        gameRef.current?.setCheckpoint();
        return;
      }
      if (action === "restart") {
        gameRef.current?.restartFromCheckpoint();
        return;
      }
      heldRef.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      heldRef.current.delete(e.code);
    };
    const blur = () => {
      heldRef.current.clear();
    };
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

  const handleFinish = (r: PlayResult, id: string, arrowForRun: string) => {
    const timeMs = r.tick * SIM_TICK_MS;
    // A run made at a rate other than 1× is a testing aid, not a speedrun, so it
    // never sets a personal best (the local PB is compared against real runs).
    if (!r.realTime) {
      toast.message(`Finished in ${fmtTime(timeMs / 1000)} at ${r.speed}×`, {
        description: "Only 1× runs count towards your personal best.",
      });
      return;
    }
    const prev = loadBest(id, arrowForRun);
    if (!prev || timeMs < prev.timeMs) {
      const stored: StoredBest = {
        inputs: encodeInputSymbols(r.symbols),
        inputCount: r.symbols.length,
        timeMs,
      };
      try {
        window.localStorage.setItem(bestKey(id, arrowForRun), JSON.stringify(stored));
      } catch {
        /* storage blocked — the PB just isn't kept */
      }
      setBest(stored);
      if (prev) toast.success(`New personal best: ${fmtTime(timeMs / 1000)}`);
      else toast.success(`Finished in ${fmtTime(timeMs / 1000)}`);
    } else {
      toast.message(`Finished in ${fmtTime(timeMs / 1000)}`, {
        description: `PB is ${fmtTime(prev.timeMs / 1000)}`,
      });
    }
  };

  const start = () => {
    const game = gameRef.current;
    if (!game) return;
    game.restart();
    setResult(null);
    setTick(0);
    setSplits([]);
    // `restart` arms the countdown, so the run itself has not begun yet.
    setCountdown(game.countdown);
    countdownRef.current = game.countdown;
    setPhase(game.phase);
  };

  const pauseResume = () => {
    const game = gameRef.current;
    if (!game) return;
    if (game.phase === "running" || game.phase === "countdown") game.pause();
    else if (game.phase === "paused") game.resume();
    else start();
    setPhase(game.phase);
  };

  const restartCheckpoint = () => {
    const game = gameRef.current;
    if (!game) return;
    game.restartFromCheckpoint();
    setResult(null);
    setCountdown(game.countdown);
    countdownRef.current = game.countdown;
    setPhase(game.phase);
  };

  const changeSpeed = (next: number) => {
    const game = gameRef.current;
    game?.setSpeed(next);
    setSpeed(game?.speed ?? next);
  };

  const dropCheckpoint = () => {
    const game = gameRef.current;
    if (!game) return;
    game.setCheckpoint();
    setCheckpoints([...checkpointRef.current]);
    if (game.tick > 0) toast.message(`Checkpoint at ${fmtTime((game.tick * SIM_TICK_MS) / 1000)}`);
  };

  // ---- saved practice checkpoints -------------------------------------------

  const playSaved = (cp: PlayCheckpoint) => {
    const game = gameRef.current;
    if (!game) return;
    // A checkpoint from another level/arrow needs a reload; same level+arrow
    // just re-seeds the live engine.
    if (cp.levelId !== levelId || cp.arrowName !== arrowName) {
      pendingCheckpointRef.current = cp;
      setLevelId(cp.levelId);
      setLevelName(cp.levelName);
      setArrowName(cp.arrowName);
      return;
    }
    setResult(null);
    if (game.playFrom(cp.prefixSymbols)) {
      game.pause();
      setTick(game.tick);
      setSplits([]);
      setCheckpoints(game.checkpointList);
      setPhase(game.phase);
      canvasRef.current?.redraw();
      toast.message(
        `Ready at checkpoint ${fmtTime((cp.tick * SIM_TICK_MS) / 1000)} — press Resume`,
      );
    }
  };

  const saveCurrentAsCheckpoint = () => {
    const game = gameRef.current;
    if (!game || game.tick === 0) return;
    savePlayCheckpoint({
      levelId,
      levelName,
      arrowName,
      tick: game.tick,
      sourceFinishTick: null,
      inputs: encodeInputSymbols(game.recordedSymbols),
      inputCount: game.recordedSymbols.length,
      label: `My run · ${fmtTime((game.tick * SIM_TICK_MS) / 1000)}`,
    });
    refreshSaved();
    toast.success("Checkpoint saved");
  };

  const removeSaved = (id: string) => {
    deletePlayCheckpoint(id);
    refreshSaved();
  };

  // ---- ghosts ---------------------------------------------------------------

  const loadGhost = React.useCallback(
    async (choice: GhostChoice, id: string, arrowForRun: string) => {
      const data = levelDataRef.current;
      if (!data || choice === "none") {
        setGhost(null);
        return;
      }
      setGhostBusy(true);
      try {
        let inputs = "";
        let inputCount: number | undefined;
        let timeMs = 0;
        let label = "";
        if (choice === "pb") {
          const stored = loadBest(id, arrowForRun);
          if (!stored) {
            toast.message("No personal best on this level yet.");
            setGhost(null);
            setGhostChoice("none");
            return;
          }
          inputs = stored.inputs;
          inputCount = stored.inputCount;
          timeMs = stored.timeMs;
          label = "My PB";
        } else {
          const boardRes = await fetch(
            `/api/leaderboard/${encodeURIComponent(id)}?arrowFilter=${encodeURIComponent(arrowForRun)}&limit=1`,
            { signal: AbortSignal.timeout(20000) },
          );
          const board = boardRes.ok
            ? ((await boardRes.json()) as Array<{
                run_id?: number;
                completion_time?: number;
                username?: string;
              }>)
            : [];
          const top = board[0];
          if (!top?.run_id) {
            toast.message("No world record available for this arrow.");
            setGhost(null);
            setGhostChoice("none");
            return;
          }
          const runRes = await fetch(`/api/runs/${top.run_id}`, {
            signal: AbortSignal.timeout(20000),
          });
          if (!runRes.ok) throw new Error("Could not fetch the record run");
          const run = (await runRes.json()) as {
            inputs?: string;
            input_count?: number;
            completion_time?: number;
          };
          inputs = run.inputs ?? "";
          inputCount = run.input_count;
          timeMs = (run.completion_time ?? 0) * 1000;
          label = `${top.username ?? "WR"} WR`;
          setWrTimeMs(timeMs);
        }
        const symbols = decodeInputSymbols(inputs, inputCount);
        const sim = await simulateRun(inputs, inputCount, data, {}, arrowForRun);
        setGhost({ label, timeMs, path: sim.path });
        void symbols;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ghost failed to load");
        setGhost(null);
        setGhostChoice("none");
      } finally {
        setGhostBusy(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    void loadGhost(ghostChoice, levelId, arrowName);
  }, [ghostChoice, levelId, arrowName, loadGhost]);

  const getFrame = React.useCallback(
    () => ({
      path: gameRef.current?.path ?? [],
      pathTicks: gameRef.current?.pathTicks ?? [],
      tick: gameRef.current?.currentTick ?? 0,
      input: inputSymbolRef.current,
      ghostPath: ghostPathRef.current,
      markers: checkpointRef.current,
      timeline: gameRef.current?.timeline,
    }),
    [],
  );

  const runTimeMs = tick * SIM_TICK_MS;
  const deltaMs = ghost ? runTimeMs - ghost.timeMs : null;
  const finishedResult = result?.finished ? result : null;
  // A custom/site board records real speedruns, so a run made at any other rate
  // is routed to the community TAS board instead (which accepts any rate).
  const submitKind: "tas" | "site" = siteIdOf(levelId) && finishedResult?.realTime ? "site" : "tas";

  // Escape leaves fullscreen; locking body scroll keeps the overlay fixed while
  // the page behind it stays put. Escape is ignored while a dialog is open or a
  // keybind is being captured, so those own the key first.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (keybindCaptureRef.current) return;
      if (document.querySelector('[role="dialog"]')) return;
      setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // Keep the canvas centred when the window (or fullscreen) changes size.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onResize = () => canvasRef.current?.redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fullscreen]);

  React.useEffect(() => {
    canvasRef.current?.redraw();
  }, [cameraSettings]);

  const setKeybind = (action: keyof PlayInputSettings["keybinds"]) => {
    const next: PlayInputSettings = {
      ...settings,
      keybinds: { ...settings.keybinds },
    };
    window.addEventListener(
      "keydown",
      (e) => {
        e.preventDefault();
        next.keybinds[action] = e.code;
        setSettings(next);
        saveInputSettings(next);
        keybindCaptureRef.current = false;
      },
      { once: true },
    );
    keybindCaptureRef.current = true;
  };

  // The stage canvas is rendered in two places (inline and the fullscreen
  // overlay). Only one exists at a time, so both share this single ref.
  const stage = (
    <>
      <PlayCanvas
        ref={canvasRef}
        geometry={geometryRef.current}
        getFrame={getFrame}
        arrow={arrow}
        arrowRadius={arrowRadius}
        bodyColor={skinColors.body}
        tailColor={skinColors.trail}
        trailColor={skinColors.trail}
        ghostColor="rgba(148,163,184,0.55)"
        cameraSettings={cameraSettings}
        height={440}
        fill={fullscreen}
      />
      {loading && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/60">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      )}
      {/* Pre-run countdown: the clock is frozen, so the digit is the only thing
          that moves. `key` restarts the pop animation on each digit. */}
      {countdown > 0 && !loading && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span
            key={countdown}
            className="na-countdown-pop font-mono text-7xl font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
          >
            {countdown}
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/70 p-4 text-center">
          <div className="space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto text-red-400" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        </div>
      )}
      {/* Mobile touch zones: left half steers left, right half right. */}
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
            }}
            onPointerUp={() => (touchRef.current[side] = false)}
            onPointerCancel={() => (touchRef.current[side] = false)}
            onLostPointerCapture={() => (touchRef.current[side] = false)}
          />
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Play className="w-5 h-5 text-[var(--app-accent)]" /> Play
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            Drive the arrow with the real engine. Sandbox mode — runs post to the community TAS
            board, not the in-game leaderboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Keyboard className="w-3.5 h-3.5" /> Controls
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setFullscreen(true)}
            disabled={loading || !!error}
          >
            <Maximize2 className="w-3.5 h-3.5" /> Fullscreen
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Stage */}
        <div className="space-y-3">
          {!fullscreen && <div className="relative">{stage}</div>}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={pauseResume}
              disabled={loading || !!error}
            >
              {phase === "running" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={start}
              disabled={loading || !!error}
            >
              <RotateCcw className="w-4 h-4" /> Restart
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={dropCheckpoint}
              disabled={loading || phase === "idle"}
            >
              <Flag className="w-4 h-4" /> Checkpoint
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={restartCheckpoint}
              disabled={checkpoints.length === 0}
            >
              <RotateCcw className="w-4 h-4" /> From checkpoint
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={saveCurrentAsCheckpoint}
              disabled={loading || phase === "idle" || tick === 0}
              title="Save the current position as a practice checkpoint"
            >
              <Bookmark className="w-4 h-4" /> Save
            </Button>
            <div className="flex items-center gap-1.5" title="Playback speed for testing">
              <Gauge className="w-3.5 h-3.5 text-slate-400" />
              <Select value={String(speed)} onValueChange={(v) => changeSpeed(Number(v))}>
                <SelectTrigger
                  className={cn(
                    "h-8 w-[74px] bg-black/30 text-xs font-mono",
                    speed !== 1 ? "border-amber-500/60 text-amber-300" : "border-white/10",
                  )}
                  aria-label="Playback speed"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
                  {PLAY_SPEEDS.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-xs font-mono">
                      {s}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto font-mono text-2xl tabular-nums">
              {fmtTime(runTimeMs / 1000)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Badge variant="secondary" className="font-mono">
              {arrowName}
            </Badge>
            <span>PB {best ? fmtTime(best.timeMs / 1000) : "—"}</span>
            {ghost && (
              <span className="flex items-center gap-1">
                <Ghost className="w-3.5 h-3.5" />
                {ghost.label} {fmtTime(ghost.timeMs / 1000)}
                {deltaMs != null && (
                  <span className={deltaMs <= 0 ? "text-emerald-400" : "text-red-400"}>
                    ({deltaMs <= 0 ? "-" : "+"}
                    {fmtTime(Math.abs(deltaMs) / 1000)})
                  </span>
                )}
              </span>
            )}
            {ghostBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          </div>

          {finishedResult && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <span className="text-sm text-emerald-300 font-mono">
                Finished in {fmtTime((finishedResult.tick * SIM_TICK_MS) / 1000)}
                {!finishedResult.realTime && (
                  <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300">
                    {finishedResult.speed}× — not a verified time
                  </span>
                )}
              </span>
              {levelId === SITE_LEVEL_ID ? (
                <span className="text-[11px] text-emerald-300/70">
                  Editor levels aren&apos;t on the leaderboard
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  {siteIdOf(levelId) && !finishedResult.realTime && (
                    // The site board only records real speedruns; the TAS board
                    // takes a run made at any rate, so the run is not lost.
                    <span className="text-[11px] text-amber-300/80">
                      Not 1× — posting to the TAS board
                    </span>
                  )}
                  <Button size="sm" className="gap-1.5" onClick={() => setSubmitOpen(true)}>
                    <Send className="w-3.5 h-3.5" />
                    {submitKind === "site" ? "Submit to leaderboard" : "Submit to TAS board"}
                  </Button>
                </div>
              )}
            </div>
          )}
          {result && !result.finished && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              Crashed at {fmtTime((result.tick * SIM_TICK_MS) / 1000)}.
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Level</Label>
              <LevelPicker
                value={levelId}
                onChange={(l) => {
                  setLevelId(l.id);
                  setLevelName(l.name);
                }}
                extra={[{ id: SITE_LEVEL_ID, name: levelName || "Editor level" }]}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Arrow</Label>
              <Select value={arrowName} onValueChange={setArrowName}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARROWS.map((a) => (
                    <SelectItem key={a} value={a} className="text-xs">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Ghost className="w-3.5 h-3.5" /> Ghost
              </Label>
              <Select value={ghostChoice} onValueChange={(v) => setGhostChoice(v as GhostChoice)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    None
                  </SelectItem>
                  <SelectItem value="pb" className="text-xs">
                    My PB
                  </SelectItem>
                  <SelectItem value="wr" className="text-xs">
                    World record
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Splits */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1">
              <Flag className="w-3.5 h-3.5" /> Splits
            </div>
            {splits.length === 0 ? (
              <p className="text-xs text-slate-500">Set a checkpoint to track splits.</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {splits.map((s, i) => (
                  <li key={s.index} className="flex items-center justify-between">
                    <span className="text-slate-400">CP{i + 1}</span>
                    <span className="tabular-nums">{fmtTime(s.timeSec)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Saved practice checkpoints (this level + arrow) */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1">
              <Bookmark className="w-3.5 h-3.5" /> Practice checkpoints
            </div>
            {savedCheckpoints.length === 0 ? (
              <p className="text-xs text-slate-500">
                None for this level and arrow. Watch a TAS run and press “Play from here”, or drop
                one during a run and press Save.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {savedCheckpoints.map((cp) => (
                  <li key={cp.id} className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 justify-start gap-1.5 h-8 text-xs font-mono"
                      onClick={() => playSaved(cp)}
                    >
                      <Play className="w-3.5 h-3.5" />
                      {fmtTime((cp.tick * SIM_TICK_MS) / 1000)}
                      <span className="ml-auto text-slate-500 truncate max-w-[8rem]">
                        {cp.label}
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-500 hover:text-red-400"
                      onClick={() => removeSaved(cp.id)}
                      title="Delete checkpoint"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showSettings && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-3">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <Keyboard className="w-3.5 h-3.5" /> Controls
              </div>
              {(Object.keys(settings.keybinds) as Array<keyof PlayInputSettings["keybinds"]>).map(
                (action) => (
                  <div key={action} className="flex items-center justify-between">
                    <span className="text-xs capitalize text-slate-400">{action}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 min-w-20 font-mono text-xs"
                      onClick={() => setKeybind(action)}
                    >
                      {keyLabel(settings.keybinds[action])}
                    </Button>
                  </div>
                ),
              )}
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Gamepad2 className="w-3.5 h-3.5" /> Controller
                </span>
                <Switch
                  checked={settings.gamepad.enabled}
                  onCheckedChange={(v) => {
                    const next = { ...settings, gamepad: { ...settings.gamepad, enabled: v } };
                    setSettings(next);
                    saveInputSettings(next);
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Stick left/right steers; both steer directions (or the brake button) brakes. On
                mobile, tap the left or right half of the stage — both halves at once brakes.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  setSettings(DEFAULT_INPUT_SETTINGS);
                  saveInputSettings(DEFAULT_INPUT_SETTINGS);
                }}
              >
                Reset to defaults
              </Button>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3 text-[11px] text-slate-500 leading-relaxed">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <ChevronRight className="w-3.5 h-3.5" /> Sandbox
            </div>
            Runs here are timed by the engine, not verified. Use the checkpoint button to practise a
            section, then submit a clean run to the community TAS board where it can be replayed.
          </div>
        </div>
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-[70] bg-black">
          {/* Stage fills the viewport. */}
          <div className="absolute inset-0">{stage}</div>

          {/* Clock, top centre. */}
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-4 py-1 backdrop-blur">
              <span className="font-mono text-2xl tabular-nums text-white">
                {fmtTime(runTimeMs / 1000)}
              </span>
              {speed !== 1 && (
                <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-mono text-xs text-amber-300">
                  {speed}×
                </span>
              )}
            </div>
          </div>

          {/* Top-right: pause (with camera settings) and exit. */}
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <Select value={String(speed)} onValueChange={(v) => changeSpeed(Number(v))}>
              <SelectTrigger
                className={cn(
                  "h-9 w-[76px] gap-1 border-white/20 bg-black/60 font-mono text-xs text-slate-100 backdrop-blur hover:bg-black/80",
                  speed !== 1 && "border-amber-500/60 text-amber-300",
                )}
                aria-label="Playback speed"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
                {PLAY_SPEEDS.map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs font-mono">
                    {s}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-white/20 bg-black/60 text-slate-100 backdrop-blur hover:bg-black/80"
              onClick={pauseResume}
              disabled={loading || !!error}
            >
              {phase === "running" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1.5 border-white/20 bg-black/60 text-slate-100 backdrop-blur hover:bg-black/80",
                cameraOpen && "bg-white/15",
              )}
              onClick={() => setCameraOpen((v) => !v)}
              aria-expanded={cameraOpen}
            >
              <SlidersHorizontal className="w-4 h-4" /> Camera
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-white/20 bg-black/60 text-slate-100 backdrop-blur hover:bg-black/80"
              onClick={() => {
                setCameraOpen(false);
                setFullscreen(false);
              }}
            >
              <X className="w-4 h-4" /> Exit
            </Button>
          </div>

          {/* Camera settings, tucked under the pause button. */}
          {cameraOpen && (
            <CameraSettingsPanel
              settings={cameraSettings}
              onChange={setCameraSettings}
              className="absolute right-3 top-14 w-80 bg-black/80 backdrop-blur"
            />
          )}

          {/* Bottom-centre: restart. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className="pointer-events-auto h-9 gap-1.5 border-white/20 bg-black/60 text-slate-100 backdrop-blur hover:bg-black/80"
              onClick={start}
              disabled={loading || !!error}
              title="Restart from the beginning"
            >
              <RotateCcw className="w-4 h-4" /> Restart
            </Button>
          </div>

          {/* Bottom-left: the in-run readout (PB, ghost delta), clear of the
              centred restart button. */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex justify-start">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs text-slate-300 backdrop-blur">
              <Badge variant="secondary" className="font-mono">
                {arrowName}
              </Badge>
              <span>PB {best ? fmtTime(best.timeMs / 1000) : "—"}</span>
              {ghost && (
                <span className="flex items-center gap-1">
                  <Ghost className="w-3.5 h-3.5" />
                  {fmtTime(ghost.timeMs / 1000)}
                  {deltaMs != null && (
                    <span className={deltaMs <= 0 ? "text-emerald-400" : "text-red-400"}>
                      ({deltaMs <= 0 ? "-" : "+"}
                      {fmtTime(Math.abs(deltaMs) / 1000)})
                    </span>
                  )}
                </span>
              )}
              <span className="text-slate-500">Esc to exit</span>
            </div>
          </div>
        </div>
      )}

      {finishedResult && levelId !== SITE_LEVEL_ID && (
        <TasSubmitDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          levelId={submitKind === "site" ? (siteIdOf(levelId) ?? levelId) : levelId}
          levelName={levelName}
          arrowName={arrowName}
          timeMs={finishedResult.tick * SIM_TICK_MS}
          inputs={encodeInputSymbols(finishedResult.symbols)}
          inputCount={finishedResult.symbols.length}
          kind={submitKind}
        />
      )}
    </div>
  );
}
