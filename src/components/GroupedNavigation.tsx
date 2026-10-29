import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronLeft, ChevronRight, Home, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_GROUPS = [
  {
    id: "levels",
    label: "Levels",
    items: [
      { id: "leaderboard", label: "Leaderboards" },
      { id: "site-levels", label: "Site levels" },
      { id: "site-records", label: "Site level records" },
      { id: "insights", label: "Level insights" },
      { id: "rating", label: "Level ratings" },
    ],
  },
  {
    id: "rankings",
    label: "Rankings",
    items: [
      { id: "score", label: "NarrowScore" },
      { id: "average", label: "Total time & average" },
      { id: "points", label: "Rank points" },
      { id: "position", label: "Position points" },
      { id: "race-matches", label: "Recent matches" },
    ],
  },
  {
    id: "records",
    label: "Records",
    items: [
      { id: "wrs", label: "World & category records" },
      { id: "medal-ease", label: "Easiest medals" },
      { id: "tas-human", label: "TAS vs Human" },
      { id: "tracker", label: "Recent runs" },
      { id: "fame", label: "Player achievements" },
    ],
  },
  {
    id: "players",
    label: "Players",
    items: [
      { id: "voting", label: "Player voting" },
      { id: "rivalries", label: "Rivalries" },
      { id: "targets", label: "Improvement targets" },
      { id: "clubs", label: "Milestone clubs" },
    ],
  },
  {
    id: "customs",
    label: "Customs",
    items: [
      { id: "customs", label: "Custom levels" },
      { id: "completions", label: "Custom completions" },
      { id: "random", label: "Randomizer" },
    ],
  },
  { id: "skins", label: "Skins", items: [{ id: "skins", label: "Skin catalogue" }] },
  {
    id: "tools",
    label: "Tools",
    items: [
      { id: "tas", label: "TAS editor" },
      { id: "tas-board", label: "TAS leaderboard" },
      { id: "brute", label: "Brute" },
      { id: "editor", label: "Level editor" },
      { id: "generator", label: "Generator" },
    ],
  },
  {
    id: "play",
    label: "Play",
    items: [
      { id: "play", label: "Play" },
      { id: "race", label: "1v1 Race" },
      { id: "endless", label: "Endless" },
    ],
  },
] as const;

export type NavigableView = (typeof NAV_GROUPS)[number]["items"][number]["id"];

export function navigationGroup(view: string) {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === view));
}

export function GroupedNavigation({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (view: NavigableView | "home") => void;
}) {
  const active = navigationGroup(view);
  return (
    <>
      <nav aria-label="Main sections" className="hidden lg:flex items-center gap-1">
        {/* An explicit Home entry: the wordmark also links home, but a bare
            logo is not a recognisable "back to start" affordance on its own. */}
        <Button
          variant={view === "home" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onNavigate("home")}
          className="text-xs gap-1.5"
        >
          <Home className="w-3.5 h-3.5" />
          Home
        </Button>
        {NAV_GROUPS.map((group) => (
          <Button
            key={group.id}
            variant={active?.id === group.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate(group.items[0].id)}
            className="text-xs"
          >
            {group.label}
          </Button>
        ))}
      </nav>
      <MobileNavigation view={view} onNavigate={onNavigate} />
    </>
  );
}

/**
 * The narrow-viewport nav: one menu button instead of the desktop bar's eight.
 *
 * Each section opens as a submenu of its own views, so the label of what you
 * are about to open is always visible — the previous `Select` showed only the
 * current section and gave no hint that it was a menu at all.
 */
export function MobileNavigation({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (view: NavigableView | "home") => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Which group is drilled into, if any. The mobile menu used to open each
  // section as a flyout submenu, but at phone widths the parent panel is already
  // ~224px wide and a second 224px panel cannot fit beside it — Radix flipped it
  // to the left and most of it landed off-screen. Drilling down in place keeps
  // every label inside the viewport.
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  const active = navigationGroup(view);
  const group = NAV_GROUPS.find((g) => g.id === openGroup) ?? null;
  const go = (next: NavigableView | "home") => {
    setOpen(false);
    setOpenGroup(null);
    onNavigate(next);
  };
  return (
    <div className="lg:hidden">
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setOpenGroup(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Open navigation menu"
            className="text-slate-300 hover:text-white hover:bg-white/5 gap-1.5 px-2"
          >
            <Menu className="w-5 h-5" />
            <span className="text-xs font-medium hidden sm:inline">
              {view === "home" ? "Home" : (active?.label ?? "Menu")}
            </span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 max-h-[70vh] overflow-y-auto"
          aria-label={group ? `${group.label} views` : "Main sections"}
        >
          {group === null ? (
            <>
              <DropdownMenuItem
                onSelect={() => go("home")}
                className={cn("gap-2 cursor-pointer", view === "home" && "font-bold")}
              >
                <Home className="w-4 h-4" />
                Home
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {NAV_GROUPS.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  // preventDefault keeps the panel open so it can swap to this
                  // group's items instead of dismissing the menu.
                  onSelect={(event) => {
                    event.preventDefault();
                    setOpenGroup(entry.id);
                  }}
                  className={cn(
                    "gap-2 cursor-pointer justify-between",
                    active?.id === entry.id && "font-bold",
                  )}
                >
                  {entry.label}
                  <ChevronRight className="w-4 h-4 opacity-50" />
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setOpenGroup(null);
                }}
                className="gap-2 cursor-pointer text-slate-400"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                {group.label}
              </DropdownMenuLabel>
              {group.items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => go(item.id)}
                  className={cn("cursor-pointer", view === item.id && "font-bold")}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SectionNavigation({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (view: NavigableView) => void;
}) {
  const group = navigationGroup(view);
  if (!group) return null;
  return (
    <nav
      aria-label={`${group.label} views`}
      className="flex flex-wrap gap-1 mb-6 border-b border-border pb-3"
    >
      {group.items.map((item) => (
        <Button
          key={item.id}
          variant={view === item.id ? "secondary" : "ghost"}
          size="sm"
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
          className={cn("text-xs", view === item.id && "font-bold")}
        >
          {item.label}
        </Button>
      ))}
    </nav>
  );
}
