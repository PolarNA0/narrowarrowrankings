import * as React from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIosSafari, isStandalone } from "@/lib/pwa";

/** The non-standard event Chromium fires when the app becomes installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "naInstallDismissed";

/**
 * A dismissible strip offering to install the app.
 *
 * Chromium hands us a `beforeinstallprompt` event we can replay on a button;
 * iOS Safari never does, so there we show the Share-sheet instructions instead.
 * Dismissing is remembered for a month so the prompt does not nag.
 */
export function InstallAppBanner() {
  const [promptEvent, setPromptEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    if (isStandalone()) return;
    let until = 0;
    try {
      until = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    } catch {
      /* storage blocked — treat as not dismissed */
    }
    if (until > Date.now()) return;
    setDismissed(false);

    const onPrompt = (event: Event) => {
      // Suppress the browser's own mini-infobar so the app controls the moment.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (isIosSafari()) setIosHint(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;
  if (!promptEvent && !iosHint) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    } catch {
      /* storage blocked — it just comes back next visit */
    }
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") dismiss();
    setPromptEvent(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pt-3">
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[var(--app-accent)]/10 px-3 py-2 text-xs text-slate-300">
        {iosHint ? (
          <Smartphone className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
        ) : (
          <Download className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          {iosHint ? (
            <>
              Install for offline play: tap <Share className="inline w-3.5 h-3.5 -mt-0.5" /> Share,
              then “Add to Home Screen”.
            </>
          ) : (
            <>Install Narrow Arrow Rankings to play and watch replays offline.</>
          )}
        </span>
        {!iosHint && (
          <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => void install()}>
            Install
          </Button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-slate-500 hover:text-white shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
