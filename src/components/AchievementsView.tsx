import * as React from "react";
import { Award, Lock, ChevronDown, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TONE_CLASSES,
  computeAchievements,
  computeEarners,
  type Achievement,
  type CareerSummary,
  type Earner,
} from "@/lib/achievements";
import type { LeaderboardEntry, LevelInfo, LevelPack } from "@/types";

interface Props {
  /** The profile owner's career, already summarised from the merged boards. */
  career: CareerSummary;
  /** Merged boards, used to order the earners of each achievement. */
  data: Record<string, LeaderboardEntry[]>;
  levels: LevelInfo[];
  packs: LevelPack[];
  /** Opens a player's profile. */
  onPlayerClick?: (username: string) => void;
}

/** `12 Mar 2026` — compact enough for a leaderboard row. */
function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The players who have earned one achievement, earliest first.
 *
 * Collapsed behind the card so the grid stays scannable; opening it answers the
 * "who else has this" question, and the first row is whoever got there first.
 */
function EarnerList({
  earners,
  onPlayerClick,
}: {
  earners: Earner[];
  onPlayerClick?: (username: string) => void;
}) {
  if (earners.length === 0) {
    return (
      <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-slate-500">
        No one has earned this yet — be the first.
      </p>
    );
  }
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>Earned by {earners.length}</span>
        <span>First</span>
      </div>
      <ol className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
        {earners.map((e, i) => (
          <li key={`${e.username}-${e.at}-${i}`} className="flex items-center gap-2 text-[11px]">
            <span className="w-5 shrink-0 text-right font-mono tabular-nums text-slate-500">
              {i + 1}
            </span>
            {i === 0 && <Trophy className="h-3 w-3 shrink-0 text-amber-400" />}
            <button
              type="button"
              onClick={() => onPlayerClick?.(e.username)}
              disabled={!onPlayerClick}
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                onPlayerClick && "hover:text-[var(--app-accent)] hover:underline",
                i === 0 ? "font-semibold text-amber-200" : "text-slate-300",
              )}
              title={e.username}
            >
              {e.username}
            </button>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{shortDate(e.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AchievementCard({
  achievement,
  earners,
  onPlayerClick,
}: {
  achievement: Achievement;
  earners: Earner[] | undefined;
  onPlayerClick?: (username: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const pct = Math.round(achievement.progress * 100);

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        achievement.earned ? TONE_CLASSES[achievement.tone] : "border-white/5 bg-white/[0.02]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              className={cn(
                "truncate text-xs font-extrabold uppercase tracking-wider",
                achievement.earned ? "" : "text-slate-400",
              )}
            >
              {achievement.name}
            </div>
            <div
              className={cn(
                "mt-0.5 text-[10px]",
                achievement.earned ? "opacity-80" : "text-slate-500",
              )}
            >
              {achievement.description}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {achievement.earned ? (
              <Award className="h-4 w-4" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-600" />
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-slate-500 transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full",
                achievement.earned ? "bg-current" : "bg-slate-500",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
            {achievement.detail}
          </span>
        </div>
      </button>

      {open && <EarnerList earners={earners ?? []} onPlayerClick={onPlayerClick} />}
    </div>
  );
}

/** Achievement case for one player, computed from their real run data. */
export function AchievementsView({ career, data, levels, packs, onPlayerClick }: Props) {
  const achievements = React.useMemo(
    () => computeAchievements(career, levels.length, packs.length, packs, levels),
    [career, levels, packs],
  );

  // The earner boards are the expensive part (one pass over every run), so they
  // are built once and reused for every card.
  const earners = React.useMemo(() => computeEarners(levels, packs, data), [levels, packs, data]);

  const [filter, setFilter] = React.useState<"all" | "earned" | "locked">("all");
  const shown = achievements.filter((a) =>
    filter === "all" ? true : filter === "earned" ? a.earned : !a.earned,
  );
  const earnedCount = achievements.filter((a) => a.earned).length;

  const categories = React.useMemo(() => {
    const map = new Map<string, Achievement[]>();
    for (const a of shown) {
      const list = map.get(a.category);
      if (list) list.push(a);
      else map.set(a.category, [a]);
    }
    return [...map.entries()];
  }, [shown]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-4 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 border-b border-white/10 pb-2 text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)]">
          <span className="h-3 w-1.5 rounded bg-[var(--app-accent)]" />
          Achievements
        </h3>
        <div className="flex items-center gap-2">
          {(["all", "earned", "locked"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                filter === f
                  ? "border-[var(--app-accent)]/40 bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
                  : "border-white/10 text-slate-400 hover:text-slate-200",
              )}
            >
              {f}
            </button>
          ))}
          <span className="shrink-0 font-mono text-[10px] text-slate-500">
            {earnedCount} / {achievements.length}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Click any achievement to see who earned it, earliest first.
      </p>

      {categories.map(([category, items]) => (
        <section key={category} className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {category}
            <span className="ml-2 font-mono text-slate-600">
              {items.filter((a) => a.earned).length}/{items.length}
            </span>
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((achievement) => (
              <AchievementCard
                key={achievement.id}
                achievement={achievement}
                earners={earners.get(achievement.id)}
                onPlayerClick={onPlayerClick}
              />
            ))}
          </div>
        </section>
      ))}

      {shown.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">Nothing to show for this filter.</p>
      )}
    </div>
  );
}
