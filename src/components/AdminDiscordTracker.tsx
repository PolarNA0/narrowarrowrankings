import * as React from "react";
import { Send, Save, RefreshCw, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { doc, getDoc, setDoc, db } from "@/lib/cloud-db";
import { toast } from "sonner";

type Slot = "narrow" | "speedy" | "energy";

const SLOTS: Array<{ key: Slot; label: string }> = [
  { key: "narrow", label: "Narrow Arrow (pink)" },
  { key: "speedy", label: "Speedy Arrow (blue)" },
  { key: "energy", label: "Energy Arrow (green)" },
];

const DEFAULT_TEMPLATES: Record<Slot, string> = {
  narrow:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [narrow wr -{catDiff}]",
  speedy:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [speedy wr -{catDiff}]",
  energy:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [energy wr -{catDiff}]",
};

const DEFAULT_EMOJIS: Record<Slot, string> = { narrow: "🏹", speedy: "💨", energy: "⚡" };

/** Admin controls for the Discord category-record notifier. */
export function AdminDiscordTracker() {
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [templates, setTemplates] = React.useState<Record<Slot, string>>(DEFAULT_TEMPLATES);
  const [emojis, setEmojis] = React.useState<Record<Slot, string>>(DEFAULT_EMOJIS);
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "configs", "discordTracker"));
        const data = snap.data();
        if (!data) return;
        setWebhookUrl(data.webhookUrl || "");
        setEnabled(data.enabled !== false);
        setTemplates({ ...DEFAULT_TEMPLATES, ...(data.templates || {}) });
        setEmojis({ ...DEFAULT_EMOJIS, ...(data.emojis || {}) });
      } catch {
        /* first-time setup */
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "configs", "discordTracker"), {
        webhookUrl: webhookUrl.trim(),
        enabled,
        templates,
        emojis,
      });
      toast.success("Discord tracker saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    try {
      const res = await fetch("/api/public/category-wr-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      });
      const payload = await res.json();
      if (payload.ok) toast.success("Test message sent to Discord");
      else toast.error(payload.error || `Discord replied ${payload.status}`);
    } catch {
      toast.error("Could not reach the webhook");
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/public/category-wr-check?force=1");
      const payload = await res.json();
      toast.success(
        payload.baseline
          ? `Baseline saved for ${payload.tracked} category records`
          : `${payload.newRecords} new category records, ${payload.sent} sent`,
      );
    } catch {
      toast.error("Record check failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-[var(--app-accent)]" /> Discord Webhook
          </CardTitle>
          <CardDescription>
            Paste a Discord webhook URL — category world records (non-overall arrow records) are announced there.
            Records are checked automatically every 5 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="bg-black/40 border-white/10 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-xs text-slate-400">Announcements enabled</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={sendTest} variant="outline" className="border-white/10 hover:bg-white/5">
              <Send className="w-4 h-4 mr-2" /> Send test
            </Button>
            <Button onClick={runCheck} disabled={checking} variant="outline" className="border-white/10 hover:bg-white/5">
              <RefreshCw className={checking ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} /> Check records now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">Messages</CardTitle>
          <CardDescription>
            Tags: {"{emoji} {player} {level} {time} {wrDiff} {catDiff} {previous} {arrow}"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {SLOTS.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{label}</span>
                <Input
                  value={emojis[key]}
                  onChange={(e) => setEmojis((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-32 bg-black/40 border-white/10 text-xs"
                  placeholder="emoji"
                />
              </div>
              <Textarea
                value={templates[key]}
                onChange={(e) => setTemplates((prev) => ({ ...prev, [key]: e.target.value }))}
                rows={3}
                className="bg-black/40 border-white/10 font-mono text-xs"
              />
            </div>
          ))}
          <Button onClick={save} disabled={saving} className="bg-[var(--app-accent)] text-slate-950 font-bold hover:bg-[var(--app-accent)]/80">
            <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
