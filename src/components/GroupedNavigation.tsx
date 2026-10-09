import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const NAV_GROUPS = [
  { id: "levels", label: "Levels", items: [{ id: "leaderboard", label: "Leaderboards" }, { id: "insights", label: "Level insights" }, { id: "rating", label: "Level ratings" }] },
  { id: "rankings", label: "Rankings", items: [{ id: "score", label: "NarrowScore" }, { id: "average", label: "Total time & average" }, { id: "points", label: "Rank points" }, { id: "position", label: "Position points" }] },
  { id: "records", label: "Records", items: [{ id: "wrs", label: "World & category records" }, { id: "tracker", label: "Recent runs" }, { id: "fame", label: "Player achievements" }] },
  { id: "players", label: "Players", items: [{ id: "voting", label: "Player voting" }, { id: "rivalries", label: "Rivalries" }, { id: "targets", label: "Improvement targets" }, { id: "clubs", label: "Milestone clubs" }] },
  { id: "customs", label: "Customs", items: [{ id: "customs", label: "Custom levels" }, { id: "completions", label: "Custom completions" }, { id: "random", label: "Randomizer" }] },
] as const;

export type NavigableView = typeof NAV_GROUPS[number]["items"][number]["id"];

export function navigationGroup(view: string) {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === view));
}

export function GroupedNavigation({ view, onNavigate }: { view: string; onNavigate: (view: NavigableView) => void }) {
  const active = navigationGroup(view);
  return <>
    <nav aria-label="Main sections" className="hidden lg:flex items-center gap-1">
      {NAV_GROUPS.map((group) => <Button key={group.id} variant={active?.id === group.id ? "secondary" : "ghost"} size="sm" onClick={() => onNavigate(group.items[0].id)} className="text-xs">
        {group.label}
      </Button>)}
    </nav>
    <div className="lg:hidden w-28 shrink-0">
      <Select value={active?.id ?? "levels"} onValueChange={(id) => {
        const group = NAV_GROUPS.find((item) => item.id === id);
        if (group) onNavigate(group.items[0].id);
      }}>
        <SelectTrigger aria-label="Main section" className="h-9 text-xs border-border bg-card text-card-foreground"><SelectValue /></SelectTrigger>
        <SelectContent>{NAV_GROUPS.map((group) => <SelectItem key={group.id} value={group.id}>{group.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  </>;
}

export function SectionNavigation({ view, onNavigate }: { view: string; onNavigate: (view: NavigableView) => void }) {
  const group = navigationGroup(view);
  if (!group) return null;
  return <nav aria-label={`${group.label} views`} className="flex flex-wrap gap-1 mb-6 border-b border-border pb-3">
    {group.items.map((item) => <Button key={item.id} variant={view === item.id ? "secondary" : "ghost"} size="sm" aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)} className={cn("text-xs", view === item.id && "font-bold")}>
      {item.label}
    </Button>)}
  </nav>;
}