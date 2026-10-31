import * as React from "react";
import { Flag, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCountdown } from "@/lib/campaign";
import { fetchCampaigns, fetchCampaign, type CampaignDetail } from "@/lib/campaign-client";
import { displayNameFor, type ProfileDirectory } from "@/lib/display-name";

/**
 * The home-page campaign surface: the newest campaign, its window, and the top
 * few places. It reads `?summary=1`, so it never pulls the whole board — only
 * the rows it shows.
 */
export function HomeCampaignCard({
  profiles,
  formatTime,
  onNavigate,
  onPlayerClick,
}: {
  profiles?: ProfileDirectory;
  formatTime: (seconds: number, forceMode?: "seconds" | "minutes") => string;
  onNavigate: () => void;
  onPlayerClick: (username: string) => void;
}) {
  const [detail, setDetail] = React.useState<CampaignDetail | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchCampaigns();
        const newest = list[0];
        if (!newest) return;
        const d = await fetchCampaign(newest.id, { summary: true });
        if (!cancelled) setDetail(d);
      } catch {
        /* the card is optional dressing; a failure leaves it hidden */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show until a campaign exists — the home page stays uncluttered.
  if (!detail || detail.standings.length === 0) return null;

  const campaign = detail.campaign;
  const status = detail.status;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] flex items-center gap-2">
          <Flag className="w-3.5 h-3.5" /> Campaign
        </h2>
        <span
          className={cn(
            "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border font-bold",
            status === "live"
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : status === "ended"
                ? "border-white/20 bg-white/5 text-slate-400"
                : "border-amber-400/40 bg-amber-400/10 text-amber-300",
          )}
        >
          {status === "live"
            ? `live · ${formatCountdown(campaign.endsAt - Date.now())} left`
            : status === "ended"
              ? "final"
              : `starts in ${formatCountdown(campaign.startsAt - Date.now())}`}
        </span>
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white font-bold">{campaign.name}</span>
              <span className="text-xs text-slate-500">{campaign.levels.length} levels</span>
              <div className="flex items-center gap-1.5">
                {campaign.classes.map((k) => (
                  <span
                    key={k.id}
                    title={k.name}
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: k.color }}
                  />
                ))}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onNavigate}
              className="gap-2 text-slate-300 h-8"
            >
              Standings <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="divide-y divide-white/5">
            {detail.standings.slice(0, 5).map((row, index) => (
              <button
                key={row.username}
                type="button"
                onClick={() => onPlayerClick(row.username)}
                className="w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.03]"
              >
                <span className="font-mono text-xs text-slate-500">#{index + 1}</span>
                <span className="min-w-0 truncate text-sm text-white">
                  {displayNameFor(profiles, row.username)}
                </span>
                <span className="font-mono text-sm text-[var(--app-accent)] font-bold">
                  {row.points.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
