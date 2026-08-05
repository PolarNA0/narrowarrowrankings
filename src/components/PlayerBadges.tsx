import * as React from "react";
import {
  Crown,
  Hammer,
  Shield,
  Star,
  Flame,
  BadgeCheck,
  Rocket,
  Medal,
  Award,
  Heart,
  Infinity as InfinityIcon,
  Map as MapIcon,
  Sparkles,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileSummary } from "@/hooks/useProfileSummaries";
import type { ComputedMedals } from "@/lib/medals";
import { badgeToneClass, type CustomBadge } from "@/hooks/useCustomBadges";

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
  customBadges?: CustomBadge[];
  size?: "sm" | "md";
  className?: string;
}

export function computePlayerBadges({
  username,
  summary,
  medals,
  officialCreators,
  verified,
  customBadges,
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
  if (customFirsts >= 25) {
    badges.push({
      id: "custom-royalty",
      label: "Custom Royalty",
      detail: `${customFirsts} community-level golds`,
      icon: <Crown className="w-3.5 h-3.5" />,
      className: "text-yellow-300 border-yellow-400/30 bg-yellow-400/10",
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
  if ((summary?.packMedals?.first ?? 0) > 0) {
    badges.push({
      id: "pack-champion",
      label: "Pack Champion",
      detail: `${summary?.packMedals?.first} pack golds`,
      icon: <Award className="w-3.5 h-3.5" />,
      className: "text-yellow-300 border-yellow-400/30 bg-yellow-400/10",
    });
  }
  const podiums =
    (summary?.officialMedals?.first ?? 0) +
    (summary?.officialMedals?.second ?? 0) +
    (summary?.officialMedals?.third ?? 0);
  if (podiums >= 10) {
    badges.push({
      id: "podium-machine",
      label: "Podium Machine",
      detail: `${podiums} official podium finishes`,
      icon: <Medal className="w-3.5 h-3.5" />,
      className: "text-teal-300 border-teal-400/30 bg-teal-400/10",
    });
  }
  if ((summary?.mapsCompleted ?? 0) >= 64) {
    badges.push({
      id: "completionist",
      label: "Completionist",
      detail: `${summary?.mapsCompleted} maps completed`,
      icon: <MapIcon className="w-3.5 h-3.5" />,
      className: "text-lime-300 border-lime-400/30 bg-lime-400/10",
    });
  }
  if ((summary?.totalRuns ?? 0) >= 5000) {
    badges.push({
      id: "grinder",
      label: "Grinder",
      detail: `${summary?.totalRuns.toLocaleString()} recorded runs`,
      icon: <InfinityIcon className="w-3.5 h-3.5" />,
      className: "text-slate-300 border-white/20 bg-white/5",
    });
  }
  if ((summary?.totalRuns ?? 0) >= 1000) {
    badges.push({
      id: "dedicated",
      label: "Dedicated",
      detail: `${summary?.totalRuns.toLocaleString()} recorded runs`,
      icon: <Timer className="w-3.5 h-3.5" />,
      className: "text-blue-300 border-blue-400/30 bg-blue-400/10",
    });
  }
  if ((summary?.customCompleted ?? 0) >= 100) {
    badges.push({
      id: "custom-explorer",
      label: "Custom Explorer",
      detail: `${summary?.customCompleted} custom levels completed`,
      icon: <MapIcon className="w-3.5 h-3.5" />,
      className: "text-green-300 border-green-400/30 bg-green-400/10",
    });
  }
  if ((summary?.totalPlays ?? 0) >= 10000) {
    badges.push({
      id: "viral-creator",
      label: "Viral Creator",
      detail: `${summary?.totalPlays.toLocaleString()} plays on published levels`,
      icon: <Rocket className="w-3.5 h-3.5" />,
      className: "text-red-300 border-red-400/30 bg-red-400/10",
    });
  }
  if ((summary?.trophies ?? 0) >= 1000) {
    badges.push({
      id: "trophy-hunter",
      label: "Trophy Hunter",
      detail: `${summary?.trophies.toLocaleString()} trophies`,
      icon: <Sparkles className="w-3.5 h-3.5" />,
      className: "text-violet-300 border-violet-400/30 bg-violet-400/10",
    });
  }
  if ((summary?.totalLikes ?? 0) >= 100) {
    badges.push({
      id: "beloved-creator",
      label: "Beloved Creator",
      detail: `${summary?.totalLikes.toLocaleString()} likes on published levels`,
      icon: <Heart className="w-3.5 h-3.5" />,
      className: "text-pink-300 border-pink-400/30 bg-pink-400/10",
    });
  }
  const joinedYear = summary?.joined ? new Date(summary.joined).getFullYear() : null;
  if (joinedYear && joinedYear <= 2024) {
    badges.push({
      id: "early-bird",
      label: "Early Bird",
      detail: `Joined in ${joinedYear}`,
      icon: <Timer className="w-3.5 h-3.5" />,
      className: "text-orange-300 border-orange-400/30 bg-orange-400/10",
    });
  }
  for (const badge of customBadges ?? []) {
    badges.push({
      id: `custom-${badge.id}`,
      label: badge.label,
      detail: badge.detail ?? "Awarded by an admin",
      icon: <Award className="w-3.5 h-3.5" />,
      className: badgeToneClass(badge.tone),
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
