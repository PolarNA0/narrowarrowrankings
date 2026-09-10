import * as React from "react";
import { Plus, Trash2, Loader2, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { doc, getDoc, setDoc, db } from "@/lib/cloud-db";
import { toast } from "sonner";
import type { LevelPack } from "@/types";

export interface ExtraLevel {
  id: string;
  name: string;
  packId: string;
  gameOrder: number;
  creator?: string;
}

/** Pull a level id out of a pasted link, or accept a bare id. */
export function parseLevelId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const fromQuery =
      url.searchParams.get("level") ||
      url.searchParams.get("levelId") ||
      url.searchParams.get("level_id") ||
      url.searchParams.get("id");
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return trimmed;
  }
}

interface Props {
  levelPacks: LevelPack[];
}

/** Admin tool for manually adding levels to a pack via link or level ID. */
export function AdminLevelManager({ levelPacks }: Props) {
  const [levels, setLevels] = React.useState<ExtraLevel[]>([]);
  const [input, setInput] = React.useState("");
  const [packId, setPackId] = React.useState(levelPacks[0]?.id || "shape-pack");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "configs", "extraLevels"));
        const data = snap.data();
        if (Array.isArray(data?.levels)) setLevels(data.levels as ExtraLevel[]);
      } catch {
        /* nothing saved yet */
      }
    })();
  }, []);

  const persist = async (next: ExtraLevel[]) => {
    setLevels(next);
    await setDoc(doc(db, "configs", "extraLevels"), { levels: next });
  };

  const addLevel = async () => {
    const levelId = parseLevelId(input);
    if (!levelId) {
      toast.error("Paste a level link or ID first");
      return;
    }
    if (levels.some((l) => l.id.toLowerCase() === levelId.toLowerCase())) {
      toast.error("That level is already added");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`);
      const payload = res.ok ? await res.json() : null;
      const info = payload?.levelInfo ?? payload?.level ?? null;
      if (!info?.name) {
        toast.error("Could not find that level");
        return;
      }
      const next = [
        ...levels,
        {
          id: info.level_id || levelId,
          name: info.name as string,
          packId,
          gameOrder: levels.filter((l) => l.packId === packId).length + 100,
          creator: info.creator_name || payload?.creator_name || undefined,
        },
      ];
      await persist(next);
      setInput("");
      toast.success(`${info.name} added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the level");
    } finally {
      setLoading(false);
    }
  };

  const removeLevel = async (id: string) => {
    await persist(levels.filter((l) => l.id !== id));
    toast.success("Level removed");
  };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="border-b border-white/10 pb-4">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-[var(--app-accent)]" /> Add levels to a pack
        </CardTitle>
        <CardDescription>
          Paste a level link or its ID and choose the pack. Added levels show up in the pack
          selector and get their own leaderboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-5">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://narrowarrow.xyz/level/XXXXXXX or level ID"
            className="bg-black/40 border-white/10 font-mono text-xs"
          />
          <Select value={packId} onValueChange={setPackId}>
            <SelectTrigger className="sm:w-52 bg-black/40 border-white/10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levelPacks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={addLevel}
            disabled={loading}
            className="bg-[var(--app-accent)] text-slate-950 font-bold hover:bg-[var(--app-accent)]/80"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add
          </Button>
        </div>

        <div className="divide-y divide-white/5 border border-white/10 rounded-md">
          {levels.length === 0 ? (
            <p className="p-4 text-xs text-slate-500">No manually added levels yet.</p>
          ) : (
            levels.map((l) => (
              <div key={l.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{l.name}</p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 truncate">
                    {levelPacks.find((p) => p.id === l.packId)?.name || l.packId}
                    {l.creator ? ` · ${l.creator}` : ""} · {l.id}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLevel(l.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
