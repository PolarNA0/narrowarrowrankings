import { useEffect, useState, useCallback } from "react";

export interface AppSettings {
  theme: string;
  accent: string;
  density: "cozy" | "compact";
  motion: boolean;
  starfield: boolean;
}

export const BACKGROUND_THEMES: { id: string; name: string; background: string; swatch: string }[] = [
  { id: "midnight", name: "Midnight", background: "radial-gradient(1200px 600px at 50% -10%, #101425 0%, #0a0a0a 60%)", swatch: "#0a0a0a" },
  { id: "ocean", name: "Deep Ocean", background: "radial-gradient(1200px 600px at 50% -10%, #06283d 0%, #04121d 60%)", swatch: "#06283d" },
  { id: "carbon", name: "Carbon", background: "linear-gradient(180deg, #17181c 0%, #0d0e11 100%)", swatch: "#17181c" },
  { id: "nebula", name: "Nebula", background: "radial-gradient(1000px 600px at 20% -10%, #2b1055 0%, #0c0616 65%)", swatch: "#2b1055" },
  { id: "forest", name: "Forest", background: "radial-gradient(1000px 600px at 80% -10%, #0b2a1e 0%, #06120d 65%)", swatch: "#0b2a1e" },
  { id: "amoled", name: "AMOLED", background: "#000000", swatch: "#000000" },
  { id: "ember", name: "Ember", background: "radial-gradient(1000px 600px at 30% -10%, #3a1207 0%, #120705 65%)", swatch: "#3a1207" },
];

export const ACCENTS: { id: string; name: string; value: string }[] = [
  { id: "sky", name: "Sky", value: "#38BDF8" },
  { id: "mint", name: "Mint", value: "#2DD4BF" },
  { id: "violet", name: "Violet", value: "#A78BFA" },
  { id: "lime", name: "Lime", value: "#A3E635" },
  { id: "rose", name: "Rose", value: "#FB7185" },
  { id: "amber", name: "Amber", value: "#FBBF24" },
];

const STORAGE_KEY = "naRankingsSettings";

const DEFAULTS: AppSettings = {
  theme: "midnight",
  accent: "#38BDF8",
  density: "cozy",
  motion: true,
  starfield: true,
};

function read(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(read);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
    const theme = BACKGROUND_THEMES.find((t) => t.id === settings.theme) || BACKGROUND_THEMES[0];
    const root = document.documentElement;
    root.style.setProperty("--app-bg", theme.background);
    root.style.setProperty("--app-accent", settings.accent);
    root.dataset.density = settings.density;
    root.dataset.motion = settings.motion ? "on" : "off";
  }, [settings]);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULTS), []);

  return { settings, update, reset };
}
