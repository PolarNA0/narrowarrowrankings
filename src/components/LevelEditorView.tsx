/**
 * The Level Editor: author a `.nalvl` level by drawing walls, zones and portals,
 * then test-play it against the real engine.
 *
 * The editor owns a `NalvlLevel`. Obstacles are drawn on a pan/zoom canvas
 * (`LevelEditorCanvas`), edited in an inspector, and lowered to the engine
 * payload via `nalvlToRawLevelData` for the test-play mode. Levels can be
 * imported/exported as `.nalvl`, loaded from any official/community level, and
 * generated (`level-gen.ts`) — a generated level is just an editable starting
 * point, not a finished design.
 */

import * as React from "react";
import {
  MousePointer2,
  Minus,
  BoxSelect,
  DoorOpen,
  Hand,
  Trash2,
  Undo2,
  Redo2,
  Download,
  Upload,
  FilePlus2,
  Wand2,
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  Minimize2,
  Wind,
  Magnet,
  Globe,
  Zap,
  Crosshair,
  ToggleLeft,
  DoorClosed,
  ArrowLeftRight,
  Timer,
  Hammer,
  Grip,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LevelEditorCanvas,
  type EditorTool,
  type LevelEditorCanvasHandle,
} from "@/components/LevelEditorCanvas";
import { LevelPicker } from "@/components/LevelPicker";
import { SitePublishDialog } from "@/components/SitePublishDialog";
import { PlayCanvas, type PlayCanvasHandle } from "@/components/PlayCanvas";
import { PlayGame } from "@/lib/play-game";
import {
  actionForKey,
  DEFAULT_INPUT_SETTINGS,
  resolveKeyboard,
  symbolFromHeld,
} from "@/lib/play-input";
import { arrowConstants, levelGeometry, SIM_TICK_MS, type RawLevelData } from "@/lib/replay-sim";
import { themeColor, trailColor, thrustColor } from "@/lib/replay-visuals";
import {
  NALVL_WALL_TYPES,
  NALVL_ZONE_TYPES,
  DEFAULT_FIELD_DIRECTION,
  DEFAULT_FIELD_STRENGTH,
  DEFAULT_GRIP_MULTIPLIER,
  DEFAULT_GRIP_TRACTION,
  DEFAULT_ACCELERATOR_SPEED,
  DEFAULT_ACCELERATOR_ACCEL,
  DEFAULT_SWITCH_GROUP,
  DEFAULT_BLINK_PERIOD,
  DEFAULT_BLINK_DUTY,
  gameFilename,
  nalvlFilename,
  nalvlToGameFile,
  nalvlToRawLevelData,
  parseNalvl,
  rawLevelDataToNalvl,
  serializeNalvl,
  starterLevel,
  type NalvlLevel,
  type NalvlWallType,
  type NalvlZoneType,
} from "@/lib/nalvl";

const LEVELS_URL = "/api/level-details";

export interface LevelEditorViewProps {
  /** A level handed over from the Generator (or elsewhere) to open on mount. */
  initialLevel?: NalvlLevel | null;
  onLevelConsumed?(): void;
  /** Hand the current level to the Play tab to drive it live, in place. */
  onPlayInPlace?(level: NalvlLevel): void;
}

