/**
 * The "Export video" dialog: pick a render look, a camera, an arrow colour and
 * a size, then record the replay to a downloadable clip. It renders its own
 * preview canvas at the chosen settings, so what you see is what records.
 */
import * as React from "react";
import { Download, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CAMERA_PRESETS,
  cameraPreset,
  type CameraPreset,
  type CameraSettings,
} from "@/lib/replay-render";
import {
  canExportVideo,
  deriveArrowColors,
  downloadBlob,
  exportFileName,
  exportReplayVideo,
  hslToHex,
  type ExportCameraMode,
} from "@/lib/replay-export";
import type { RenderMode } from "@/lib/replay-paint";
import type { ArrowKind } from "@/lib/arrow-sprites";
import type { SimGeometry, SimResult } from "@/lib/replay-sim";

/** Output presets, sized for the usual places a clip gets shared. */
const SIZE_PRESETS = [
  { label: "Landscape 1280×720", width: 1280, height: 720 },
  { label: "Wide 1920×1080", width: 1920, height: 1080 },
  { label: "Square 1080×1080", width: 1080, height: 1080 },
  { label: "Vertical 1080×1920", width: 1080, height: 1920 },
  { label: "Compact 960×540", width: 960, height: 540 },
] as const;

const FPS_PRESETS = [30, 60] as const;

/** A few one-tap arrow colours on top of the full RGB spectrum. */
const SWATCHES = ["#8ab4ff", "#ff6b6b", "#4ade80", "#fbbf24", "#c084fc", "#22d3ee"];

interface ExportDialogProps {
  sim: SimResult;
  geometry: SimGeometry;
  arrow: ArrowKind;
  arrowRadius: number;
  defaultColors: { body: string; trail: string; thrust: string };
  levelName?: string;
  /** Pre-simulated runs offered as side-by-side ghosts. */
  ghostCandidates?: {
    id: string;
    label: string;
    sim: SimResult;
    arrow: ArrowKind;
    arrowRadius: number;
    color: string;
  }[];
  trigger?: React.ReactNode;
}

