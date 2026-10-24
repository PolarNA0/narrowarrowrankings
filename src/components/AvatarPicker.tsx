import * as React from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadAvatar } from "@/lib/avatar.functions";
import { fileToAvatarDataUrl, AvatarError } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface Props {
  /** Current avatar URL, if any. */
  value: string;
  onChange: (url: string) => void;
  /** Name the fallback initial is taken from. */
  username: string;
  /** Rendered size of the preview. */
  size?: number;
  className?: string;
}

/**
 * Avatar picker that opens the device's own image picker.
 *
 * A hidden `<input type="file" accept="image/*">` is the only way to reach the
 * gallery/camera on mobile, so the visible control is a button that clicks it.
 * The chosen file is downscaled in the browser and uploaded server-side, and
 * the resulting URL is handed back through `onChange` for the caller to save
 * with the rest of the profile.
 */
export function AvatarPicker({ value, onChange, username, size = 96, className }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const { url } = await uploadAvatar({ data: { dataUrl } });
      onChange(url);
      toast.success("Photo ready — save to apply");
    } catch (err) {
      toast.error(
        err instanceof AvatarError || err instanceof Error
          ? err.message
          : "Could not use that image.",
      );
    } finally {
      setBusy(false);
      // Reset so picking the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative shrink-0 overflow-hidden rounded-2xl border-2 border-white/10 bg-black/40 grid place-items-center"
        style={{ width: size, height: size }}
        title="Choose a photo"
      >
        {value ? (
          <img src={value} alt="Avatar preview" className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-black text-white/60">
            {username.slice(0, 1).toUpperCase() || "?"}
          </span>
        )}
        <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/70 text-white">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
        </span>
      </button>

      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="border-white/10 bg-white/5"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Camera className="w-3.5 h-3.5 mr-1.5" />
          )}
          {value ? "Change photo" : "Choose photo"}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChange("")}
            className="text-slate-500 text-xs"
          >
            <Trash2 className="w-3 h-3 mr-1" /> Remove
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