export function LevelEditorView({
  initialLevel,
  onLevelConsumed,
  onPlayInPlace,
}: LevelEditorViewProps) {
  const [level, setLevel] = React.useState<NalvlLevel>(() => starterLevel());
  const [tool, setTool] = React.useState<EditorTool>("select");
  const [wallType, setWallType] = React.useState<NalvlWallType>("normal");
  const [zoneType, setZoneType] = React.useState<NalvlZoneType>("boost");
  const [fieldDirection, setFieldDirection] = React.useState(DEFAULT_FIELD_DIRECTION);
  const [fieldStrength, setFieldStrength] = React.useState(DEFAULT_FIELD_STRENGTH);
  const [gripMultiplier, setGripMultiplier] = React.useState(DEFAULT_GRIP_MULTIPLIER);
  const [gripTraction, setGripTraction] = React.useState(DEFAULT_GRIP_TRACTION);
  const [acceleratorSpeed, setAcceleratorSpeed] = React.useState(DEFAULT_ACCELERATOR_SPEED);
  const [acceleratorAccel, setAcceleratorAccel] = React.useState(DEFAULT_ACCELERATOR_ACCEL);
  const [switchGroup, setSwitchGroup] = React.useState(DEFAULT_SWITCH_GROUP);
  const [switchAction, setSwitchAction] = React.useState<"toggle" | "on" | "off">("toggle");
  const [doorStartOpen, setDoorStartOpen] = React.useState(false);
  const [blinkPeriod, setBlinkPeriod] = React.useState(DEFAULT_BLINK_PERIOD);
  const [blinkDuty, setBlinkDuty] = React.useState(DEFAULT_BLINK_DUTY);
  // Grid snapping is on by default so zones/walls come out symmetrical.
  const [snap, setSnap] = React.useState<number>(10);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [loadingLevel, setLoadingLevel] = React.useState(false);
  const [sourceLevelId, setSourceLevelId] = React.useState<string>("");
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  // Undo/redo history of whole levels (small, so a plain stack is fine).
  const historyRef = React.useRef<{ past: NalvlLevel[]; future: NalvlLevel[] }>({
    past: [],
    future: [],
  });
  const [historyTick, setHistoryTick] = React.useState(0);

  const canvasRef = React.useRef<LevelEditorCanvasHandle | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const applyLevel = React.useCallback((next: NalvlLevel, record = true) => {
    setLevel((prev) => {
      if (record) {
        historyRef.current.past.push(prev);
        historyRef.current.future = [];
        if (historyRef.current.past.length > 200) historyRef.current.past.shift();
        setHistoryTick((t) => t + 1);
      }
      return next;
    });
  }, []);

  // Open a handed-over level once.
  React.useEffect(() => {
    if (initialLevel) {
      historyRef.current = { past: [], future: [] };
      setLevel(initialLevel);
      setSelectedIds([]);
      onLevelConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLevel]);

  const undo = () => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop()!;
    h.future.push(level);
    setLevel(prev);
    setHistoryTick((t) => t + 1);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push(level);
    setLevel(next);
    setHistoryTick((t) => t + 1);
  };

  const selectedObstacles = level.obstacles.filter((o) => selectedIds.includes(o.id));
  const selected = selectedObstacles.length === 1 ? selectedObstacles[0] : null;
  const multiSelected = selectedObstacles.length > 1;

  const updateSelected = (patch: Partial<NonNullable<typeof selected>>) => {
    if (!selected) return;
    applyLevel({
      ...level,
      obstacles: level.obstacles.map((o) => (o.id === selected.id ? { ...o, ...patch } : o)),
    });
  };

  const deleteSelected = () => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    applyLevel({ ...level, obstacles: level.obstacles.filter((o) => !ids.has(o.id)) });
    setSelectedIds([]);
  };

  const loadFromPicker = async (id: string) => {
    if (!id) return;
    setLoadingLevel(true);
    try {
      const res = await fetch(`${LEVELS_URL}/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Level request failed (${res.status})`);
      const payload = (await res.json()) as { levelInfo?: { data?: RawLevelData } };
      const data = payload.levelInfo?.data;
      if (!data) throw new Error("Level has no geometry");
      const next = rawLevelDataToNalvl(data);
      historyRef.current = { past: [], future: [] };
      setLevel(next);
      setSelectedIds([]);
      toast.success(`Loaded “${next.name}” (${next.obstacles.length} obstacles)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load level");
    } finally {
      setLoadingLevel(false);
    }
  };

  const exportNalvl = () => {
    const blob = new Blob([serializeNalvl(level)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nalvlFilename(level);
    a.click();
    URL.revokeObjectURL(url);
  };

  // The game's importer needs the game's own JSON: every obstacle tagged with
  // `obstacle_type`, wrapped as `{ level_id, name, data }`. Exporting the site
  // `.nalvl` (which keys obstacles on `kind`) makes the game report
  // "obstacle N is missing its obstacle type".
  const exportForGame = () => {
    const blob = new Blob([JSON.stringify(nalvlToGameFile(level), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = gameFilename(level);
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported in the game's level format");
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const next = parseNalvl(text);
      historyRef.current = { past: [], future: [] };
      setLevel(next);
      setSelectedIds([]);
      toast.success(`Imported “${next.name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read level");
    }
  };

  // ---- test play -----------------------------------------------------------

  const [testing, setTesting] = React.useState(false);
  const [testPhase, setTestPhase] = React.useState("idle");
  const [testTick, setTestTick] = React.useState(0);
  const gameRef = React.useRef<PlayGame | null>(null);
  const playCanvasRef = React.useRef<PlayCanvasHandle | null>(null);
  const heldRef = React.useRef<Set<string>>(new Set());
  const settingsRef = React.useRef(DEFAULT_INPUT_SETTINGS);
  const rafRef = React.useRef(0);
  // Touch steering for test-play: mirrors PlayView's left/right half-screen
  // zones. Without it, Test play is unusable on a phone (keyboard only).
  const touchRef = React.useRef({ left: false, right: false });

  const setTouch = (side: "left" | "right", down: boolean) => {
    touchRef.current[side] = down;
  };

  const startTest = async () => {
    if (level.obstacles.length === 0) {
      toast.error("Add an obstacle first");
      return;
    }
    const data = nalvlToRawData(level);
    gameRef.current?.free();
    const game = new PlayGame({
      data,
      arrowName: "Narrow Arrow",
      sampleInput: () => {
        const keySym = resolveKeyboard(settingsRef.current, heldRef.current);
        const t = touchRef.current;
        if (keySym !== 0) return keySym;
        return symbolFromHeld(t.left, t.right, false);
      },
      onEnd: (r) => {
        setTestPhase(game.phase);
        if (r.finished) toast.success(`Finished in ${((r.tick * SIM_TICK_MS) / 1000).toFixed(3)}s`);
      },
    });
    const ok = await game.load();
    if (!ok) {
      toast.error("Physics engine failed to initialise");
      return;
    }
    gameRef.current = game;
    setTesting(true);
    setTestPhase(game.phase);
    setTestTick(0);
    game.restart();
    setTestPhase("running");
    canvasRef.current?.redraw();
  };

  const stopTest = () => {
    setTesting(false);
    gameRef.current?.free();
    gameRef.current = null;
  };

  // Zoom/fit act on whichever canvas is showing: the editor while authoring, the
  // live game while test-playing (the editor canvas is unmounted then, so
  // targeting it alone would make the buttons silently no-op during a test run).
  const zoomBy = (factor: number) => {
    if (testing) playCanvasRef.current?.zoomBy(factor);
    else canvasRef.current?.zoomBy(factor);
  };
  const fitView = () => {
    if (testing) playCanvasRef.current?.fit();
    else canvasRef.current?.fit();
  };

  React.useEffect(() => {
    if (!testing) return;
    let last = 0;
    const loop = (ts: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const game = gameRef.current;
      if (!game) return;
      const dt = last ? Math.min(100, ts - last) : 1000 / 60;
      last = ts;
      const ran = game.advance(dt);
      if (ran > 0) playCanvasRef.current?.redraw();
      if (game.phase !== testPhase) setTestPhase(game.phase);
      setTestTick(game.tick);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing]);

  React.useEffect(() => {
    if (!testing) return;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (actionForKey(settingsRef.current, e.code)) {
        e.preventDefault();
        heldRef.current.add(e.code);
      }
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
  }, [testing]);

  React.useEffect(() => () => gameRef.current?.free(), []);

  // Escape leaves fullscreen, matching the Play tab.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // The fullscreen stage fills the viewport below its toolbar. Measured in an
  // effect rather than read during render so SSR does not touch `window`.
  const [viewportHeight, setViewportHeight] = React.useState(0);
  React.useEffect(() => {
    if (!fullscreen) return;
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyTick;

  // The stage is rendered both inline and in the fullscreen overlay, so it lives
  // here rather than inside the layout below.
  const stageHeight = fullscreen ? Math.max(320, viewportHeight - 48) : 520;
  const stage = (
    <div className="relative h-full w-full">
      {testing ? (
        <PlayCanvas
          ref={playCanvasRef}
          geometry={levelGeometryOf(level)}
          getFrame={() => ({
            path: gameRef.current?.path ?? [],
            pathTicks: gameRef.current?.pathTicks ?? [],
            tick: gameRef.current?.currentTick ?? 0,
            timeline: gameRef.current?.timeline,
          })}
          arrow="narrow"
          arrowRadius={arrowConstants("Narrow Arrow").radius ?? 16}
          bodyColor={themeColor(null)}
          tailColor={thrustColor(null)}
          trailColor={trailColor(null)}
          mode="game"
          height={stageHeight}
          fill={fullscreen}
        />
      ) : (
        <LevelEditorCanvas
          ref={canvasRef}
          level={level}
          tool={tool}
          wallType={wallType}
          zoneType={zoneType}
          fieldDirection={fieldDirection}
          fieldStrength={fieldStrength}
          gripMultiplier={gripMultiplier}
          gripTraction={gripTraction}
          acceleratorSpeed={acceleratorSpeed}
          acceleratorAccel={acceleratorAccel}
          switchGroup={switchGroup}
          switchAction={switchAction}
          doorStartOpen={doorStartOpen}
          blinkPeriod={blinkPeriod}
          blinkDuty={blinkDuty}
          snap={snap}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onChange={(next) => applyLevel(next)}
          height={stageHeight}
        />
      )}
      {/* Touch steering while test-playing: left half steers left, right half
          right, both at once brakes. Mirrors the Play tab so a phone can drive. */}
      {testing && (
        <div className="absolute inset-0 flex lg:hidden">
          {(["left", "right"] as const).map((side) => (
            <div
              key={side}
              className="flex-1 touch-none select-none"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setTouch(side, true);
              }}
              onPointerUp={() => setTouch(side, false)}
              onPointerCancel={() => setTouch(side, false)}
              onLostPointerCapture={() => setTouch(side, false)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const tools: { id: EditorTool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 className="w-4 h-4" />, label: "Select" },
    { id: "wall", icon: <Minus className="w-4 h-4" />, label: "Wall" },
    { id: "zone", icon: <BoxSelect className="w-4 h-4" />, label: "Zone" },
    { id: "portal", icon: <DoorOpen className="w-4 h-4" />, label: "Portal" },
    { id: "wind", icon: <Wind className="w-4 h-4" />, label: "Wind (site-only)" },
    { id: "suction", icon: <Magnet className="w-4 h-4" />, label: "Suction (site-only)" },
    { id: "grip", icon: <Grip className="w-4 h-4" />, label: "Grip zone (site-only)" },
    { id: "accelerator", icon: <Zap className="w-4 h-4" />, label: "Accelerator wire (site-only)" },
    { id: "switch", icon: <ToggleLeft className="w-4 h-4" />, label: "Switch (site-only)" },
    { id: "door", icon: <DoorClosed className="w-4 h-4" />, label: "Door (site-only)" },
    { id: "gate", icon: <ArrowLeftRight className="w-4 h-4" />, label: "One-way gate (site-only)" },
    { id: "blink", icon: <Timer className="w-4 h-4" />, label: "Blinking block (site-only)" },
    { id: "breakable", icon: <Hammer className="w-4 h-4" />, label: "Breakable wall (site-only)" },
    { id: "pan", icon: <Hand className="w-4 h-4" />, label: "Pan" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Level Editor</h2>
        <p className="text-slate-500 text-sm">
          Draw walls, zones and portals, then test-play against the real engine. Export for game
          writes the level in the game&apos;s own format (importable in the app); Export .nalvl
          saves the site format. Publish as a site level to share it with the community board.
        </p>
      </div>

      <SitePublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        level={level}
        onPublished={(id) => {
          setSourceLevelId(id);
          toast.success("Site level published — it is on the Levels tab and in Play.");
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_300px] gap-4">
        {/* Left: tools + level actions */}
        <div className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
            <Label className="text-xs">Tool</Label>
            <div className="grid grid-cols-4 gap-1">
              {tools.map((t) => (
                <Button
                  key={t.id}
                  variant={tool === t.id ? "secondary" : "ghost"}
                  size="icon"
                  title={t.label}
                  onClick={() => setTool(t.id)}
                >
                  {t.icon}
                </Button>
              ))}
            </div>
            {tool === "wall" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Wall type</Label>
                <Select value={wallType} onValueChange={(v) => setWallType(v as NalvlWallType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NALVL_WALL_TYPES.map((w) => (
                      <SelectItem key={w} value={w} className="text-xs">
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tool === "zone" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Zone type</Label>
                <Select value={zoneType} onValueChange={(v) => setZoneType(v as NalvlZoneType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NALVL_ZONE_TYPES.map((z) => (
                      <SelectItem key={z} value={z} className="text-xs">
                        {z}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(tool === "wind" || tool === "suction") && (
              <div className="space-y-2">
                {tool === "wind" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Direction (°, 0 = right, 90 = down)</Label>
                    <Input
                      type="number"
                      value={Math.round((fieldDirection * 180) / Math.PI)}
                      onChange={(e) => setFieldDirection((Number(e.target.value) * Math.PI) / 180)}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Strength (world units/tick)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fieldStrength}
                    onChange={(e) => setFieldStrength(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Site-only: the game&apos;s engine has no force fields, so wind and suction are
                  stripped from the game export but simulated here.
                </p>
              </div>
            )}
            {tool === "grip" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Turn multiplier</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    value={gripMultiplier}
                    onChange={(e) => setGripMultiplier(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Traction multiplier</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    value={gripTraction}
                    onChange={(e) => setGripTraction(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Site-only high-friction surface: inside it the arrow turns far tighter. The
                  response is superlinear, so 2x on the turn multiplier is already a very tight
                  arc. Stripped from a game export.
                </p>
              </div>
            )}
            {tool === "accelerator" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Target speed (world units/tick)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={acceleratorSpeed}
                    onChange={(e) => setAcceleratorSpeed(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Push (world units/tick²)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={acceleratorAccel}
                    onChange={(e) => setAcceleratorAccel(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Draw a line the run crosses. It thrusts the arrow along the wire&apos;s normal,
                  the way the arrow is facing, while the player coasts straight; any brake, turn or
                  spin cuts the boost so the arrow can slow down again. Thrust fades out near the
                  target speed. Site-only — the engine has no triggers, so it is stripped from a
                  game export.
                </p>
              </div>
            )}
            {tool === "switch" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Group</Label>
                  <Input
                    value={switchGroup}
                    onChange={(e) => setSwitchGroup(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Action</Label>
                  <Select
                    value={switchAction}
                    onValueChange={(v) => setSwitchAction(v as "toggle" | "on" | "off")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toggle" className="text-xs">
                        toggle
                      </SelectItem>
                      <SelectItem value="on" className="text-xs">
                        on (open doors)
                      </SelectItem>
                      <SelectItem value="off" className="text-xs">
                        off (close doors)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-slate-500">
                  Drag a box the arrow flies into. Doors that share its group react once. Site-only
                  — stripped from a game export.
                </p>
              </div>
            )}
            {tool === "door" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Group</Label>
                  <Input
                    value={switchGroup}
                    onChange={(e) => setSwitchGroup(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={doorStartOpen}
                    onCheckedChange={setDoorStartOpen}
                    aria-label="Start open"
                  />
                  <span className="text-xs text-slate-400">Starts open</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Draw a wall that is solid until a switch in its group opens it. Site-only —
                  stripped from a game export.
                </p>
              </div>
            )}
            {tool === "gate" && (
              <p className="text-[11px] text-slate-500">
                Draw a wall the arrow may cross from one side only. The blocked face defaults to the
                draw&apos;s left normal; select it to flip. Site-only — stripped from a game export.
              </p>
            )}
            {tool === "blink" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cycle (ticks)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={blinkPeriod}
                    onChange={(e) => setBlinkPeriod(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Solid fraction (0–1)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step="0.05"
                    value={blinkDuty}
                    onChange={(e) =>
                      setBlinkDuty(Math.max(0, Math.min(1, Number(e.target.value) || 0)))
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  A block that is solid for the first fraction of each cycle, then passable.
                  Site-only — stripped from a game export.
                </p>
              </div>
            )}
            {tool === "breakable" && (
              <p className="text-[11px] text-slate-500">
                Draw a wall the arrow smashes through on first contact, then passes. Site-only —
                stripped from a game export.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Grid snap (world units)</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={snap > 0}
                  onCheckedChange={(v) => setSnap(v ? 10 : 0)}
                  aria-label="Toggle grid snapping"
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={snap || 10}
                  disabled={snap === 0}
                  onChange={(e) => setSnap(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="h-8 w-20 text-xs"
                />
                <span className="text-[11px] text-slate-500">on by default</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Drag to draw; alt-drag or middle-drag to pan; scroll or pinch to zoom. With Select,
              drag a body to move it or a handle to reshape, drag empty space to box-select, and
              shift-click to add to the selection. The blue START marker is where the arrow spawns.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
            <Label className="text-xs">Level</Label>
            <Input
              value={level.name}
              onChange={(e) => applyLevel({ ...level, name: e.target.value })}
              className="h-8 text-xs"
            />
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={undo}
                disabled={!canUndo}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={redo}
                disabled={!canRedo}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => {
                  historyRef.current = { past: [], future: [] };
                  applyLevel(starterLevel(), false);
                  setSelectedIds([]);
                }}
              >
                <FilePlus2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={exportForGame}>
              <Download className="w-3.5 h-3.5 mr-2" /> Export for game (.json)
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={exportNalvl}>
              <Download className="w-3.5 h-3.5 mr-2" /> Export .nalvl
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setPublishOpen(true)}
            >
              <Globe className="w-3.5 h-3.5 mr-2" /> Publish as site level
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5 mr-2" /> Import .nalvl
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".nalvl,.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
            <Label className="text-xs">Load an existing level</Label>
            <LevelPicker
              value={sourceLevelId}
              onChange={(picked) => {
                setSourceLevelId(picked.id);
                void loadFromPicker(picked.id);
              }}
            />
            {loadingLevel && <p className="text-[11px] text-slate-500">Loading…</p>}
          </div>
        </div>

        {/* Middle: canvas + test play */}
        <div className="space-y-3">
          {!fullscreen && (
            <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
              {stage}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => zoomBy(1.2)}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => zoomBy(1 / 1.2)}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={fitView} title="Fit to level">
              <Maximize className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => canvasRef.current?.centerOnOrigin()}
              title="Centre on the arrow's start"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFullscreen(true)}
              title="Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
            <div className="flex-1" />
            {testing ? (
              <>
                <span className="text-xs font-mono text-slate-400">
                  {testPhase} · {((testTick * SIM_TICK_MS) / 1000).toFixed(2)}s
                </span>
                <Button variant="outline" size="sm" onClick={() => gameRef.current?.restart()}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restart
                </Button>
                <Button variant="secondary" size="sm" onClick={stopTest}>
                  <Pause className="w-3.5 h-3.5 mr-1" /> Exit test
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => void startTest()}>
                  <Play className="w-3.5 h-3.5 mr-1" /> Test play
                </Button>
                {onPlayInPlace && (
                  <Button
                    variant="outline"
                    size="sm"
                    title="Play this level live in the Play tab (no import needed)"
                    onClick={() => onPlayInPlace(level)}
                  >
                    <Play className="w-3.5 h-3.5 mr-1" /> Open in Play
                  </Button>
                )}
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {level.obstacles.length} obstacles · {tool} tool
          </p>
        </div>

        {/* Right: inspector */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
          <Label className="text-xs">Inspector</Label>
          {multiSelected ? (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400">
                {selectedObstacles.length} obstacles selected.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={deleteSelected}>
                  <Trash2 className="w-3.5 h-3.5 mr-1 text-red-400" /> Delete all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => setSelectedIds([])}
                >
                  Clear
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Drag any selected obstacle to move the whole group. Select one to edit its type.
              </p>
            </div>
          ) : !selected ? (
            <p className="text-[11px] text-slate-500">
              Select an obstacle to edit it. Walls get a thickness and rotation; zones get a type.
              Drag on empty space to box-select several; shift-click to add to the selection.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-300">{selected.kind}</span>
                <Button variant="ghost" size="icon" onClick={deleteSelected} title="Delete">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              </div>
              {selected.kind === "wall" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Wall type</Label>
                    <Select
                      value={selected.wallType ?? "normal"}
                      onValueChange={(v) => updateSelected({ wallType: v as NalvlWallType })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NALVL_WALL_TYPES.map((w) => (
                          <SelectItem key={w} value={w} className="text-xs">
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Thickness</Label>
                    <Input
                      type="number"
                      value={selected.thickness ?? 8}
                      onChange={(e) => updateSelected({ thickness: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Rotating</Label>
                    <Switch
                      checked={selected.rotationSpeed != null}
                      onCheckedChange={(on) =>
                        updateSelected(
                          on
                            ? {
                                rotationSpeed: 0.001,
                                rotationPivot: centerOf(selected.points),
                              }
                            : { rotationSpeed: null, rotationPivot: null },
                        )
                      }
                    />
                  </div>
                  {selected.rotationSpeed != null && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Rotation speed (rad/tick)</Label>
                      <Input
                        type="number"
                        step="0.0005"
                        value={selected.rotationSpeed}
                        onChange={(e) => updateSelected({ rotationSpeed: Number(e.target.value) })}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Moving</Label>
                    <Switch
                      checked={selected.motionPeriod != null}
                      onCheckedChange={(on) =>
                        updateSelected(
                          on
                            ? { motionDx: 120, motionDy: 0, motionPeriod: 240 }
                            : { motionDx: undefined, motionDy: undefined, motionPeriod: undefined },
                        )
                      }
                    />
                  </div>
                  {selected.motionPeriod != null && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Offset X</Label>
                          <Input
                            type="number"
                            value={selected.motionDx ?? 0}
                            onChange={(e) => updateSelected({ motionDx: Number(e.target.value) })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Offset Y</Label>
                          <Input
                            type="number"
                            value={selected.motionDy ?? 0}
                            onChange={(e) => updateSelected({ motionDy: Number(e.target.value) })}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Period (ticks, there &amp; back)</Label>
                        <Input
                          type="number"
                          min={2}
                          value={selected.motionPeriod}
                          onChange={(e) => updateSelected({ motionPeriod: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Slides to the offset and back. Site-only — the game engine cannot move a
                        block, so this is stripped from a game export.
                      </p>
                    </div>
                  )}
                </>
              )}
              {selected.kind === "zone" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Zone type</Label>
                  <Select
                    value={selected.zoneType ?? "boost"}
                    onValueChange={(v) => updateSelected({ zoneType: v as NalvlZoneType })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NALVL_ZONE_TYPES.map((z) => (
                        <SelectItem key={z} value={z} className="text-xs">
                          {z}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(selected.kind === "wind" || selected.kind === "suction") && (
                <>
                  {selected.kind === "wind" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Direction (°, 0 = right, 90 = down)</Label>
                      <Input
                        type="number"
                        value={Math.round(((selected.fieldDirection ?? 0) * 180) / Math.PI)}
                        onChange={(e) =>
                          updateSelected({
                            fieldDirection: (Number(e.target.value) * Math.PI) / 180,
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Strength (world units/tick)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={selected.fieldStrength ?? DEFAULT_FIELD_STRENGTH}
                      onChange={(e) => updateSelected({ fieldStrength: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Site-only force field: simulated here, stripped from the game export.
                  </p>
                </>
              )}
              {selected.kind === "grip" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Turn multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="1"
                      value={selected.gripMultiplier ?? DEFAULT_GRIP_MULTIPLIER}
                      onChange={(e) => updateSelected({ gripMultiplier: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Traction multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="1"
                      value={selected.gripTraction ?? DEFAULT_GRIP_TRACTION}
                      onChange={(e) => updateSelected({ gripTraction: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Site-only grip zone: simulated here, stripped from the game export.
                  </p>
                </>
              )}
              {selected.kind === "accelerator" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Target speed (world units/tick)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={selected.acceleratorSpeed ?? DEFAULT_ACCELERATOR_SPEED}
                      onChange={(e) => updateSelected({ acceleratorSpeed: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Push (world units/tick²)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={selected.acceleratorAccel ?? DEFAULT_ACCELERATOR_ACCEL}
                      onChange={(e) => updateSelected({ acceleratorAccel: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Thrusts along the wire&apos;s normal while the player coasts straight; braking,
                    turning or spinning cuts the boost. Site-only: stripped from the game export.
                  </p>
                </>
              )}
              {selected.kind === "switch" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Group</Label>
                    <Input
                      value={selected.switchGroup ?? DEFAULT_SWITCH_GROUP}
                      onChange={(e) => updateSelected({ switchGroup: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Action</Label>
                    <Select
                      value={selected.switchAction ?? "toggle"}
                      onValueChange={(v) =>
                        updateSelected({ switchAction: v as "toggle" | "on" | "off" })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="toggle" className="text-xs">
                          toggle
                        </SelectItem>
                        <SelectItem value="on" className="text-xs">
                          on (open doors)
                        </SelectItem>
                        <SelectItem value="off" className="text-xs">
                          off (close doors)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Fires once, the first time the arrow enters the box. Doors sharing the group
                    react. Site-only: stripped from the game export.
                  </p>
                </>
              )}
              {selected.kind === "door" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Group</Label>
                    <Input
                      value={selected.switchGroup ?? DEFAULT_SWITCH_GROUP}
                      onChange={(e) => updateSelected({ switchGroup: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={selected.doorStartOpen === true}
                      onCheckedChange={(v) => updateSelected({ doorStartOpen: v })}
                      aria-label="Start open"
                    />
                    <span className="text-xs text-slate-400">Starts open</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    A door is solid until a switch in its group opens it. Site-only: stripped from
                    the game export.
                  </p>
                </>
              )}
              {selected.kind === "gate" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Blocked face (outward normal)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        value={selected.gateNormal?.x ?? 0}
                        onChange={(e) =>
                          updateSelected({
                            gateNormal: {
                              x: Number(e.target.value),
                              y: selected.gateNormal?.y ?? 1,
                            },
                          })
                        }
                        className="h-8 text-xs"
                      />
                      <Input
                        type="number"
                        step="0.1"
                        value={selected.gateNormal?.y ?? 1}
                        onChange={(e) =>
                          updateSelected({
                            gateNormal: {
                              x: selected.gateNormal?.x ?? 0,
                              y: Number(e.target.value),
                            },
                          })
                        }
                        className="h-8 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const n = selected.gateNormal ?? { x: 0, y: 1 };
                          updateSelected({ gateNormal: { x: -n.x, y: -n.y } });
                        }}
                      >
                        Flip
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    The arrow may cross from the normal&apos;s back side only. Site-only: stripped
                    from the game export.
                  </p>
                </>
              )}
              {selected.kind === "blink" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cycle (ticks)</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={selected.blinkPeriod ?? DEFAULT_BLINK_PERIOD}
                      onChange={(e) =>
                        updateSelected({ blinkPeriod: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Solid fraction (0–1)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
                      value={selected.blinkDuty ?? DEFAULT_BLINK_DUTY}
                      onChange={(e) =>
                        updateSelected({
                          blinkDuty: Math.max(0, Math.min(1, Number(e.target.value) || 0)),
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Solid for the first fraction of each cycle, then passable. Site-only: stripped
                    from the game export.
                  </p>
                </>
              )}
              {selected.kind === "breakable" && (
                <p className="text-[11px] text-slate-500">
                  A wall the arrow smashes through on first contact. Site-only: stripped from the
                  game export.
                </p>
              )}
              {selected.kind === "portal" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Portal id</Label>
                    <Input
                      value={selected.portalId ?? ""}
                      onChange={(e) => updateSelected({ portalId: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Side</Label>
                    <Select
                      value={selected.side === "both" ? "a" : (selected.side ?? "a")}
                      onValueChange={(v) => updateSelected({ side: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["a", "b"].map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="text-[11px] text-slate-500 font-mono">
                {selected.points.length} point{selected.points.length === 1 ? "" : "s"}
                {selected.points[0] && (
                  <>
                    {" · "}
                    {Math.round(selected.points[0].x)},{Math.round(selected.points[0].y)}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
              {testing ? "Test play" : "Level editor"}
            </span>
            {testing && (
              <span className="text-xs font-mono text-slate-300">
                {testPhase} · {((testTick * SIM_TICK_MS) / 1000).toFixed(2)}s
              </span>
            )}
            <div className="flex-1" />
            {testing ? (
              <Button variant="outline" size="sm" onClick={() => gameRef.current?.restart()}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restart
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => zoomBy(1.2)}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => zoomBy(1 / 1.2)}>
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={fitView} title="Fit to level">
                  <Maximize className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFullscreen(false)}
              title="Exit fullscreen (Esc)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="relative flex-1 overflow-hidden">{stage}</div>
        </div>
      )}
    </div>
  );
}

/** Lower a level to the engine payload (thin alias for readability at call sites). */
function nalvlToRawData(level: NalvlLevel): RawLevelData {
  return nalvlToRawLevelData(level);
}

/** The flattened geometry the test-play canvas renders. */
function levelGeometryOf(level: NalvlLevel) {
  return levelGeometry(nalvlToRawLevelData(level));
}

function centerOf(points: { x: number; y: number }[]) {
  if (points.length === 0) return { x: 0, y: 0 };
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}
