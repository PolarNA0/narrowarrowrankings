import * as React from "react";
import { Flag, Loader2, Lock, Plus, Save, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LevelPicker, type PickedLevel } from "@/components/LevelPicker";
import {
  deleteCampaignRequest,
  fetchCampaign,
  fetchCampaigns,
  freezeCampaignRequest,
  saveCampaignRequest,
  type CampaignSummary,
} from "@/lib/campaign-client";
import { campaignPaletteColor, type CampaignLevel } from "@/lib/campaign";

/** ISO date input value (`YYYY-MM-DD`) for an epoch ms. */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight local time on a `YYYY-MM-DD`, so a window covers whole days. */
function fromDateInput(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

interface Draft {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  levels: CampaignLevel[];
}

function emptyDraft(): Draft {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  return {
    id: `campaign-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    name: "New campaign",
    startsOn: toDateInput(start.getTime()),
    endsOn: toDateInput(end.getTime()),
    levels: [],
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a save/delete/freeze so the view can refetch. */
  onChanged: () => void;
}

export function CampaignCuratorDialog({ open, onOpenChange, onChanged }: Props) {
  const [summaries, setSummaries] = React.useState<CampaignSummary[]>([]);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [frozen, setFrozen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refreshList = React.useCallback(async () => {
    try {
      setSummaries(await fetchCampaigns());
    } catch {
      /* the list is a convenience; a failure to read it is not fatal here */
    }
  }, []);

  React.useEffect(() => {
    if (open) void refreshList();
  }, [open, refreshList]);

  const loadCampaign = React.useCallback(async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const detail = await fetchCampaign(id);
      if (!detail) {
        setMessage({ kind: "err", text: "That campaign no longer exists." });
        return;
      }
      const c = detail.campaign;
      setDraft({
        id: c.id,
        name: c.name,
        startsOn: toDateInput(c.startsAt),
        endsOn: toDateInput(c.endsAt),
        levels: c.levels.map((l) => ({ ...l })),
      });
      setEditingId(c.id);
      setFrozen(c.frozenAt !== null);
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to load." });
    } finally {
      setBusy(false);
    }
  }, []);

  const startNew = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setFrozen(false);
    setMessage(null);
  };

  /**
   * Adds every picked level in one go, skipping any already in the campaign and
   * assigning each a colour from the palette by its position in the list, so a
   * bulk add comes out visually varied.
   */
  const addLevels = (picked: PickedLevel[]) => {
    setDraft((d) => {
      const existing = new Set(d.levels.map((l) => l.id));
      const fresh = picked
        .filter((p) => p.id && !existing.has(p.id))
        .map((p, i) => ({
          id: p.id,
          name: p.name,
          color: campaignPaletteColor(d.levels.length + i),
        }));
      if (fresh.length === 0) return d;
      return { ...d, levels: [...d.levels, ...fresh] };
    });
  };

  const setLevelColor = (levelId: string, color: string) => {
    setDraft((d) => ({
      ...d,
      levels: d.levels.map((l) => (l.id === levelId ? { ...l, color } : l)),
    }));
  };

  const removeLevel = (levelId: string) => {
    setDraft((d) => ({ ...d, levels: d.levels.filter((l) => l.id !== levelId) }));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveCampaignRequest({
        id: draft.id,
        name: draft.name,
        startsAt: fromDateInput(draft.startsOn),
        endsAt: fromDateInput(draft.endsOn) + 24 * 60 * 60 * 1000 - 1,
        levels: draft.levels,
      });
      setMessage({ kind: "ok", text: "Campaign saved." });
      setEditingId(draft.id);
      await refreshList();
      onChanged();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  };

  const freeze = async () => {
    if (!editingId) return;
    setBusy(true);
    setMessage(null);
    try {
      await freezeCampaignRequest(editingId);
      setFrozen(true);
      setMessage({ kind: "ok", text: "Standings frozen. This result is now final." });
      await refreshList();
      onChanged();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Freeze failed." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteCampaignRequest(editingId);
      setMessage({ kind: "ok", text: "Campaign deleted." });
      startNew();
      await refreshList();
      onChanged();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Delete failed." });
    } finally {
      setBusy(false);
    }
  };

  const readOnly = frozen;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto bg-[#0b1020] border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Flag className="w-4 h-4 text-[var(--app-accent)]" /> Campaign curator
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Hand-pick the levels, give each one its own colour, and set the window. Levels are
            frozen once the campaign closes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Existing campaigns */}
          <div className="flex flex-wrap items-center gap-2">
            {summaries.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant="ghost"
                onClick={() => void loadCampaign(s.id)}
                className={cn(
                  "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
                  editingId === s.id
                    ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                    : "text-slate-400",
                )}
              >
                {s.name}
                {s.frozen && <Lock className="w-3 h-3 ml-2" />}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={startNew}
              className="h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10 text-slate-300"
            >
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </div>

          {readOnly && (
            <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5" /> This campaign is closed. Its result is final and
              cannot be edited.
            </div>
          )}

          {/* Identity + window */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Id</span>
              <Input
                value={draft.id}
                disabled={readOnly || editingId !== null}
                onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                className="bg-black/30 border-white/10 text-sm font-mono"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Name</span>
              <Input
                value={draft.name}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="bg-black/30 border-white/10 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Starts</span>
              <Input
                type="date"
                value={draft.startsOn}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, startsOn: e.target.value }))}
                className="bg-black/30 border-white/10 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Ends</span>
              <Input
                type="date"
                value={draft.endsOn}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, endsOn: e.target.value }))}
                className="bg-black/30 border-white/10 text-sm"
              />
            </label>
          </div>

          {/* Level curation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">
                Levels ({draft.levels.length}) — hand-picked
              </div>
              <div className={cn(readOnly && "pointer-events-none opacity-50")}>
                <LevelPicker value="" onChange={() => {}} multiSelect onPickMany={addLevels} />
              </div>
            </div>

            {draft.levels.length === 0 ? (
              <div className="rounded border border-white/10 bg-black/20 px-3 py-6 text-center text-xs text-slate-500">
                No levels yet. Open the picker, tick as many as you like, then add them all at once.
                Each level gets its own colour, which you can change below.
              </div>
            ) : (
              <div className="divide-y divide-white/5 rounded border border-white/10 bg-black/20">
                {draft.levels.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-2">
                    {/* The level's identity: a dot and a ring in its own colour. */}
                    <span
                      className="flex items-center justify-center w-5 h-5 rounded-full shrink-0"
                      style={{ boxShadow: `inset 0 0 0 1.5px ${l.color}` }}
                      aria-hidden
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      style={{ color: l.color }}
                      title={l.name}
                    >
                      {l.name}
                    </span>
                    <input
                      type="color"
                      value={l.color}
                      disabled={readOnly}
                      onChange={(e) => setLevelColor(l.id, e.target.value)}
                      className="h-7 w-8 rounded border border-white/10 bg-transparent cursor-pointer shrink-0"
                      aria-label={`Colour for ${l.name}`}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeLevel(l.id)}
                        className="text-slate-500 hover:text-red-400 shrink-0"
                        aria-label={`Remove ${l.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {message && (
            <div
              className={cn(
                "rounded px-3 py-2 text-xs",
                message.kind === "ok"
                  ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : "border border-red-400/30 bg-red-400/10 text-red-200",
              )}
            >
              {message.text}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={busy || readOnly} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save campaign
            </Button>
            {editingId && !frozen && (
              <Button
                variant="ghost"
                onClick={() => void freeze()}
                disabled={busy}
                className="gap-2 text-amber-300"
              >
                <Lock className="w-4 h-4" /> Freeze standings
              </Button>
            )}
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => void remove()}
                disabled={busy}
                className="gap-2 text-red-400"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
