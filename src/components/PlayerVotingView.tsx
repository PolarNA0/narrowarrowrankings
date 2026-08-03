import * as React from "react";
import { Search, ThumbsDown, ThumbsUp, Vote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePlayerVotes, VOTE_CATEGORIES, type VoteCategory } from "@/hooks/usePlayerVotes";

interface Props {
  usernames: string[];
  signedIn: boolean;
  userId?: string | null;
  onSelectPlayer?: (username: string) => void;
  onRequestSignIn?: () => void;
}

type SortKey = "total" | VoteCategory | "name";

const PAGE = 60;

/** Community rating board: +1 / -1 per player across three skill categories. */
export function PlayerVotingView({ usernames, signedIn, userId, onSelectPlayer, onRequestSignIn }: Props) {
  const { totals, myVotes, vote } = usePlayerVotes(userId);
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("total");
  const [visible, setVisible] = React.useState(PAGE);

  const roster = React.useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const name of usernames) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(name);
      }
    }
    for (const key of Object.keys(totals)) {
      if (!seen.has(key)) {
        seen.add(key);
        list.push(key);
      }
    }
    return list;
  }, [usernames, totals]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = roster
      .filter((name) => !q || name.toLowerCase().includes(q))
      .map((name) => ({
        username: name,
        score: totals[name.toLowerCase()] ?? { official: 0, hard: 0, custom: 0, total: 0, voters: 0 },
      }));
    list.sort((a, b) => {
      if (sortKey === "name") return a.username.localeCompare(b.username);
      return b.score[sortKey] - a.score[sortKey] || a.username.localeCompare(b.username);
    });
    return list;
  }, [roster, totals, query, sortKey]);

  const cast = async (username: string, category: VoteCategory, value: 1 | -1) => {
    if (!signedIn) {
      onRequestSignIn?.();
      toast.error("Sign in to vote.");
      return;
    }
    try {
      await vote(username, category, value);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Vote failed");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Vote className="w-5 h-5 text-[var(--app-accent)]" /> Player Voting
          </h2>
          <p className="text-slate-500 text-sm">
            Rate players +1 or -1 on official levels, hard levels and custom levels. One vote each per category.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE);
              }}
              placeholder="Search player"
              className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["total", "official", "hard", "custom", "name"] as SortKey[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="ghost"
            onClick={() => setSortKey(key)}
            className={cn(
              "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
              sortKey === key ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400",
            )}
          >
            {key === "total" ? "Overall" : key === "name" ? "A–Z" : key}
          </Button>
        ))}
      </div>

      {!signedIn && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 text-sm text-slate-400">
            You can browse the ratings freely — sign in from the profile icon to cast votes.
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
          <CardTitle className="text-base font-bold text-white">
            Community ratings ({rows.length.toLocaleString()} players)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-white/5">
          {rows.slice(0, visible).map((row) => {
            const mine = myVotes[row.username.toLowerCase()] ?? {};
            return (
              <div key={row.username} className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-3 lg:w-64 min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectPlayer?.(row.username)}
                    className="font-bold text-white truncate hover:text-[var(--app-accent)]"
                  >
                    {row.username}
                  </button>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px] border-white/10",
                      row.score.total > 0
                        ? "text-emerald-300 bg-emerald-400/10"
                        : row.score.total < 0
                          ? "text-rose-300 bg-rose-400/10"
                          : "text-slate-400 bg-white/5",
                    )}
                  >
                    {row.score.total > 0 ? "+" : ""}
                    {row.score.total}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                  {VOTE_CATEGORIES.map((category) => {
                    const value = row.score[category.id];
                    const my = mine[category.id];
                    return (
                      <div
                        key={category.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold truncate">
                            {category.label}
                          </div>
                          <div className="font-mono text-sm font-bold text-white">
                            {value > 0 ? "+" : ""}
                            {value}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={`Upvote ${category.blurb}`}
                            onClick={() => void cast(row.username, category.id, 1)}
                            className={cn(
                              "h-7 w-7 border border-white/10",
                              my === 1 ? "bg-emerald-400/20 text-emerald-300" : "text-slate-400 hover:text-white",
                            )}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={`Downvote ${category.blurb}`}
                            onClick={() => void cast(row.username, category.id, -1)}
                            className={cn(
                              "h-7 w-7 border border-white/10",
                              my === -1 ? "bg-rose-400/20 text-rose-300" : "text-slate-400 hover:text-white",
                            )}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">No players match that search.</div>
          )}
        </CardContent>
      </Card>

      {visible < rows.length && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setVisible((v) => v + PAGE * 2)}
            className="border-white/10 bg-white/5 text-slate-300"
          >
            Show more ({rows.length - visible} left)
          </Button>
        </div>
      )}
    </div>
  );
}
