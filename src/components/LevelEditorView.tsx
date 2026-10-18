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
import { PlayCanvas, type PlayCanvasHandle } from "@/components/PlayCanvas";
import { PlayGame } from "@/lib/play-game";
import {
  actionForKey,
  DEFAULT_INPUT_SETTINGS,
  resolveKeyboard,
  symbolFromHeld,
} from "@/lib/play-input";
import { arrowConstants, levelGeometry, SIM_TICK_MS, type RawLevelData } from "@/lib/replay-sim";
import { themeColor, trailColor } from "@/lib/replay-visuals";
import {
  NALVL_WALL_TYPES,
  NALVL_ZONE_TYPES,
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
}

export function LevelEditorView({ initialLevel, onLevelConsumed }: LevelEditorViewProps) {
  const [level, setLevel] = React.useState<NalvlLevel>(() => starterLevel());
  const [tool, setTool] = React.useState<EditorTool>("select");
  const [wallType, setWallType] = React.useState<NalvlWallType>("normal");
  const [zoneType, setZoneType] = React.useState<NalvlZoneType>("boost");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loadingLevel, setLoadingLevel] = React.useState(false);
  const [sourceLevelId, setSourceLevelId] = React.useState<string>("");

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
      setSelectedId(null);
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

  const selected = level.obstacles.find((o) => o.id === selectedId) ?? null;

  const updateSelected = (patch: Partial<NonNullable<typeof selected>>) => {
    if (!selected) return;
    applyLevel({
      ...level,
      obstacles: level.obstacles.map((o) => (o.id === selected.id ? { ...o, ...patch } : o)),
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    applyLevel({ ...level, obstacles: level.obstacles.filter((o) => o.id !== selected.id) });
    setSelectedId(null);
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
      setSelectedId(null);
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
      setSelectedId(null);
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
      sampleInput: () =>
        symbolFromHeld(
          resolveKeyboard(settingsRef.current, heldRef.current) === 2,
          resolveKeyboard(settingsRef.current, heldRef.current) === 1,
          resolveKeyboard(settingsRef.current, heldRef.current) === 3,
        ),
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

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyTick;

  const tools: { id: EditorTool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 className="w-4 h-4" />, label: "Select" },
    { id: "wall", icon: <Minus className="w-4 h-4" />, label: "Wall" },
    { id: "zone", icon: <BoxSelect className="w-4 h-4" />, label: "Zone" },
    { id: "portal", icon: <DoorOpen className="w-4 h-4" />, label: "Portal" },
    { id: "pan", icon: <Hand className="w-4 h-4" />, label: "Pan" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Level Editor</h2>
        <p className="text-slate-500 text-sm">
          Draw walls, zones and portals, then test-play against the real engine. Export for game
          writes the level in the game&apos;s own format (importable in the app); Export .nalvl
          saves the site format.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_300px] gap-4">
        {/* Left: tools + level actions */}
        <div className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
            <Label className="text-xs">Tool</Label>
            <div className="grid grid-cols-5 gap-1">
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
            <p className="text-[11px] text-slate-500">
              Drag to draw; shift-drag or middle-drag to pan; scroll to zoom. With Select, drag a
              body to move it or a handle to reshape.
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
                  setSelectedId(null);
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
          <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
            {testing ? (
              <PlayCanvas
                ref={playCanvasRef}
                geometry={levelGeometryOf(level)}
                getFrame={() => ({ path: gameRef.current?.path ?? [] })}
                arrow="narrow"
                arrowRadius={arrowConstants("Narrow Arrow").radius ?? 16}
                bodyColor={themeColor(null)}
                tailColor={themeColor(null)}
                trailColor={trailColor(null)}
                mode="game"
                height={520}
              />
            ) : (
              <LevelEditorCanvas
                ref={canvasRef}
                level={level}
                tool={tool}
                wallType={wallType}
                zoneType={zoneType}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={(next) => applyLevel(next)}
                height={520}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => canvasRef.current?.zoomBy(1.2)}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => canvasRef.current?.fit()}>
              <Maximize className="w-3.5 h-3.5" />
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
              <Button variant="secondary" size="sm" onClick={() => void startTest()}>
                <Play className="w-3.5 h-3.5 mr-1" /> Test play
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {level.obstacles.length} obstacles · {tool} tool
          </p>
        </div>

        {/* Right: inspector */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
          <Label className="text-xs">Inspector</Label>
          {!selected ? (
            <p className="text-[11px] text-slate-500">
              Select an obstacle to edit it. Walls get a thickness and rotation; zones get a type.
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
