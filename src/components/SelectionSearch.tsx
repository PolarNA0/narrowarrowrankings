import { useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchOption { id: string; name: string; detail?: string }

export function SelectionSearch({ label, options, onSelect }: { label: string; options: SearchOption[]; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const normalized = query.trim().toLowerCase();
  const matches = options.filter((option) => `${option.name} ${option.id} ${option.detail ?? ""}`.toLowerCase().includes(normalized));
  const select = (id: string) => { onSelect(id); setQuery(""); setFocused(false); };
  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
    <Input aria-label={label} placeholder={label} value={query} onFocus={() => setFocused(true)} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Escape") setFocused(false);
      if (event.key === "Enter" && matches[0]) { event.preventDefault(); select(matches[0].id); }
    }} className="h-10 pl-9 pr-9 bg-card text-card-foreground border-border" />
    {query && <Button variant="ghost" size="icon" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => setQuery("")} className="absolute right-1 top-1 h-8 w-8"><X /></Button>}
    {focused && normalized && <div role="region" aria-label={`${label} results`} className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
      {matches.length ? matches.map((option) => <Button key={option.id} variant="ghost" onClick={() => select(option.id)} className="h-auto min-h-10 w-full justify-start rounded-none px-3 py-2 text-left whitespace-normal">
        <span className="min-w-0"><span className="block text-sm">{option.name}</span>{option.detail && <span className="block text-xs text-muted-foreground">{option.detail}</span>}</span>
      </Button>) : <p className="p-3 text-sm text-muted-foreground">No matches.</p>}
    </div>}
  </div>;
}