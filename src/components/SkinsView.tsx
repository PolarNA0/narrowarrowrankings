import * as React from "react";
import { Sparkles, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import catalog from "@/lib/skins-catalog.data.json";

interface SkinEntry {
  name: string;
  code?: string;
}

type Category = {
  key: "themes" | "thrusts" | "trails";
  label: string;
  blurb: string;
  entries: SkinEntry[];
};

const CATEGORIES: Category[] = [
  {
    key: "themes",
    label: "Arrow skins",
    blurb: "Body colours and themed arrow finishes.",
    entries: catalog.themes,
  },
  {
    key: "thrusts",
    label: "Thrust colours",
    blurb: "Exhaust flames, including national flags.",
    entries: catalog.thrusts,
  },
  {
    key: "trails",
    label: "Trail colours",
    blurb: "The line drawn behind the arrow.",
    entries: catalog.trails,
  },
];

const THRUST_SHADERS: SkinEntry[] = catalog.thrustShaders;
const TRAIL_SHADERS: SkinEntry[] = catalog.trailShaders;

/** A cosmetic is drawable when its code names an image file rather than a colour. */
function imageFile(entry: SkinEntry): string | null {
  const code = entry.code;
  if (!code || typeof code !== "string") return null;
  if (code.startsWith("#") || code.startsWith("0x")) return null;
  return /\.(svg|png)$/i.test(code) ? code : null;
}

/** Parse a `#RRGGBB` / `0xRRGGBB` / `0xAARRGGBB` colour into a CSS colour. */
function parseColor(code: string | undefined): string | null {
  if (!code) return null;
  let hex = code.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  else if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2);
  else if (/^\d+$/.test(hex)) hex = Number(hex).toString(16);
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  if (hex.length === 8) return `#${hex.slice(2)}`; // drop alpha
  if (hex.length === 6) return `#${hex}`;
  if (hex.length === 3) return `#${hex}`;
  return null;
}

/** Public URL for a cosmetic image, proxied through our own API. */
function assetUrl(file: string): string {
  return `/api/skins/${file}`;
}

function Swatch({ entry }: { entry: SkinEntry }) {
  const file = imageFile(entry);
  const color = parseColor(entry.code);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-14 w-14 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
        {file ? (
          <img
            src={assetUrl(file)}
            alt={entry.name}
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        ) : color ? (
          <span
            className="h-8 w-8 rounded-full ring-1 ring-white/20"
            style={{ background: color }}
          />
        ) : (
          <span className="text-slate-600 text-xs">?</span>
        )}
      </div>
      <span className="text-[10px] text-slate-400 text-center leading-tight line-clamp-2 max-w-[5.5rem]">
        {entry.name}
      </span>
    </div>
  );
}

export function SkinsView() {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();

  const match = React.useCallback(
    (entry: SkinEntry) => !q || entry.name.toLowerCase().includes(q),
    [q],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--app-accent)]" /> Skins
          </h2>
          <p className="text-slate-500 text-sm">
            Every arrow skin, thrust colour and shader found in the game.
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skins"
            className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
          />
        </div>
      </div>

      {CATEGORIES.map((category) => {
        const entries = category.entries.filter(match);
        if (entries.length === 0) return null;
        return (
          <Card key={category.key} className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle className="text-base text-white">{category.label}</CardTitle>
                <span className="text-[10px] uppercase tracking-widest text-slate-500">
                  {entries.length} total
                </span>
              </div>
              <p className="text-slate-500 text-xs">{category.blurb}</p>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {entries.map((entry) => (
                  <Swatch key={entry.name} entry={entry} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="grid gap-4 md:grid-cols-2">
        <ShaderCard title="Thrust shaders" shaders={THRUST_SHADERS} query={q} />
        <ShaderCard title="Trail shaders" shaders={TRAIL_SHADERS} query={q} />
      </div>

      <p className="text-[11px] text-slate-600">
        Shaders are procedural in-game, so they have no image. The catalogue is recovered from
        players' run data and refreshed by playing — new cosmetics appear as soon as someone uses
        them.
      </p>
    </div>
  );
}

function ShaderCard({
  title,
  shaders,
  query,
}: {
  title: string;
  shaders: SkinEntry[];
  query: string;
}) {
  const entries = shaders.filter((s) => !query || s.name.toLowerCase().includes(query));
  if (entries.length === 0) return null;
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="border-b border-white/10 py-3">
        <CardTitle className="text-base text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex flex-wrap gap-2">
        {entries.map((entry) => (
          <Badge
            key={entry.name}
            variant="outline"
            className={cn("font-mono text-[11px] border-white/10 text-slate-300")}
          >
            {entry.name}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
