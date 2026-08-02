import * as React from "react";
import { Crown, Hammer, Shield, Star, Flame, BadgeCheck, Rocket, Medal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileSummary } from "@/hooks/useProfileSummaries";
import type { ComputedMedals } from "@/lib/medals";

export interface PlayerBadge {
  id: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  className: string;
}

interface PlayerBadgesProps {
  username: string;
  summary?: ProfileSummary | null;
  medals?: ComputedMedals | null;
  officialCreators?: Set<string>;
  verified?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function computePlayerBadges({
  username,
  summary,
  medals,
  officialCreators,
  verified,
}: Omit<PlayerBadgesProps, "size" | "className">): PlayerBadge[] {
  const badges: PlayerBadge[] = [];
  const wrs = medals?.first ?? summary?.officialMedals?.first ?? 0;
  const customFirsts = summary?.customMedals?.first ?? 0;

  if (verified) {
    badges.push({
      id: "verified",
      label: "Verified",
      detail: "Leaderboard name confirmed by an admin",
      icon: <BadgeCheck className="w-3.5 h-3.5" />,
      className: "text-sky-300 border-sky-400/30 bg-sky-400/10",
    });
  }
  if (wrs > 0) {
    badges.push({
      id: "wr-holder",
      label: wrs >= 20 ? "WR Legend" : "WR Holder",
      detail: `${wrs} official world record${wrs === 1 ? "" : "s"}`,
      icon: <Crown className="w-3.5 h-3.5" />,
      className: "text-amber-300 border-amber-400/30 bg-amber-400/10",
    });
  }
  if (officialCreators?.has(username.toLowerCase())) {
    badges.push({
      id: "official-creator",
      label: "Official Creator",
      detail: "Built a level in an official pack",
      icon: <Shield className="w-3.5 h-3.5" />,
      className: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
    });
  }
  if ((summary?.levelsPublished ?? 0) > 0) {
    badges.push({
      id: "map-maker",
      label: (summary?.levelsPublished ?? 0) >= 10 ? "Prolific Maker" : "Map Maker",
      detail: `${summary?.levelsPublished} published level${summary?.levelsPublished === 1 ? "" : "s"}`,
      icon: <Hammer className="w-3.5 h-3.5" />,
      className: "text-fuchsia-300 border-fuchsia-400/30 bg-fuchsia-400/10",
    });
  }
  if (customFirsts >= 5) {
    badges.push({
      id: "custom-king",
      label: "Custom King",
      detail: `${customFirsts} community-level golds`,
      icon: <Medal className="w-3.5 h-3.5" />,
      className: "text-orange-300 border-orange-400/30 bg-orange-400/10",
    });
  }
  if (summary?.dailyBestFinish === 1) {
    badges.push({
      id: "daily-winner",
      label: "Daily Winner",
      detail: "Won a daily challenge",
      icon: <Flame className="w-3.5 h-3.5" />,
      className: "text-rose-300 border-rose-400/30 bg-rose-400/10",
    });
  }
  if (summary?.league) {
    badges.push({
      id: "league",
      label: `${summary.league} League`,
      detail: `${summary.trophies} trophies`,
      icon: <Star className="w-3.5 h-3.5" />,
      className: "text-indigo-300 border-indigo-400/30 bg-indigo-400/10",
    });
  }
  if ((summary?.totalPlays ?? 0) >= 1000) {
    badges.push({
      id: "popular",
      label: "Crowd Favourite",
      detail: `${summary?.totalPlays.toLocaleString()} plays on published levels`,
      icon: <Rocket className="w-3.5 h-3.5" />,
      className: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
    });
  }
  return badges;
}

/** Compact badge strip rendered next to a player's name. */
export function PlayerBadges({ size = "md", className, ...input }: PlayerBadgesProps) {
  const badges = computePlayerBadges(input);
  if (badges.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) => (
        <span
          key={badge.id}
          title={badge.detail}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap",
            badge.className,
            size === "sm" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
          )}
        >
          {badge.icon}
          {badge.label}
        </span>
      ))}
    </div>
  );
}
