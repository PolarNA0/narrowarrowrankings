import * as React from "react";
import { Award, Plus, Search, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BADGE_PRESETS,
  BADGE_TONES,
  badgeToneClass,
  useCustomBadges,
  type CustomBadge,
} from "@/hooks/useCustomBadges";

interface Props {
  usernames: string[];
}

/** Admin tool for granting and revoking custom profile badges. */
export function AdminBadgeManager({ usernames }: Props) {
  const { badges, grant, revoke } = useCustomBadges();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [tone, setTone] = React.useState(BADGE_TONES[0].id);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return usernames.slice(0, 25);
    return usernames.filter((u) => u.toLowerCase().includes(q)).slice(0, 25);
  }, [usernames, query]);

  const current = selected ? (badges[selected.toLowerCase()] ?? []) : [];

  const safeGrant = async (badge: CustomBadge) => {
    if (!selected) return;
    try {
      await grant(selected, badge);
      toast.success(`Granted "${badge.label}" to ${selected}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not grant badge");
    }
  };

  const safeRevoke = async (badgeId: string) => {
    if (!selected) return;
    try {
      await revoke(selected, badgeId);
      toast.success("Badge removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove badge");
    }
  };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="border-b border-white/10 pb-4">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Award className="w-4 h-4" /> Profile Badges
        </CardTitle>
        <CardDescription>Pick a player, then grant a preset or a custom badge. Click a badge to remove it.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player"
            className="pl-8 h-9 bg-black/30 border-white/10 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {matches.map((name) => (
            <Button
              key={name}
              size="sm"
              variant="ghost"
              onClick={() => setSelected(name)}
              className={cn(
                "h-7 px-2.5 text-[11px] border border-white/10",
                selected === name ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-300",
              )}
            >
              {name}
            </Button>
          ))}
          {matches.length === 0 && <span className="text-xs text-slate-500 font-mono">No players match.</span>}
        </div>

        {selected && (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-2">
                {selected} — current badges
              </div>
              <div className="flex flex-wrap gap-1.5">
                {current.length === 0 && <span className="text-xs text-slate-500 font-mono">No custom badges yet.</span>}
                {current.map((badge) => (
                  <button
                    key={badge.id}
                    type="button"
                    onClick={() => void safeRevoke(badge.id)}
                    title="Click to remove"
                  >
                    <Badge variant="outline" className={cn("text-[10px] gap-1", badgeToneClass(badge.tone))}>
                      {badge.label}
                      <Trash2 className="w-3 h-3" />
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-2">Quick grant</div>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_PRESETS.filter((p) => !current.some((c) => c.id === p.id)).map((preset) => (
                  <button key={preset.id} type="button" onClick={() => void safeGrant(preset)}>
                    <Badge variant="outline" className={cn("text-[10px] gap-1", badgeToneClass(preset.tone))}>
                      <Plus className="w-3 h-3" />
                      {preset.label}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-slate-500 font-bold">Custom badge</div>
              <div className="flex flex-col md:flex-row gap-2">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label"
                  maxLength={24}
                  className="h-9 bg-black/30 border-white/10 text-sm md:w-48"
                />
                <Input
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Tooltip (optional)"
                  maxLength={80}
                  className="h-9 bg-black/30 border-white/10 text-sm flex-1"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    className={cn(
                      "px-2 py-1 rounded-md border text-[10px] uppercase tracking-widest",
                      t.className,
                      tone === t.id ? "ring-1 ring-white/60" : "opacity-70",
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={!label.trim()}
                onClick={() => {
                  const trimmed = label.trim();
                  void safeGrant({
                    id: `${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
                    label: trimmed,
                    detail: detail.trim() || undefined,
                    tone,
                  });
                  setLabel("");
                  setDetail("");
                }}
                className="bg-[var(--app-accent)] text-slate-950 font-bold h-8 text-[11px] uppercase tracking-widest"
              >
                Grant custom badge
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
