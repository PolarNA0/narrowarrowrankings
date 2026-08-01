import * as React from "react";
import { BadgeCheck, Camera, Check, Globe2, Pencil, X, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ACCENTS } from "@/hooks/useAppSettings";
import type { PlayerProfileRow } from "@/hooks/usePlayerProfiles";
import { cn } from "@/lib/utils";

interface Props {
  username: string;
  profile?: PlayerProfileRow | null;
  canEdit?: boolean;
  onSave?: (patch: Partial<PlayerProfileRow>) => Promise<void>;
  onRequestSignIn?: () => void;
  children?: React.ReactNode;
}

const EMPTY_FORM = {
  display_name: "",
  avatar_url: "",
  banner_url: "",
  accent_color: "",
  bio: "",
  country: "",
  youtube: "",
  discord: "",
};

/** Banner + avatar identity card with click-to-edit for the signed-in owner. */
export function ProfileIdentityCard({ username, profile, canEdit, onSave, onRequestSignIn, children }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);

  React.useEffect(() => {
    const socials = profile?.socials ?? {};
    setForm({
      display_name: profile?.display_name ?? "",
      avatar_url: profile?.avatar_url ?? "",
      banner_url: profile?.banner_url ?? "",
      accent_color: profile?.accent_color ?? "",
      bio: profile?.bio ?? "",
      country: profile?.country ?? "",
      youtube: socials.youtube ?? "",
      discord: socials.discord ?? "",
    });
  }, [profile]);

  const submit = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        display_name: form.display_name || null,
        avatar_url: form.avatar_url || null,
        banner_url: form.banner_url || null,
        accent_color: form.accent_color || null,
        bio: form.bio || null,
        country: form.country || null,
        socials: { youtube: form.youtube, discord: form.discord },
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const accent = profile?.accent_color || "var(--app-accent)";
  const displayName = profile?.display_name || username;

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.03]">
      <div
        className="relative h-28 md:h-36 bg-cover bg-center"
        style={{
          backgroundImage: profile?.banner_url ? `url(${profile.banner_url})` : undefined,
          background: profile?.banner_url
            ? undefined
            : `linear-gradient(120deg, ${accent}33, transparent 70%)`,
        }}
      >
        {canEdit && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            className="absolute top-3 right-3 h-8 border-white/20 bg-black/50 text-xs backdrop-blur"
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Change
          </Button>
        )}
      </div>

      <div className="p-4 md:p-5 -mt-12 flex flex-col md:flex-row md:items-end gap-4">
        <button
          type="button"
          onClick={() => (canEdit ? setEditing(true) : onRequestSignIn?.())}
          className="group relative h-24 w-24 rounded-2xl border-2 overflow-hidden bg-black shrink-0"
          style={{ borderColor: accent }}
          title={canEdit ? "Change avatar" : "Sign in to claim this profile"}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={`${displayName} avatar`} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-3xl font-black text-white/70">
              {username.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="absolute inset-0 hidden group-hover:flex items-center justify-center gap-1 bg-black/70 text-[10px] font-bold uppercase tracking-widest text-white">
            <Camera className="w-3.5 h-3.5" /> {canEdit ? "Change" : "Claim"}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight truncate">{displayName}</h2>
            {profile?.verified && (
              <BadgeCheck className="w-5 h-5" style={{ color: accent }} aria-label="Verified profile" />
            )}
            {profile?.display_name && (
              <span className="text-xs font-mono text-slate-500">@{username}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {profile?.country && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-slate-300">
                <Globe2 className="w-3 h-3 mr-1" /> {profile.country}
              </Badge>
            )}
            {profile?.socials?.youtube && (
              <a
                href={profile.socials.youtube}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-mono uppercase tracking-widest text-rose-400 hover:underline flex items-center gap-1"
              >
                <Youtube className="w-3 h-3" /> YouTube
              </a>
            )}
            {profile?.socials?.discord && (
              <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-300">
                {profile.socials.discord}
              </span>
            )}
          </div>
          {profile?.bio && <p className="text-sm text-slate-300 mt-2 max-w-2xl">{profile.bio}</p>}
          {children}
        </div>
      </div>

      {editing && (
        <div className="border-t border-white/10 bg-black/30 p-4 md:p-5 space-y-3">
          <div className="grid md:grid-cols-2 gap-2">
            <Input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Display name"
              className="bg-black/40 border-white/10"
            />
            <Input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="Country"
              className="bg-black/40 border-white/10"
            />
            <Input
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              placeholder="Avatar image URL"
              className="bg-black/40 border-white/10"
            />
            <Input
              value={form.banner_url}
              onChange={(e) => setForm({ ...form, banner_url: e.target.value })}
              placeholder="Banner image URL"
              className="bg-black/40 border-white/10"
            />
            <Input
              value={form.youtube}
              onChange={(e) => setForm({ ...form, youtube: e.target.value })}
              placeholder="YouTube link"
              className="bg-black/40 border-white/10"
            />
            <Input
              value={form.discord}
              onChange={(e) => setForm({ ...form, discord: e.target.value })}
              placeholder="Discord tag"
              className="bg-black/40 border-white/10"
            />
          </div>
          <Textarea
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="Bio"
            className="bg-black/40 border-white/10"
          />
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.name}
                onClick={() => setForm({ ...form, accent_color: option.value })}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                  form.accent_color === option.value ? "border-white" : "border-white/10",
                )}
                style={{ backgroundColor: option.value }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void submit()} disabled={saving} className="flex-1">
              <Check className="w-4 h-4 mr-1.5" /> {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(false)}
              className="border-white/10 bg-white/5"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
