import * as React from "react";
import { Gem, Medal, Shield, Award } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InGameMedals } from "@/types";
import { MEDAL_TIER_ORDER, type MedalKey } from "@/lib/medals";

/** Icon and surface styling for each medal, keyed by threshold field. */
const MEDAL_STYLE: Record<
  MedalKey,
  { border: string; bg: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  topTime: { border: "border-sky-300/40", bg: "bg-sky-300/10", Icon: Gem },
  goldTime: { border: "border-amber-400/40", bg: "bg-amber-400/10", Icon: Award },
  silverTime: { border: "border-slate-300/40", bg: "bg-slate-300/10", Icon: Medal },
  bronzeTime: { border: "border-orange-400/40", bg: "bg-orange-400/10", Icon: Shield },
};

interface Props {
  medals?: InGameMedals | null;
  loading?: boolean;
  formatTime?: (seconds: number) => string;
  className?: string;
  size?: "sm" | "default";
}

/** "In Game Medals" popup: the game's Diamond/Gold/Silver/Bronze cutoffs for a level. */
export function InGameMedalsPopover({
  medals,
  loading,
  formatTime,
  className,
  size = "sm",
}: Props) {
  const fmt = formatTime ?? ((s: number) => `${s.toFixed(3)}s`);
  const ready = !!medals;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn(
            "bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/20 text-[10px] font-bold uppercase tracking-wider",
            size === "sm" && "h-7 px-2.5",
            className,
          )}
        >
          <Medal className="w-3 h-3 mr-1" /> In Game Medals
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 bg-[#121212] border-white/10 text-slate-200">
        <div className="flex items-center gap-2 mb-3">
          <Medal className="w-4 h-4 text-fuchsia-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white">
            In Game Medals
          </span>
        </div>

        {loading && !ready ? (
          <p className="text-xs text-slate-500 font-mono">Loading medal times…</p>
        ) : !ready ? (
          <p className="text-xs text-slate-500 font-mono">No medal times for this level.</p>
        ) : (
          <div className="space-y-1.5">
            {MEDAL_TIER_ORDER.map(({ key, label, color }) => {
              const { border, bg, Icon } = MEDAL_STYLE[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-2.5 py-1.5",
                    bg,
                    border,
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
                      color,
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </span>
                  <span className="font-mono text-xs font-bold text-white">{fmt(medals[key])}</span>
                </div>
              );
            })}
            {medals.finisherCount > 0 && (
              <p className="text-[9px] text-slate-500 font-mono pt-1">
                {medals.finisherCount.toLocaleString()} verified finishers
              </p>
            )}
          </div>
        )}

        {ready && !medals.official && (
          <Badge variant="outline" className="mt-3 text-[9px] border-white/10 text-slate-400">
            Unofficial cutoff
          </Badge>
        )}
      </PopoverContent>
    </Popover>
  );
}
