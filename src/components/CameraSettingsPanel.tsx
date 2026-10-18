import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CAMERA_PRESETS,
  cameraPreset,
  type CameraPreset,
  type CameraSettings,
} from "@/lib/replay-render";

/** The sliders, in the order the game's camera menu lists them. */
const SLIDERS = [
  ["Zoom", "zoom", 0.4, 5, 0.05],
  ["Dynamic Zoom", "dynamicZoom", 0, 1.2, 0.05],
  ["Zoom Smoothness", "zoomSmoothness", 4, 10, 0.5],
  ["Move Ahead", "moveAhead", 0, 6, 0.1],
  ["Movement Smoothness", "movementSmoothness", 2, 7, 0.5],
] as const;

interface Props {
  settings: CameraSettings;
  onChange: (settings: CameraSettings) => void;
  className?: string;
}

/**
 * The game's camera controls: a preset picker plus the five sliders. Shared by
 * the replay viewer and the Play tab's fullscreen overlay so both offer the
 * same tuning.
 */
export function CameraSettingsPanel({ settings, onChange, className }: Props) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-black/30 p-3 space-y-2.5", className)}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400 w-28">Preset</span>
        <div className="flex gap-1">
          {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] capitalize",
                settings.preset === p ? "bg-white/15 text-slate-100" : "text-slate-400",
              )}
              onClick={() => onChange(cameraPreset(p))}
            >
              {p}
            </Button>
          ))}
        </div>
      </div>
      {SLIDERS.map(([label, key, min, max, step]) => (
        <label key={key} className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 w-28">{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={settings[key]}
            onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
            className="flex-1 accent-[var(--app-accent)]"
            aria-label={label}
          />
          <span className="font-mono text-[10px] text-slate-400 w-8 text-right">
            {settings[key].toFixed(2)}
          </span>
        </label>
      ))}
    </div>
  );
}
