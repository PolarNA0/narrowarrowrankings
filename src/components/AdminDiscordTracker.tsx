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

const DEFAULT_TAS_TEMPLATES: Record<Slot, string> = {
  narrow:
    "{champion}{emoji}{tasBadge} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
  speedy:
    "{champion}{emoji}{tasBadge} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
  energy:
    "{champion}{emoji}{tasBadge} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
};

/** The TAS feed's own emojis: the same custom Discord emojis the real feed uses. */
const DEFAULT_TAS_CHAMPION = "<:champion:1351205618534449223>";
const DEFAULT_TAS_BADGE = "<a:TAS:1561061187515449454>";
const DEFAULT_TAS_EMOJIS: Record<Slot, string> = {
  narrow: "<:narrow:1356331491746910319>",
  speedy: "<:speedy:1356331493160386620>",
  energy: "<:energy:1356331490010464421>",
};

/** The site feed's own emojis: the same custom Discord emojis the other feeds use. */
// Kept in step with the server defaults in `site-tracker.server.ts`; the two
// templates are separate because a WR and a lower placement say different
// things.
const DEFAULT_SITE_WR_TEMPLATE =
  "{champion}{emoji} **{player}** beat the world record on {siteBadge}**{level}** with **{time}** [{wrDiff}]";
const DEFAULT_SITE_POSITION_TEMPLATE =
  "{emoji} **{player}** took position **{position}** on **{level}** with **{time}** [{wrDiff}]";
/** The pre-split default, so a config saved with it adopts the new wording. */
const LEGACY_SITE_TEMPLATE =
  "{emoji}{siteBadge} **{player}** set a new site record on **{level}** with **{time}** [{siteTag}]";
const DEFAULT_SITE_BADGE = "";
const DEFAULT_SITE_CHAMPION = "";
const DEFAULT_SITE_EMOJIS: Record<Slot, string> = {
  narrow: "<:narrow:1356331491746910319>",
  speedy: "<:speedy:1356331493160386620>",
  energy: "<:energy:1356331490010464421>",
};

/** The old built-in emoji set, so a saved config that still carries it picks up
 *  the new custom ones instead of overriding them. */
const LEGACY_TAS_EMOJIS = new Set(["🏆", "🏹", "💨", "⚡"]);
const pickTasEmoji = (slot: Slot, saved?: string) =>
  saved && !LEGACY_TAS_EMOJIS.has(saved) ? saved : DEFAULT_TAS_EMOJIS[slot];

