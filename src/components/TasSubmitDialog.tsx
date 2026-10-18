import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { submitTasRun } from "@/lib/tas-leaderboard";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  levelId: string;
  levelName: string;
  arrowName: string;
  timeMs: number;
  inputs: string;
  inputCount: number;
  /** Prefill for the name field — the name this browser used last time. */
  defaultName?: string;
  /** Called with the submitted name so it can be remembered for next time. */
  onNameUsed?: (name: string) => void;
  /** Called after a successful submit so the board can refresh. */
  onSubmitted?: () => void;
}

/**
 * Submit a finished TAS run to the community board. The name and time are
 * typed here; the input string is attached automatically so the run can be
 * reproduced and loaded back into the editor.
 */
export function TasSubmitDialog({
  open,
  onOpenChange,
  levelId,
  levelName,
  arrowName,
  timeMs,
  inputs,
  inputCount,
  defaultName,
  onNameUsed,
  onSubmitted,
}: Props) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Remember the name across submissions: retyping it every time was the most
  // repeated chore in the flow. Still fully editable.
  React.useEffect(() => {
    if (open) setName(defaultName ?? "");
  }, [open, defaultName]);

  const submit = async () => {
    const username = name.trim();
    if (!username) {
      toast.error("Enter a name first.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitTasRun({
        levelId,
        username,
        arrowName,
        timeMs,
        inputs,
        inputCount,
      });
      onNameUsed?.(username);
      if (result.isRecord) {
        toast.success(`New TAS record! ${username} — ${(timeMs / 1000).toFixed(3)}s`, {
          description: `Fastest time on ${levelName}.`,
          duration: 6000,
        });
      } else {
        toast.success(`TAS submitted — rank #${result.rank} on ${levelName}`, {
          description: `${(timeMs / 1000).toFixed(3)}s`,
        });
      }
      onSubmitted?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit that run.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#121212] border-white/10 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Submit TAS run</DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            {levelName} · {arrowName} · {inputCount} inputs · {(timeMs / 1000).toFixed(3)}s. Your
            input string is attached automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Your name
            </Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="e.g. Polar"
              maxLength={32}
              className="bg-white/5 border-white/10 h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Time
            </Label>
            <div className="flex h-9 items-center rounded-md border border-white/10 bg-white/5 px-3 font-mono text-sm text-[var(--app-accent)]">
              {(timeMs / 1000).toFixed(3)}s
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !name.trim()}>
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-1" />
            )}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
