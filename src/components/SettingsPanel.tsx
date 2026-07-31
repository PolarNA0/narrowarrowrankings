import * as React from "react";
import { Palette, RotateCcw, Sparkles, Rows3, Zap, Clock, Type, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { ACCENTS, BACKGROUND_THEMES, type AppSettings } from "@/hooks/useAppSettings";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

export function SettingsPanel({ open, onOpenChange, settings, update, reset }: SettingsPanelProps) {
  const toggles: { key: keyof AppSettings; label: string; icon: React.ReactNode }[] = [
    { key: "motion", label: "Animations", icon: <Zap className="w-4 h-4 text-slate-400" /> },
    { key: "starfield", label: "Ambient glow", icon: <Sparkles className="w-4 h-4 text-slate-400" /> },
    { key: "monoTimes", label: "Monospaced times", icon: <Type className="w-4 h-4 text-slate-400" /> },
    { key: "rounded", label: "Rounded corners", icon: <Square className="w-4 h-4 text-slate-400" /> },
    { key: "highlightWr", label: "Highlight world records", icon: <Sparkles className="w-4 h-4 text-slate-400" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d10] border-white/10 text-slate-200 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Palette className="w-4 h-4 text-[var(--app-accent)]" /> Appearance
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-xs font-mono uppercase tracking-wider">
            Saved on this device
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <section className="space-y-3">
            <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Background ({BACKGROUND_THEMES.length})
            </h4>
            <div className="grid grid-cols-4 gap-2">
              {BACKGROUND_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => update("theme", theme.id)}
                  className={cn(
                    "rounded-xl border p-2 text-left transition-all",
                    settings.theme === theme.id
                      ? "border-[var(--app-accent)] bg-white/5"
                      : "border-white/10 hover:border-white/25",
                  )}
                >
                  <span
                    className="block h-10 w-full rounded-lg border border-white/10"
                    style={{ background: theme.background }}
                  />
                  <span className="mt-1.5 block text-[10px] font-mono text-slate-400 truncate">{theme.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Accent</h4>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  title={accent.name}
                  onClick={() => update("accent", accent.value)}
                  className={cn(
                    "h-9 w-9 rounded-full border-2 transition-transform hover:scale-110",
                    settings.accent === accent.value ? "border-white" : "border-white/10",
                  )}
                  style={{ backgroundColor: accent.value }}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Interface</h4>

            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2 text-sm">
                <Rows3 className="w-4 h-4 text-slate-400" />
                <span>Compact rows</span>
              </div>
              <Switch
                checked={settings.density === "compact"}
                onCheckedChange={(checked) => update("density", checked ? "compact" : "cozy")}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>Show times as 0:12.345</span>
              </div>
              <Switch
                checked={settings.timeFormat === "minutes"}
                onCheckedChange={(checked) => update("timeFormat", checked ? "minutes" : "seconds")}
              />
            </div>

            {toggles.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                <Switch
                  checked={Boolean(settings[item.key])}
                  onCheckedChange={(checked) => update(item.key, checked as never)}
                />
              </div>
            ))}

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Glow intensity</span>
                <span className="font-mono text-xs text-slate-500">{settings.glow.toFixed(1)}x</span>
              </div>
              <Slider
                value={[settings.glow]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([value]) => update("glow", value)}
              />
              <div className="flex items-center justify-between text-sm pt-1">
                <span>Text size</span>
                <span className="font-mono text-xs text-slate-500">
                  {Math.round(settings.fontScale * 100)}%
                </span>
              </div>
              <Slider
                value={[settings.fontScale]}
                min={0.85}
                max={1.2}
                step={0.05}
                onValueChange={([value]) => update("fontScale", value)}
              />
            </div>
          </section>

          <Button
            variant="outline"
            onClick={reset}
            className="w-full border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" /> Reset to defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