export function ReplayExportDialog({
  sim,
  geometry,
  arrow,
  arrowRadius,
  defaultColors,
  levelName,
  ghostCandidates = [],
  trigger,
}: ExportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<RenderMode>("game");
  const [cameraMode, setCameraMode] = React.useState<ExportCameraMode>("follow");
  const [camera, setCamera] = React.useState<CameraSettings>(cameraPreset("normal"));
  const [sizeIdx, setSizeIdx] = React.useState(0);
  const [fps, setFps] = React.useState<(typeof FPS_PRESETS)[number]>(60);
  const [hue, setHue] = React.useState(215);
  const [sat, setSat] = React.useState(0.85);
  const [light, setLight] = React.useState(0.72);
  const [useSkinColors, setUseSkinColors] = React.useState(false);
  const [showInputs, setShowInputs] = React.useState(true);
  const [ghostIds, setGhostIds] = React.useState<string[]>([]);
  const [recording, setRecording] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);
  const [resultName, setResultName] = React.useState("");

  const size = SIZE_PRESETS[sizeIdx];
  const customColor = hslToHex(hue, sat, light);
  const colors = useSkinColors
    ? defaultColors
    : { body: customColor, ...deriveArrowColors(customColor) };
  const supported = React.useMemo(() => canExportVideo(), []);

  // Release the last preview blob when a new one replaces it.
  React.useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const ghosts = React.useMemo(
    () =>
      ghostCandidates
        .filter((g) => ghostIds.includes(g.id))
        .map((g) => ({
          sim: g.sim,
          color: g.color,
          arrow: g.arrow,
          arrowRadius: g.arrowRadius,
          label: g.label,
        })),
    [ghostCandidates, ghostIds],
  );

  const runExport = async () => {
    setError(null);
    setProgress(0);
    setRecording(true);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    try {
      const blob = await exportReplayVideo({
        sim,
        geometry,
        mode,
        width: size.width,
        height: size.height,
        fps,
        cameraMode,
        camera,
        arrow,
        arrowRadius,
        bodyColor: colors.body,
        trail: colors.trail,
        thrust: colors.thrust,
        background: "#07070b",
        showInputs,
        ghosts,
        onProgress: setProgress,
      });
      const name = `${exportFileName(levelName, arrow)}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
      setResultName(name);
      setResultUrl(URL.createObjectURL(blob));
      // Hand the file straight to the browser so the user gets it immediately.
      downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecording(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-slate-300">
            <Video className="w-3.5 h-3.5" />
            Export video
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl bg-[#0d0d10] border-white/10 text-slate-200 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Video className="w-4 h-4" /> Export replay as video
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Records the replay at its real speed. Leave the tab in the foreground while it records.
          </DialogDescription>
        </DialogHeader>

        {!supported && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
            This browser cannot record canvas video. Try a recent Chrome, Edge or Firefox.
          </p>
        )}

        <div className="space-y-4">
          {/* Render look */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-[11px] text-slate-400">Render</span>
            <div className="flex gap-1">
              {(["game", "lines"] as RenderMode[]).map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs capitalize",
                    mode === m ? "bg-white/15 text-slate-100" : "text-slate-400",
                  )}
                  onClick={() => setMode(m)}
                >
                  {m === "game" ? "Game" : "Simple lines"}
                </Button>
              ))}
            </div>
          </div>

          {/* Camera */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-[11px] text-slate-400">Camera</span>
            <Select value={cameraMode} onValueChange={(v) => setCameraMode(v as ExportCameraMode)}>
              <SelectTrigger className="h-7 w-36 bg-black/30 border-white/10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
                <SelectItem value="follow" className="text-xs">
                  Follow the arrow
                </SelectItem>
                <SelectItem value="fit" className="text-xs">
                  Whole level
                </SelectItem>
              </SelectContent>
            </Select>
            {cameraMode === "follow" && (
              <div className="flex gap-1">
                {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((p) => (
                  <Button
                    key={p}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-[11px] capitalize",
                      camera.preset === p ? "bg-white/15 text-slate-100" : "text-slate-400",
                    )}
                    onClick={() => setCamera(cameraPreset(p))}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {cameraMode === "follow" && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
              {(
                [
                  ["Zoom", "zoom", 0.4, 5, 0.05],
                  ["Dynamic Zoom", "dynamicZoom", 0, 1.2, 0.05],
                  ["Zoom Smoothness", "zoomSmoothness", 4, 10, 0.5],
                  ["Move Ahead", "moveAhead", 0, 6, 0.1],
                  ["Movement Smoothness", "movementSmoothness", 2, 7, 0.5],
                ] as const
              ).map(([label, key, min, max, step]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-32 text-[11px] text-slate-400">{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={camera[key]}
                    onChange={(e) => setCamera((s) => ({ ...s, [key]: Number(e.target.value) }))}
                    className="flex-1 accent-[var(--app-accent)]"
                    aria-label={label}
                  />
                  <span className="w-8 text-right font-mono text-[10px] text-slate-400">
                    {camera[key].toFixed(2)}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Input readout */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-[11px] text-slate-400">Input viewer</span>
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={showInputs}
                onChange={(e) => setShowInputs(e.target.checked)}
                className="accent-[var(--app-accent)]"
              />
              Show the in-game steer dots (bottom-right)
            </label>
          </div>

          {/* Size and frame rate */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-[11px] text-slate-400">Size</span>
            <Select value={String(sizeIdx)} onValueChange={(v) => setSizeIdx(Number(v))}>
              <SelectTrigger className="h-7 w-52 bg-black/30 border-white/10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
                {SIZE_PRESETS.map((s, i) => (
                  <SelectItem key={s.label} value={String(i)} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-slate-400">FPS</span>
            <div className="flex gap-1">
              {FPS_PRESETS.map((f) => (
                <Button
                  key={f}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-[11px] font-mono",
                    fps === f ? "bg-white/15 text-slate-100" : "text-slate-400",
                  )}
                  onClick={() => setFps(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>

          {/* Arrow colour */}
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Arrow colour</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={useSkinColors}
                  onChange={(e) => setUseSkinColors(e.target.checked)}
                  className="accent-[var(--app-accent)]"
                />
                Use the run's skin
              </label>
            </div>
            {!useSkinColors && (
              <>
                <div className="flex items-center gap-3">
                  <span
                    className="h-7 w-10 shrink-0 rounded border border-white/20"
                    style={{ background: customColor }}
                    aria-hidden
                  />
                  {(
                    [
                      ["Hue", hue, setHue, 0, 360, 1],
                      ["Saturation", sat, setSat, 0, 1, 0.01],
                      ["Lightness", light, setLight, 0, 1, 0.01],
                    ] as const
                  ).map(([label, value, setter, min, max, step]) => (
                    <label key={label} className="flex flex-1 items-center gap-2">
                      <span className="text-[10px] text-slate-500">{label}</span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(e) => setter(Number(e.target.value))}
                        className="flex-1 accent-[var(--app-accent)]"
                        aria-label={label}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="h-5 w-5 rounded-full border border-white/20"
                      style={{ background: c }}
                      aria-label={`Use ${c}`}
                      onClick={() => {
                        // Snap the sliders to the swatch by matching its hue.
                        const m = /^#(..)(..)(..)$/.exec(c);
                        if (!m) return;
                        const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        const l = (max + min) / 2;
                        const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
                        let h = 0;
                        if (max !== min) {
                          if (max === r) h = ((g - b) / (max - min)) % 6;
                          else if (max === g) h = (b - r) / (max - min) + 2;
                          else h = (r - g) / (max - min) + 4;
                        }
                        setHue(Math.round((h * 60 + 360) % 360));
                        setSat(s);
                        setLight(l);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Ghosts */}
          {ghostCandidates.length > 0 && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
              <span className="text-[11px] text-slate-400">Compare with</span>
              <div className="flex flex-wrap gap-2">
                {ghostCandidates.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-1.5 text-[11px] text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={ghostIds.includes(g.id)}
                      onChange={(e) =>
                        setGhostIds((ids) =>
                          e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id),
                        )
                      }
                      className="accent-[var(--app-accent)]"
                    />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    {g.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Clip length ≈ {((Math.max(1, sim.path.length - 1) * (1000 / 240)) / 1000).toFixed(2)}s.
            {cameraMode === "follow" && " The camera follows the arrow."}
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!supported || recording}
              onClick={() => void runExport()}
            >
              {recording ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Recording {Math.round(progress * 100)}%
                </>
              ) : (
                <>
                  <Video className="mr-1.5 h-3.5 w-3.5" />
                  Record video
                </>
              )}
            </Button>
            {resultUrl && !recording && (
              <a
                href={resultUrl}
                download={resultName}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--app-accent)] hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Save {resultName}
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
