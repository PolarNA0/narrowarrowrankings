import * as React from "react";
import { Crown, Download, Medal, RefreshCw, Search, Sparkles, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface CompletionRow {
  username: string;
  first: number;
  second: number;
  third: number;
  top10: number;
  completed: number;
  points: number;
}

interface Snapshot {
  done: boolean;
  loaded: number;
  total: number;
  updatedAt: number;
  levels: Array<{ id: string; name: string; creator: string }>;
  players: CompletionRow[];
}

type SortKey = "first" | "second" | "third" | "top10" | "completed" | "points";

interface Props {
  onSelectPlayer?: (username: string) => void;
}

export function CustomCompletionsView({ onSelectPlayer }: Props) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("first");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/custom-completions");
      if (!res.ok) return;
      setSnapshot((await res.json()) as Snapshot);
    } catch (error) {
      console.error("custom completions load failed", error);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => {
      setSnapshot((current) => {
        if (!current || !current.done) void load();
        return current;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const rows = React.useMemo(() => {
    const list = [...(snapshot?.players ?? [])];
    list.sort((a, b) => b[sortKey] - a[sortKey] || b.first - a.first || b.completed - a.completed);
    const q = query.trim().toLowerCase();
    return q ? list.filter((r) => r.username.toLowerCase().includes(q)) : list;
  }, [snapshot, query, sortKey]);

  const exportCsv = () => {
    const header = "rank,player,1st,2nd,3rd,top10,completed,points\n";
    const body = rows
      .map((r, i) => [i + 1, r.username, r.first, r.second, r.third, r.top10, r.completed, r.points].join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "custom-completions.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const progress = snapshot ? Math.round((snapshot.loaded / Math.max(1, snapshot.total)) * 100) : 0;

  const columns: Array<{ key: SortKey; label: string; className: string }> = [
    { key: "first", label: "1st", className: "text-amber-400" },
    { key: "second", label: "2nd", className: "text-slate-300" },
    { key: "third", label: "3rd", className: "text-orange-400" },
    { key: "top10", label: "Top 10", className: "text-[var(--app-accent)]" },
    { key: "completed", label: "Completed", className: "text-emerald-400" },
    { key: "points", label: "Points", className: "text-fuchsia-400" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--app-accent)]" /> Custom Completions
          </h2>
          <p className="text-slate-500 text-sm">
            Medal counts across the {snapshot?.levels.length ?? 0} most popular community levels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player"
              className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
            />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9 border-white/10 bg-white/5" onClick={exportCsv}>
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 border-white/10 bg-white/5" onClick={() => void load()}>
            <RefreshCw className={cn("w-4 h-4", snapshot && !snapshot.done && "animate-spin")} />
          </Button>
        </div>
      </div>

      {snapshot && !snapshot.done && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-slate-500">
            <span>Scanning custom leaderboards…</span>
            <span>
              {snapshot.loaded}/{snapshot.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-[var(--app-accent)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Players tracked", value: snapshot?.players.length ?? 0, icon: Trophy },
          { label: "Levels scanned", value: snapshot?.levels.length ?? 0, icon: Sparkles },
          { label: "Golds handed out", value: snapshot?.players.reduce((a, p) => a + p.first, 0) ?? 0, icon: Crown },
          { label: "Total completions", value: snapshot?.players.reduce((a, p) => a + p.completed, 0) ?? 0, icon: Medal },
        ].map((stat) => (
          <Card key={stat.label} className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                <stat.icon className="w-3.5 h-3.5 text-[var(--app-accent)]" /> {stat.label}
              </div>
              <div className="text-2xl font-bold text-white mt-1 font-mono">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
          <CardTitle className="text-base font-bold text-white">Community medal table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/[0.02]">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="w-14 text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">#</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Player</TableHead>
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      onClick={() => setSortKey(col.key)}
                      className={cn(
                        "text-center font-mono text-[10px] uppercase tracking-widest cursor-pointer select-none",
                        sortKey === col.key ? col.className : "text-slate-500 hover:text-white",
                      )}
                    >
                      {col.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-500 font-mono text-xs">
                      {snapshot?.done ? "No players found." : "Building the medal table…"}
                    </TableCell>
                  </TableRow>
                )}
                {rows.slice(0, 300).map((row, index) => (
                  <TableRow
                    key={row.username}
                    className="border-white/5 hover:bg-white/[0.03] cursor-pointer"
                    onClick={() => onSelectPlayer?.(row.username)}
                  >
                    <TableCell className="text-center font-mono text-slate-500">{index + 1}</TableCell>
                    <TableCell className="font-bold text-white whitespace-nowrap">
                      {row.username}
                      {index === 0 && (
                        <Badge className="ml-2 bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] uppercase">
                          Top
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono font-bold text-amber-400">{row.first}</TableCell>
                    <TableCell className="text-center font-mono text-slate-300">{row.second}</TableCell>
                    <TableCell className="text-center font-mono text-orange-400">{row.third}</TableCell>
                    <TableCell className="text-center font-mono text-[var(--app-accent)]">{row.top10}</TableCell>
                    <TableCell className="text-center font-mono text-emerald-400">{row.completed}</TableCell>
                    <TableCell className="text-center font-mono text-fuchsia-400">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
