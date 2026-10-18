import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { LEVELS } from "@/constants";
import { fetchSiteLevels } from "@/lib/site-levels";

export interface PickedLevel {
  id: string;
  name: string;
  /** True when the id refers to a site-hosted level (id is `site:<siteId>`). */
  site?: boolean;
}

interface CommunityLevel {
  level_id?: string;
  id?: string | number;
  name?: string;
}

/** The id prefix a site level carries through the picker. */
export const SITE_ID_PREFIX = "site:";
/** The raw site level id behind a `site:<id>` picker value. */
export function siteIdOf(pickerId: string): string | null {
  return pickerId.startsWith(SITE_ID_PREFIX) ? pickerId.slice(SITE_ID_PREFIX.length) : null;
}

/** Officials come from the bundled level list; community levels are fetched. */
type Tab = "officials" | "community" | "site";

/**
 * A searchable level picker for the tools views. Officials are filtered locally
 * from the bundled `LEVELS`; community levels (including custom ones the tools
 * can also run) are searched against `/api/published-levels`, so any published
 * level can be picked and optimized, not just the built-in packs.
 */
export function LevelPicker({
  value,
  onChange,
  extra,
  className,
}: {
  value: string;
  onChange: (level: PickedLevel) => void;
  /** In-memory levels (e.g. one authored in the editor) shown above the tabs. */
  extra?: PickedLevel[];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("officials");
  const [query, setQuery] = React.useState("");
  const [community, setCommunity] = React.useState<PickedLevel[]>([]);
  const [site, setSite] = React.useState<PickedLevel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const officialMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = LEVELS.map((l) => ({ id: l.id, name: l.name }));
    if (!q) return list;
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
  }, [query]);

  // Community search is debounced so typing does not hammer the upstream API.
  React.useEffect(() => {
    if (tab !== "community") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = window.setTimeout(() => {
      const q = query.trim();
      fetch(
        `/api/published-levels?filter=discover&page=0${q ? `&search=${encodeURIComponent(q)}` : ""}`,
        {
          signal: AbortSignal.timeout(20000),
        },
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Search failed (${r.status})`))))
        .then((data: unknown) => {
          if (cancelled) return;
          const arr = Array.isArray(data)
            ? (data as CommunityLevel[])
            : ((data as { levels?: CommunityLevel[] })?.levels ?? []);
          setCommunity(
            arr
              .map((l) => ({
                id: String(l.level_id ?? l.id ?? ""),
                name: String(l.name ?? l.level_id ?? l.id ?? ""),
              }))
              .filter((l) => l.id),
          );
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [tab, query]);

  // Site levels are site-hosted, so they load in one request and are filtered
  // locally; the picker value is prefixed so callers can tell them apart.
  React.useEffect(() => {
    if (tab !== "site" || site.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSiteLevels()
      .then((levels) => {
        if (cancelled) return;
        setSite(
          levels.map((l) => ({
            id: `${SITE_ID_PREFIX}${l.id}`,
            name: l.name,
            site: true,
          })),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, site.length]);

  const siteMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return site;
    return site.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
  }, [site, query]);

  const displayName = React.useMemo(() => {
    const inMemory = extra?.find((l) => l.id === value);
    if (inMemory) return inMemory.name;
    const official = LEVELS.find((l) => l.id === value);
    if (official) return official.name;
    const picked = community.find((l) => l.id === value);
    if (picked) return picked.name;
    const sitePicked = site.find((l) => l.id === value);
    return sitePicked?.name ?? value;
  }, [value, community, site, extra]);

  const list = tab === "officials" ? officialMatches : tab === "community" ? community : siteMatches;

  const pick = (level: PickedLevel) => {
    onChange(level);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 justify-between text-xs bg-white/5 border-white/10 font-normal",
            className,
          )}
        >
          <span className="truncate">{displayName || "Pick a level"}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[22rem] p-0 bg-[#1a1a1a] border-white/10 text-slate-200"
      >
        <div className="flex items-center gap-1 border-b border-white/10 p-1">
          {(["officials", "community", "site"] as const).map((t) => (
            <button
              key={t}
              className={cn(
                "flex-1 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors",
                tab === t
                  ? "bg-white/10 text-[var(--app-accent)]"
                  : "text-slate-500 hover:text-slate-300",
              )}
              onClick={() => setTab(t)}
            >
              {t === "officials" ? "Officials" : t === "community" ? "Community" : "Site"}
            </button>
          ))}
        </div>
        <div className="relative border-b border-white/10">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "officials"
                ? "Search official levels"
                : tab === "community"
                  ? "Search community levels"
                  : "Search site levels"
            }
            className="h-9 border-0 bg-transparent pl-7 text-xs focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {extra && extra.length > 0 && (
            <>
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                In-memory
              </p>
              {extra.map((level) => (
                <button
                  key={level.id}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/5",
                    level.id === value ? "text-[var(--app-accent)]" : "text-slate-200",
                  )}
                  onClick={() => pick(level)}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      level.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{level.name}</span>
                </button>
              ))}
            </>
          )}
          {loading && (tab === "community" || tab === "site") && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tab === "site" ? "Loading site levels…" : "Searching community levels…"}
            </div>
          )}
          {error && (tab === "community" || tab === "site") && (
            <p className="px-3 py-2 text-[11px] text-red-400">{error}</p>
          )}
          {!loading && !error && list.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-slate-500">No levels found.</p>
          )}
          {list.slice(0, 100).map((level) => (
            <button
              key={level.id}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/5",
                level.id === value ? "text-[var(--app-accent)]" : "text-slate-200",
              )}
              onClick={() => pick(level)}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  level.id === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="truncate">{level.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
