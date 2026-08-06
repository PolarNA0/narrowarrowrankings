import * as React from "react";
import { Medal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import { toStandings } from "@/lib/medals";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onPlayerClick?: (username: string) => void;
}

/** Per-level "sub-X second" clubs, so players can chase a concrete milestone. */
export function MilestoneClubsView({ levels, data, onPlayerClick }: Props) {
  const [levelId, setLevelId] = React.useState<string>(levels[0]?.id ?? "");
  const active = levels.find((level) => level.id === levelId) ?? levels[0];

  const clubs = React.useMemo(() => {
    if (!active) return [];
    const board = toStandings(data[active.id] ?? []);
    if (!board.length) return [];
    const wr = board[0].completion_time;
    const thresholds: number[] = [];
    for (let t = Math.floor(wr) + 1; t <= Math.floor(wr) + 6; t++) thresholds.push(t);
    return thresholds.map((threshold) => ({
      threshold,
      members: board.filter((run) => run.completion_time < threshold),
    }));
  }, [active, data]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Medal className="w-5 h-5 text-[var(--app-accent)]" /> Milestone Clubs
        </h2>
        <p className="text-slate-500 text-sm">
          Who has broken each sub-second barrier on a map — pick your next milestone.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {levels.map((level) => (
          <Button
            key={level.id}
            size="sm"
            variant="ghost"
            onClick={() => setLevelId(level.id)}
            className={
              level.id === active?.id
                ? "h-7 px-2 text-[10px] uppercase tracking-wider bg-[var(--app-accent)] text-slate-950 font-bold"
                : "h-7 px-2 text-[10px] uppercase tracking-wider text-slate-400 hover:text-white"
            }
          >
            {level.name}
          </Button>
        ))}
      </div>

      {clubs.length === 0 ? (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-10 text-center text-slate-500">No runs loaded for this level yet.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {clubs.map((club) => (
            <Card key={club.threshold} className="bg-white/5 border-white/10">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Sub-{club.threshold} club</span>
                  <span className="font-mono text-xs text-[var(--app-accent)]">{club.members.length} players</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {club.members.slice(0, 24).map((run) => (
                    <button
                      key={run.username}
                      type="button"
                      onClick={() => onPlayerClick?.(run.username)}
                      className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white hover:border-[var(--app-accent)]"
                    >
                      {run.username}
                    </button>
                  ))}
                  {club.members.length > 24 && (
                    <span className="text-[10px] text-slate-500 self-center">
                      +{club.members.length - 24} more
                    </span>
                  )}
                  {club.members.length === 0 && (
                    <span className="text-[10px] text-slate-500">Nobody yet — be the first.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
