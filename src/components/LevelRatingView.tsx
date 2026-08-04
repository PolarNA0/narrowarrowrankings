import * as React from "react";
import { Search, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLevelRatings } from "@/hooks/useLevelRatings";
import type { LevelInfo, LevelPack } from "@/types";

interface Props {
  levels: LevelInfo[];
  packs: LevelPack[];
  signedIn: boolean;
  userId?: string | null;
  onSelectLevel?: (levelId: string) => void;
  onRequestSignIn?: () => void;
}

type SortKey = "rating" | "votes" | "order";

/** Community 1-10 rating board for the official levels. */
export function LevelRatingView({ levels, packs, signedIn, userId, onSelectLevel, onRequestSignIn }: Props) {
  const { summaries, myRatings, rate, clearRating } = useLevelRatings(userId);
  const [query, setQuery] = React.useState("");
  const [pack, setPack] = React.useState("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("rating");

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = levels
      .filter((level) => (pack === "all" || level.packId === pack) && (!q || level.name.toLowerCase().includes(q)))
      .map((level) => ({ level, summary: summaries[level.id] ?? { average: 0, count: 0 } }));
    list.sort((a, b) => {
      if (sortKey === "order") return a.level.gameOrder - b.level.gameOrder;
      if (sortKey === "votes") return b.summary.count - a.summary.count || b.summary.average - a.summary.average;
      return b.summary.average - a.summary.average || b.summary.count - a.summary.count;
    });
    return list;
  }, [levels, summaries, query, pack, sortKey]);

  const submit = async (levelId: string, value: number) => {
    if (!signedIn) {
      onRequestSignIn?.();
      toast.error("Sign in to rate levels.");
      return;
    }
    try {
      if (myRatings[levelId] === value) await clearRating(levelId);
      else await rate(levelId, value);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rating failed");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star className="w-5 h-5 text-[var(--app-accent)]" /> Level Rating
          </h2>
          <p className="text-slate-500 text-sm">Rate every official level from 1 to 10. Click your score again to undo.</p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search level"
            className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["rating", "votes", "order"] as SortKey[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="ghost"
            onClick={() => setSortKey(key)}
            className={cn(
              "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
              sortKey === key ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400",
            )}
          >
            {key === "order" ? "Game order" : key === "votes" ? "Most rated" : "Top rated"}
          </Button>
        ))}
        <span className="w-px bg-white/10 mx-1" />
        {[{ id: "all", name: "All packs" }, ...packs].map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant="ghost"
            onClick={() => setPack(p.id)}
            className={cn(
              "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
              pack === p.id ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400",
            )}
          >
            {p.name}
          </Button>
        ))}
      </div>

      {!signedIn && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 text-sm text-slate-400">
            Browse freely — sign in from the profile icon to submit your own ratings.
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
          <CardTitle className="text-base font-bold text-white">Community ratings ({rows.length} levels)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-white/5">
          {rows.map(({ level, summary }) => {
            const mine = myRatings[level.id];
            return (
              <div key={level.id} className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-3 lg:w-72 min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectLevel?.(level.id)}
                    className="font-bold text-white truncate hover:text-[var(--app-accent)]"
                  >
                    {level.name}
                  </button>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px] border-white/10",
                      summary.count === 0 ? "text-slate-400 bg-white/5" : "text-[var(--app-accent)] bg-white/5",
                    )}
                  >
                    {summary.count === 0 ? "unrated" : `${summary.average.toFixed(1)} / 10`}
                  </Badge>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{summary.count} votes</span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
                    <Button
                      key={value}
                      size="icon"
                      variant="ghost"
                      onClick={() => void submit(level.id, value)}
                      className={cn(
                        "h-7 w-7 text-[11px] font-mono border border-white/10",
                        mine === value
                          ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                          : mine && value < mine
                            ? "bg-white/10 text-white"
                            : "text-slate-400 hover:text-white",
                      )}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">No levels match that search.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