/** Admin controls for the Discord record notifiers (real + TAS). */
export function AdminDiscordTracker() {
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [intervalMinutes, setIntervalMinutes] = React.useState(5);
  const [templates, setTemplates] = React.useState<Record<Slot, string>>(DEFAULT_TEMPLATES);
  const [emojis, setEmojis] = React.useState<Record<Slot, string>>(DEFAULT_EMOJIS);
  const [tasEnabled, setTasEnabled] = React.useState(true);
  const [tasIntervalMinutes, setTasIntervalMinutes] = React.useState(5);
  const [tasTemplates, setTasTemplates] =
    React.useState<Record<Slot, string>>(DEFAULT_TAS_TEMPLATES);
  const [tasEmojis, setTasEmojis] = React.useState<Record<Slot, string>>(DEFAULT_TAS_EMOJIS);
  const [tasChampion, setTasChampion] = React.useState(DEFAULT_TAS_CHAMPION);
  const [tasBadge, setTasBadge] = React.useState(DEFAULT_TAS_BADGE);
  const [tasWebhookUrl, setTasWebhookUrl] = React.useState("");
  const [siteEnabled, setSiteEnabled] = React.useState(true);
  const [siteIntervalMinutes, setSiteIntervalMinutes] = React.useState(5);
  const [siteTemplate, setSiteTemplate] = React.useState(DEFAULT_SITE_WR_TEMPLATE);
  const [sitePositionTemplate, setSitePositionTemplate] = React.useState(
    DEFAULT_SITE_POSITION_TEMPLATE,
  );
  const [siteChampion, setSiteChampion] = React.useState(DEFAULT_SITE_CHAMPION);
  const [siteBadge, setSiteBadge] = React.useState(DEFAULT_SITE_BADGE);
  const [siteEmojis, setSiteEmojis] = React.useState<Record<Slot, string>>(DEFAULT_SITE_EMOJIS);
  const [siteWebhookUrl, setSiteWebhookUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [tasChecking, setTasChecking] = React.useState(false);
  const [siteChecking, setSiteChecking] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "configs", "discordTracker"));
        const data = snap.data();
        if (!data) return;
        setWebhookUrl(data.webhookUrl || "");
        setEnabled(data.enabled !== false);
        setIntervalMinutes(Number(data.intervalMinutes) || 5);
        setTemplates({ ...DEFAULT_TEMPLATES, ...(data.templates || {}) });
        setEmojis({ ...DEFAULT_EMOJIS, ...(data.emojis || {}) });
        setTasEnabled(data.tasEnabled !== false);
        setTasIntervalMinutes(Number(data.tasIntervalMinutes) || Number(data.intervalMinutes) || 5);
        setTasTemplates({ ...DEFAULT_TAS_TEMPLATES, ...(data.tasTemplates || {}) });
        setTasEmojis({
          narrow: pickTasEmoji("narrow", data.tasEmojis?.narrow),
          speedy: pickTasEmoji("speedy", data.tasEmojis?.speedy),
          energy: pickTasEmoji("energy", data.tasEmojis?.energy),
        });
        setTasChampion(
          data.tasChampion && !LEGACY_TAS_EMOJIS.has(data.tasChampion)
            ? data.tasChampion
            : DEFAULT_TAS_CHAMPION,
        );
        setTasBadge(data.tasBadge ?? DEFAULT_TAS_BADGE);
        setTasWebhookUrl(data.tasWebhookUrl || "");
        setSiteEnabled(data.siteEnabled !== false);
        setSiteIntervalMinutes(
          Number(data.siteIntervalMinutes) || Number(data.intervalMinutes) || 5,
        );
        // A config saved with the pre-split default adopts the new WR wording;
        // anything hand-written is kept.
        setSiteTemplate(
          data.siteWrTemplate ||
            (data.siteTemplate && data.siteTemplate !== LEGACY_SITE_TEMPLATE
              ? data.siteTemplate
              : DEFAULT_SITE_WR_TEMPLATE),
        );
        setSitePositionTemplate(data.sitePositionTemplate || DEFAULT_SITE_POSITION_TEMPLATE);
        setSiteChampion(data.siteChampion ?? DEFAULT_SITE_CHAMPION);
        setSiteBadge(data.siteBadge ?? DEFAULT_SITE_BADGE);
        setSiteEmojis({
          narrow: pickTasEmoji("narrow", data.siteEmojis?.narrow),
          speedy: pickTasEmoji("speedy", data.siteEmojis?.speedy),
          energy: pickTasEmoji("energy", data.siteEmojis?.energy),
        });
        setSiteWebhookUrl(data.siteWebhookUrl || "");
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
        intervalMinutes: Math.max(5, Number(intervalMinutes) || 5),
        templates,
        emojis,
        tasEnabled,
        tasIntervalMinutes: Math.max(5, Number(tasIntervalMinutes) || 5),
        tasTemplates,
        tasEmojis,
        tasChampion,
        tasBadge,
        tasWebhookUrl: tasWebhookUrl.trim(),
        siteEnabled,
        siteIntervalMinutes: Math.max(5, Number(siteIntervalMinutes) || 5),
        siteWrTemplate: siteTemplate,
        sitePositionTemplate,
        siteChampion,
        siteBadge,
        siteEmojis,
        siteWebhookUrl: siteWebhookUrl.trim(),
      });
      toast.success("Discord trackers saved");
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

  const sendTasTest = async () => {
    try {
      const res = await fetch("/api/public/tas-wr-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: (tasWebhookUrl || webhookUrl).trim() }),
      });
      const payload = await res.json();
      if (payload.ok) toast.success("TAS test message sent to Discord");
      else toast.error(payload.error || `Discord replied ${payload.status}`);
    } catch {
      toast.error("Could not reach the webhook");
    }
  };

  const runTasCheck = async () => {
    setTasChecking(true);
    try {
      const res = await fetch("/api/public/tas-wr-check?force=1");
      const payload = await res.json();
      toast.success(
        payload.baseline
          ? `Baseline saved for ${payload.tracked} TAS records`
          : `${payload.newRecords} new TAS records, ${payload.sent} sent`,
      );
    } catch {
      toast.error("TAS record check failed");
    } finally {
      setTasChecking(false);
    }
  };

  const announceAllTas = async () => {
    setTasChecking(true);
    try {
      const res = await fetch("/api/public/tas-wr-check?force=1&announce=all");
      const payload = await res.json();
      toast.success(
        payload.sent
          ? `Re-announced ${payload.sent} current TAS record${payload.sent === 1 ? "" : "s"}`
          : "No TAS records to announce (set a webhook first)",
      );
    } catch {
      toast.error("TAS announcement failed");
    } finally {
      setTasChecking(false);
    }
  };

  const sendSiteTest = async () => {
    try {
      const res = await fetch("/api/public/site-wr-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: (siteWebhookUrl || webhookUrl).trim() }),
      });
      const payload = await res.json();
      if (payload.ok) toast.success("Site test message sent to Discord");
      else toast.error(payload.error || `Discord replied ${payload.status}`);
    } catch {
      toast.error("Could not reach the webhook");
    }
  };

  const runSiteCheck = async () => {
    setSiteChecking(true);
    try {
      const res = await fetch("/api/public/site-wr-check?force=1");
      const payload = await res.json();
      // A record found but nothing sent means the feed has no webhook — say so
      // rather than reporting a cheerful "0 sent" that reads like success.
      if (payload.newRecords > 0 && payload.sent === 0) {
        toast.error(
          `${payload.newRecords} site record${payload.newRecords === 1 ? "" : "s"} found but nothing was sent — set a webhook and save.`,
        );
      } else {
        toast.success(
          payload.baseline
            ? `Baseline saved for ${payload.tracked} site records — use "Announce current records" to post them`
            : `${payload.newRecords} new site records, ${payload.sent} sent`,
        );
      }
    } catch {
      toast.error("Site record check failed");
    } finally {
      setSiteChecking(false);
    }
  };

  const announceAllSite = async () => {
    setSiteChecking(true);
    try {
      const res = await fetch("/api/public/site-wr-check?force=1&announce=all");
      const payload = await res.json();
      if (payload.sent === 0) {
        toast.error(
          payload.newRecords > 0
            ? `${payload.newRecords} site record${payload.newRecords === 1 ? "" : "s"} found but nothing was sent — set a webhook and save.`
            : "No site records to announce.",
        );
      } else {
        toast.success(
          `Re-announced ${payload.sent} current site record${payload.sent === 1 ? "" : "s"}`,
        );
      }
    } catch {
      toast.error("Site announcement failed");
    } finally {
      setSiteChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-[var(--app-accent)]" /> WR Webhook
          </CardTitle>
          <CardDescription>
            Paste a Discord webhook URL — real-game category world records (non-overall arrow
            records) are announced there. Records are checked automatically every 5 minutes. The TAS
            and site level trackers below share this webhook unless you give them their own.
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
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={5}
              step={5}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="w-24 bg-black/40 border-white/10 text-xs"
            />
            <span className="text-xs text-slate-400">
              Minutes between record checks (minimum 5). Save to apply.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={sendTest}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <Send className="w-4 h-4 mr-2" /> Send test
            </Button>
            <Button
              onClick={runCheck}
              disabled={checking}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <RefreshCw className={checking ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} />{" "}
              Check records now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">
            Messages
          </CardTitle>
          <CardDescription>
            Tags: {"{emoji} {player} {level} {time} {wrDiff} {catDiff} {previous} {arrow}"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {SLOTS.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                  {label}
                </span>
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
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[var(--app-accent)] text-slate-950 font-bold hover:bg-[var(--app-accent)]/80"
          >
            <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-[var(--app-accent)]" /> TAS Webhook
          </CardTitle>
          <CardDescription>
            Announces TAS world records only — the fastest tool-assisted run per level and arrow.
            Uses the same webhook above unless you paste a separate one here.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <Input
            value={tasWebhookUrl}
            onChange={(e) => setTasWebhookUrl(e.target.value)}
            placeholder="Leave blank to reuse the webhook above"
            className="bg-black/40 border-white/10 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Input
              value={tasChampion}
              onChange={(e) => setTasChampion(e.target.value)}
              className="w-32 bg-black/40 border-white/10 text-xs"
              placeholder="🏆"
            />
            <span className="text-xs text-slate-400">
              Champion badge, prefixed before the arrow emoji in every TAS message.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={tasBadge}
              onChange={(e) => setTasBadge(e.target.value)}
              className="w-40 bg-black/40 border-white/10 text-xs font-mono"
              placeholder="<a:TAS:…>"
            />
            <span className="text-xs text-slate-400">
              TAS badge, shown right after the arrow emoji (the <code>{"{tasBadge}"}</code> tag).
              Clear it to hide.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={tasEnabled} onCheckedChange={setTasEnabled} />
            <span className="text-xs text-slate-400">TAS announcements enabled</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={5}
              step={5}
              value={tasIntervalMinutes}
              onChange={(e) => setTasIntervalMinutes(Number(e.target.value))}
              className="w-24 bg-black/40 border-white/10 text-xs"
            />
            <span className="text-xs text-slate-400">
              Minutes between TAS checks (minimum 5). Save to apply.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={sendTasTest}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <Send className="w-4 h-4 mr-2" /> Send test
            </Button>
            <Button
              onClick={runTasCheck}
              disabled={tasChecking}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <RefreshCw className={tasChecking ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} />{" "}
              Check TAS now
            </Button>
            <Button
              onClick={announceAllTas}
              disabled={tasChecking}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <Send className="w-4 h-4 mr-2" /> Announce current records
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">
            TAS Messages
          </CardTitle>
          <CardDescription>
            {
              "Tags: {champion} {emoji} {tasBadge} {player} {level} {time} {wr} {wrDiff} {catDiff} {previous} {arrow} — {champion} is the champion badge (🏆), {emoji} the arrow, {tasBadge} the TAS badge shown after the arrow, {wrDiff} is how far the TAS is ahead of the real WR, {catDiff} the gain over the previous TAS."
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {SLOTS.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                  {label}
                </span>
                <Input
                  value={tasEmojis[key]}
                  onChange={(e) => setTasEmojis((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-32 bg-black/40 border-white/10 text-xs"
                  placeholder="emoji"
                />
              </div>
              <Textarea
                value={tasTemplates[key]}
                onChange={(e) => setTasTemplates((prev) => ({ ...prev, [key]: e.target.value }))}
                rows={3}
                className="bg-black/40 border-white/10 font-mono text-xs"
              />
            </div>
          ))}
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[var(--app-accent)] text-slate-950 font-bold hover:bg-[var(--app-accent)]/80"
          >
            <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-[var(--app-accent)]" /> Site Level Webhook
          </CardTitle>
          <CardDescription>
            Announces records on site-hosted levels (authored in the Level editor). A site level has
            one board, so each level's fastest run is announced here — separate from the real-game
            and TAS feeds. Uses the webhook above unless you paste a separate one here.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <Input
            value={siteWebhookUrl}
            onChange={(e) => setSiteWebhookUrl(e.target.value)}
            placeholder="Leave blank to reuse the webhook above"
            className="bg-black/40 border-white/10 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Input
              value={siteBadge}
              onChange={(e) => setSiteBadge(e.target.value)}
              className="w-40 bg-black/40 border-white/10 text-xs font-mono"
              placeholder="<a:SITE:…>"
            />
            <span className="text-xs text-slate-400">
              Badge shown right after the arrow emoji (the <code>{"{siteBadge}"}</code> tag). Clear
              it to hide.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={siteChampion}
              onChange={(e) => setSiteChampion(e.target.value)}
              className="w-40 bg-black/40 border-white/10 text-xs font-mono"
              placeholder="<:champion:…>"
            />
            <span className="text-xs text-slate-400">
              Mark shown before a world record (the <code>{"{champion}"}</code> tag). Clear it to
              hide.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={siteEnabled} onCheckedChange={setSiteEnabled} />
            <span className="text-xs text-slate-400">Site announcements enabled</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={5}
              step={5}
              value={siteIntervalMinutes}
              onChange={(e) => setSiteIntervalMinutes(Number(e.target.value))}
              className="w-24 bg-black/40 border-white/10 text-xs"
            />
            <span className="text-xs text-slate-400">
              Minutes between site checks (minimum 5). Save to apply.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={sendSiteTest}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <Send className="w-4 h-4 mr-2" /> Send test
            </Button>
            <Button
              onClick={runSiteCheck}
              disabled={siteChecking}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <RefreshCw className={siteChecking ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} />{" "}
              Check site now
            </Button>
            <Button
              onClick={announceAllSite}
              disabled={siteChecking}
              variant="outline"
              className="border-white/10 hover:bg-white/5"
            >
              <Send className="w-4 h-4 mr-2" /> Announce current records
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 pb-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">
            Site Message
          </CardTitle>
          <CardDescription>
            {
              'Two messages: the world-record one (a run that takes 1st) and the position one (a run that places 2nd or worse, announced from the submit path). Tags: {emoji} {siteBadge} {champion} {player} {level} {time} {clock} {arrow} {author} {custom} {position} {wrDiff} {diff} {previous} {recordHolder} — {emoji} is the run\'s arrow, {time} is seconds and {clock} the m:ss.mmm clock, {position} is the place (1, 2, 3…), {wrDiff} is the ready-made "WR -x.xxx" (ahead) or "WR +x.xxx" (behind) bracket, {diff} the raw signed gap, {recordHolder} the current record holder and {champion} the mark above.'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                Arrow emojis (by the record run&apos;s arrow)
              </span>
            </div>
            {SLOTS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">
                  {label}
                </span>
                <Input
                  value={siteEmojis[key]}
                  onChange={(e) => setSiteEmojis((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-32 bg-black/40 border-white/10 text-xs"
                  placeholder="emoji"
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
              World record (1st place)
            </span>
            <Textarea
              value={siteTemplate}
              onChange={(e) => setSiteTemplate(e.target.value)}
              rows={3}
              className="bg-black/40 border-white/10 font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
              Position (2nd place or worse)
            </span>
            <Textarea
              value={sitePositionTemplate}
              onChange={(e) => setSitePositionTemplate(e.target.value)}
              rows={3}
              className="bg-black/40 border-white/10 font-mono text-xs"
            />
          </div>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[var(--app-accent)] text-slate-950 font-bold hover:bg-[var(--app-accent)]/80"
          >
            <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
