import * as React from "react";
import { Award, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TONE_CLASSES,
  computeAchievements,
  countSubTenRuns,
  type Achievement,
  type AchievementInput,
} from "@/lib/achievements";
import type { LeaderboardEntry } from "@/types";

interface Props {
  /** Everything the rules need except the sub-10 count, which is derived here. */
  input: Omit<AchievementInput, "subTenRuns">;
  /** Merged boards, used to count the player's sub-10 runs. */
  data: Record<string, LeaderboardEntry[]>;
  username: string;
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const pct = Math.round(achievement.progress * 100);
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        achievement.earned ? TONE_CLASSES[achievement.tone] : "border-white/5 bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={cn(
              "text-xs font-extrabold uppercase tracking-wider truncate",
              achievement.earned ? "" : "text-slate-400",
            )}
          >
            {achievement.name}
          </div>
          <div
            className={cn(
              "text-[10px] mt-0.5",
              achievement.earned ? "opacity-80" : "text-slate-500",
            )}
          >
            {achievement.description}
          </div>
        </div>
        {achievement.earned ? (
          <Award className="w-4 h-4 shrink-0" />
        ) : (
          <Lock className="w-3.5 h-3.5 shrink-0 text-slate-600" />
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              achievement.earned ? "bg-current" : "bg-slate-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">
          {achievement.detail}
        </span>
      </div>
    </div>
  );
}

/** Achievement case for one player, computed from their real run data. */
export function AchievementsView({ input, data, username }: Props) {
  const achievements = React.useMemo(
    () => computeAchievements({ ...input, subTenRuns: countSubTenRuns(username, data) }),
    [input, data, username],
  );

  const earned = achievements.filter((a) => a.earned).length;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
          <span className="w-1.5 h-3 bg-[var(--app-accent)] rounded"></span>
          Achievements
        </h3>
        <span className="text-[10px] font-mono text-slate-500 shrink-0">
          {earned} / {achievements.length} unlocked
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {achievements.map((achievement) => (
          <AchievementCard key={achievement.id} achievement={achievement} />
        ))}
      </div>
    </div>
  );
}
