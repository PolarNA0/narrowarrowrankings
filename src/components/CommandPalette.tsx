import * as React from "react";
import { Command as CommandIcon, Gamepad2, User } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { LevelInfo } from "../types";

interface Props {
  levels: LevelInfo[];
  players: string[];
  onSelectLevel: (levelId: string) => void;
  onSelectPlayer: (username: string) => void;
  onNavigate: (view: string) => void;
}

const VIEWS: Array<{ id: string; label: string }> = [
  { id: "leaderboard", label: "Levels" },
  { id: "average", label: "Average leaderboard" },
  { id: "wrs", label: "World records" },
  { id: "tracker", label: "Record tracker" },
  { id: "score", label: "NarrowScore" },
  { id: "completions", label: "Custom completions" },
  { id: "customs", label: "Custom levels" },
  { id: "random", label: "Randomizer" },
];

/** Cmd/Ctrl+K palette to jump to any level, player or section. */
export function CommandPalette({ levels, players, onSelectLevel, onSelectPlayer, onNavigate }: Props) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search levels, players or sections…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {VIEWS.map((view) => (
            <CommandItem key={view.id} value={`view ${view.label}`} onSelect={() => run(() => onNavigate(view.id))}>
              <CommandIcon className="mr-2 h-4 w-4" />
              {view.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Levels">
          {levels.slice(0, 80).map((level) => (
            <CommandItem
              key={level.id}
              value={`level ${level.name}`}
              onSelect={() => run(() => onSelectLevel(level.id))}
            >
              <Gamepad2 className="mr-2 h-4 w-4" />
              {level.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Players">
          {players.slice(0, 200).map((player) => (
            <CommandItem
              key={player}
              value={`player ${player}`}
              onSelect={() => run(() => onSelectPlayer(player))}
            >
              <User className="mr-2 h-4 w-4" />
              {player}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
