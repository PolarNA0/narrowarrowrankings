import * as React from "react";
import { Globe, Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nalvlToRawLevelData, type NalvlLevel } from "@/lib/nalvl";
import { publishSiteLevel } from "@/lib/site-levels";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: NalvlLevel;
  /** Called with the new level id after a successful publish. */
  onPublished?: (id: string) => void;
}

/**
 * Publish the authored level as a site level. Site levels may keep the
 * site-only wind/suction fields and accelerator wires, so the payload is
 * lowered with `nalvlToRawLevelData` (which retains them) rather than the game
 * export.
 */
export function SitePublishDialog({ open, onOpenChange, level, onPublished }: Props) {
  const [name, setName] = React.useState(level.name);
  const [author, setAuthor] = React.useState("");
  const [arrowName, setArrowName] = React.useState<string>(ARROWS[0]);
  const [publishing, setPublishing] = React.useState(false);

  React.useEffect(() => {
    if (open) setName(level.name);
  }, [open, level.name]);

  const publish = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the level a name first.");
      return;
    }
    if (!author.trim()) {
      toast.error("Enter an author name.");
      return;
    }
    setPublishing(true);
    try {
      const data = nalvlToRawLevelData(level);
      const result = await publishSiteLevel({
        name: trimmed,
        author: author.trim(),
        arrowName,
        data,
      });
      if (result.level) onPublished?.(result.level.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish that level.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#121212] border-white/10 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Publish site level</DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            Publishes to the site&apos;s own board, where anyone can play it and post times. Levels
            with wind, suction or accelerator wires keep those mechanics here (the game&apos;s
            engine cannot run them).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Level name
            </Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={48}
              className="bg-white/5 border-white/10 h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Author
            </Label>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g. Polar"
              maxLength={32}
              className="bg-white/5 border-white/10 h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Designed for
            </Label>
            <Select value={arrowName} onValueChange={setArrowName}>
              <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARROWS.map((a) => (
                  <SelectItem key={a} value={a} className="text-sm">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
            Cancel
          </Button>
          <Button onClick={() => void publish()} disabled={publishing || !name.trim()}>
            {publishing ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Globe className="w-4 h-4 mr-1" />
            )}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
