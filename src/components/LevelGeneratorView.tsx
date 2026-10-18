/**
 * The Level Generator: procedurally build a starting level from a template and
 * a seed, preview it, then open it in the Level Editor to sculpt.
 *
 * Generation is deterministic in the seed (`level-gen.ts`), so a seed is a
 * shareable recipe. The output is an ordinary `NalvlLevel` — the generator is a
 * starting point, not a finished design.
 */

import * as React from "react";
import { Dices, Download, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LevelEditorCanvas } from "@/components/LevelEditorCanvas";
import {
  DEFAULT_GEN_OPTIONS,
  GEN_TEMPLATES,
  generateLevel,
  type GenOptions,
  type GenTemplate,
} from "@/lib/level-gen";
import {
  gameFilename,
  nalvlFilename,
  nalvlToGameFile,
  serializeNalvl,
  type NalvlLevel,
} from "@/lib/nalvl";

export interface LevelGeneratorViewProps {
  onOpenInEditor(level: NalvlLevel): void;
}

export function LevelGeneratorView({ onOpenInEditor }: LevelGeneratorViewProps) {
  const [options, setOptions] = React.useState<GenOptions>(DEFAULT_GEN_OPTIONS);
  const [level, setLevel] = React.useState<NalvlLevel>(() => generateLevel(DEFAULT_GEN_OPTIONS));

  const regenerate = React.useCallback((next: GenOptions) => {
    setLevel(generateLevel(next));
  }, []);

  const update = (patch: Partial<GenOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    regenerate(next);
  };

  const randomize = () => update({ seed: Math.floor(Math.random() * 1_000_000) + 1 });

  const exportNalvl = () => {
    const blob = new Blob([serializeNalvl(level)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nalvlFilename(level);
    a.click();
    URL.revokeObjectURL(url);
  };

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
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Level Generator</h2>
        <p className="text-slate-500 text-sm">
          Build a playable starting level from a template and seed, then refine it in the editor.
          Same seed, same level.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        <div className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
            <Label className="text-xs">Template</Label>
            <div className="grid grid-cols-1 gap-1">
              {GEN_TEMPLATES.map((t) => (
                <Button
                  key={t.id}
                  variant={options.template === t.id ? "secondary" : "ghost"}
                  className="justify-start h-auto py-2"
                  onClick={() => update({ template: t.id as GenTemplate })}
                >
                  <div className="text-left">
                    <div className="text-xs font-medium">{t.label}</div>
                    <div className="text-[11px] text-slate-500 font-normal">{t.blurb}</div>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Seed</Label>
                <Input
                  type="number"
                  value={options.seed}
                  onChange={(e) => update({ seed: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <Button variant="outline" size="icon" onClick={randomize} title="Random seed">
                <Dices className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Width</Label>
                <Input
                  type="number"
                  value={options.width}
                  onChange={(e) => update({ width: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Height</Label>
                <Input
                  type="number"
                  value={options.height}
                  onChange={(e) => update({ height: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Density · {Math.round(options.density * 100)}%</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={options.density}
                onChange={(e) => update({ density: Number(e.target.value) })}
                className="w-full accent-[var(--app-accent)]"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Zones (boost/ice)</Label>
              <Switch checked={options.zones} onCheckedChange={(v) => update({ zones: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Rotating walls</Label>
              <Switch checked={options.rotating} onCheckedChange={(v) => update({ rotating: v })} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => regenerate(options)}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Regenerate
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="sm" onClick={() => onOpenInEditor(level)}>
              <Pencil className="w-3.5 h-3.5 mr-2" /> Open in Editor
            </Button>
            <Button variant="outline" size="sm" onClick={exportForGame}>
              <Download className="w-3.5 h-3.5 mr-2" /> Export for game (.json)
            </Button>
            <Button variant="outline" size="sm" onClick={exportNalvl}>
              <Download className="w-3.5 h-3.5 mr-2" /> Export .nalvl
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
            <LevelEditorCanvas
              level={level}
              tool="pan"
              wallType="normal"
              zoneType="boost"
              fieldDirection={0}
              fieldStrength={0.05}
              selectedId={null}
              onSelect={() => {}}
              onChange={() => {}}
              height={560}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            {level.obstacles.length} obstacles · “{level.name}” · pan/zoom to preview
          </p>
        </div>
      </div>
    </div>
  );
}
