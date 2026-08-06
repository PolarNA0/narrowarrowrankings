import * as React from "react";
import { Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import { toStandings } from "@/lib/medals";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  usernames: string[];
  onLevelClick?: (levelId: string) => void;
}

/** Shows, per level, exactly how much time a player must shave to gain the next position. */
export function ImprovementTargetsView({ levels, data, usernames, onLevelClick }: Props) {
  const [query, setQuery] = React.useState("");
  const canonical = React.useMemo(
    () => new Map(usernames.map((name) => [name.toLowerCase(), name])),
    [usernames],
  );

  const result = React.useMemo(() => {
    const player = canonical.get(query.trim().toLowerCase());
    if (!player) return null;
    const rows = levels
      .map((level) => {
        const board = toStandings(data[level.id] ?? []);
        const index = board.findIndex((run) => run.username.toLowerCase() === player.toLowerCase());
        if (index < 0) return null;
        const mine = board[index];
        const ahead = index > 0 ? board[index - 1] : null;
        return {
          levelId: level.id,
          levelName: level.name,
          position: index + 1,
          time: mine.completion_time,
          rival: ahead?.username ?? null,
          gap: ahead ? mine.completion_time - ahead.completion_time : 0,
          wrGap: mine.completion_time - board[0].completion_time,
        };
      })
      .filter(Boolean) as {
      levelId: string;
      levelName: string;
      position: number;
      time: number;
      rival: string | null;
      gap: number;
      wrGap: number;
    }[];
    return { player, rows: rows.sort((a, b) => (a.rival ? a.gap : Infinity) - (b.rival ? b.gap : Infinity)) };
  }, [query, canonical, levels, data]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-[var(--app-accent)]" /> Improvement Targets
        </h2>
        <p className="text-slate-500 text-sm">
          The cheapest positions to steal — sorted by how little time you need to find.
        </p>
      </div>

      <Input
        list="target-players"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter a player name"
        className="bg-black/30 border-white/10"
      />
      <datalist id="target-players">
        {usernames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {!result ? (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-10 text-center text-slate-500">
            Type a valid player name to see their next targets.
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-0 divide-y divide-white/5">
            {result.rows.map((row) => (
              <button
                key={row.levelId}
                type="button"
                onClick={() => onLevelClick?.(row.levelId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <span className="w-10 font-mono text-xs text-slate-500">#{row.position}</span>
                <span className="flex-1 truncate">
                  <span className="font-medium text-white">{row.levelName}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                    {row.rival ? `Next up: ${row.rival}` : "World record — nothing above"} · {row.wrGap.toFixed(3)}s off WR
                  </span>
                </span>
                <span className="font-mono text-sm font-bold text-[var(--app-accent)]">
                  {row.rival ? `-${row.gap.toFixed(3)}s` : "WR"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
