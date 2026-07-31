import * as React from "react";
import { toast } from "sonner";
import { BadgeCheck, Check, LogOut, Save, Shield, UserRound, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useLinkRequests, usePlayerProfiles } from "@/hooks/usePlayerProfiles";
import { ACCENTS } from "@/hooks/useAppSettings";

interface ProfileHubProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfilesChanged?: () => void;
}

export function ProfileHub({ open, onOpenChange, onProfilesChanged }: ProfileHubProps) {
  const { user, isAdmin, login, loginWithEmail, signUpWithEmail, logout, error } = useAdminAuth();
  const { myProfile, saveMyProfile, reload } = usePlayerProfiles(user?.id);
  const { requests, submit, review, remove } = useLinkRequests(user?.id, isAdmin);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [form, setForm] = React.useState({
    display_name: "",
    avatar_url: "",
    banner_url: "",
    accent_color: "",
    bio: "",
    country: "",
    youtube: "",
    discord: "",
  });
  const [linkName, setLinkName] = React.useState("");
  const [proof, setProof] = React.useState("");

  React.useEffect(() => {
    if (!myProfile) return;
    const socials = myProfile.socials || {};
    setForm({
      display_name: myProfile.display_name ?? "",
      avatar_url: myProfile.avatar_url ?? "",
      banner_url: myProfile.banner_url ?? "",
      accent_color: myProfile.accent_color ?? "",
      bio: myProfile.bio ?? "",
      country: myProfile.country ?? "",
      youtube: socials.youtube ?? "",
      discord: socials.discord ?? "",
    });
  }, [myProfile]);

  const save = async () => {
    try {
      await saveMyProfile({
        display_name: form.display_name || null,
        avatar_url: form.avatar_url || null,
        banner_url: form.banner_url || null,
        accent_color: form.accent_color || null,
        bio: form.bio || null,
        country: form.country || null,
        socials: { youtube: form.youtube, discord: form.discord },
      });
      toast.success("Profile saved");
      onProfilesChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const requestLink = async () => {
    if (!linkName.trim()) return toast.error("Enter your in-game name");
    try {
      await submit(linkName.trim(), proof.trim(), "");
      setLinkName("");
      setProof("");
      toast.success("Link request sent for admin review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    }
  };

  const myRequests = requests.filter((r) => r.user_id === user?.id);
  const pending = requests.filter((r) => r.status === "pending");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d10] border-white/10 text-slate-200 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <UserRound className="w-4 h-4 text-[var(--app-accent)]" /> Your profile
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-xs font-mono uppercase tracking-wider">
            {user ? user.email : "Sign in to customise your player card"}
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="space-y-3 pt-2">
            <Button onClick={() => void login()} className="w-full bg-white text-slate-900 hover:bg-slate-200">
              Continue with Google
            </Button>
            <div className="text-center text-[10px] uppercase tracking-widest text-slate-600">or email</div>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="bg-black/30 border-white/10"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="bg-black/30 border-white/10"
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void loginWithEmail(email, password)}>
                Sign in
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-white/10 bg-white/5"
                onClick={() => void signUpWithEmail(email, password)}
              >
                Sign up
              </Button>
            </div>
            {error && <p className="text-xs text-rose-400 font-mono">{error}</p>}
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            <section className="space-y-2">
              <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Linked leaderboard name
              </h4>
              {myProfile?.username ? (
                <p className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
                  <BadgeCheck className="w-4 h-4 text-[var(--app-accent)]" />
                  <span className="font-bold text-white">{myProfile.username}</span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">verified</span>
                </p>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="In-game name"
                    className="bg-black/30 border-white/10"
                  />
                  <Input
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                    placeholder="Proof link (clip, screenshot)"
                    className="bg-black/30 border-white/10"
                  />
                  <Button onClick={() => void requestLink()} className="w-full">
                    Request link
                  </Button>
                  {myRequests.map((r) => (
                    <p key={r.id} className="text-[11px] font-mono text-slate-500">
                      {r.requested_username} — {r.status}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Appearance</h4>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Display name"
                className="bg-black/30 border-white/10"
              />
              <Input
                value={form.avatar_url}
                onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                placeholder="Avatar image URL"
                className="bg-black/30 border-white/10"
              />
              <Input
                value={form.banner_url}
                onChange={(e) => setForm({ ...form, banner_url: e.target.value })}
                placeholder="Banner image URL"
                className="bg-black/30 border-white/10"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    title={accent.name}
                    onClick={() => setForm({ ...form, accent_color: accent.value })}
                    className={
                      "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 " +
                      (form.accent_color === accent.value ? "border-white" : "border-white/10")
                    }
                    style={{ backgroundColor: accent.value }}
                  />
                ))}
              </div>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Bio"
                className="bg-black/30 border-white/10"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="Country"
                  className="bg-black/30 border-white/10"
                />
                <Input
                  value={form.youtube}
                  onChange={(e) => setForm({ ...form, youtube: e.target.value })}
                  placeholder="YouTube"
                  className="bg-black/30 border-white/10"
                />
                <Input
                  value={form.discord}
                  onChange={(e) => setForm({ ...form, discord: e.target.value })}
                  placeholder="Discord"
                  className="bg-black/30 border-white/10"
                />
              </div>
              <Button onClick={() => void save()} className="w-full">
                <Save className="w-4 h-4 mr-2" /> Save profile
              </Button>
            </section>

            {isAdmin && (
              <section className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Link requests ({pending.length})
                </h4>
                {pending.length === 0 && (
                  <p className="text-xs text-slate-600 font-mono">Nothing waiting for review.</p>
                )}
                {pending.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">
                        {request.requested_username}
                      </p>
                      {request.proof_url && (
                        <a
                          href={request.proof_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-mono text-[var(--app-accent)] hover:underline break-all"
                        >
                          {request.proof_url}
                        </a>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-emerald-400 hover:bg-emerald-500/10"
                      onClick={async () => {
                        try {
                          await review(request, true);
                          await reload();
                          onProfilesChanged?.();
                          toast.success("Linked");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed");
                        }
                      }}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-rose-400 hover:bg-rose-500/10"
                      onClick={async () => {
                        try {
                          await review(request, false);
                          toast.success("Rejected");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed");
                        }
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {requests.length > pending.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-500 text-xs"
                    onClick={async () => {
                      for (const r of requests.filter((r) => r.status !== "pending")) {
                        await remove(r.id);
                      }
                    }}
                  >
                    Clear reviewed requests
                  </Button>
                )}
              </section>
            )}

            <Button
              variant="outline"
              onClick={() => void logout()}
              className="w-full border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
