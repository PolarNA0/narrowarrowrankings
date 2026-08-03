import { useEffect, useState, useCallback } from "react";

export interface AppSettings {
  theme: string;
  accent: string;
  density: "cozy" | "compact";
  motion: boolean;
  starfield: boolean;
  glow: number;
  timeFormat: "seconds" | "minutes";
  fontScale: number;
  monoTimes: boolean;
  rounded: boolean;
  highlightWr: boolean;
  showBadges: boolean;
  stickyHeaders: boolean;
  zebraRows: boolean;
  reducedBlur: boolean;
  showAvatars: boolean;
  cardOpacity: number;
}


export const BACKGROUND_THEMES: {
  id: string;
  name: string;
  background: string;
  swatch: string;
  light?: boolean;
}[] = [
  { id: "midnight", name: "Midnight", background: "radial-gradient(1200px 600px at 50% -10%, #101425 0%, #0a0a0a 60%)", swatch: "#0a0a0a" },
  { id: "ocean", name: "Deep Ocean", background: "radial-gradient(1200px 600px at 50% -10%, #06283d 0%, #04121d 60%)", swatch: "#06283d" },
  { id: "carbon", name: "Carbon", background: "linear-gradient(180deg, #17181c 0%, #0d0e11 100%)", swatch: "#17181c" },
  { id: "nebula", name: "Nebula", background: "radial-gradient(1000px 600px at 20% -10%, #2b1055 0%, #0c0616 65%)", swatch: "#2b1055" },
  { id: "forest", name: "Forest", background: "radial-gradient(1000px 600px at 80% -10%, #0b2a1e 0%, #06120d 65%)", swatch: "#0b2a1e" },
  { id: "amoled", name: "AMOLED", background: "#000000", swatch: "#000000" },
  { id: "ember", name: "Ember", background: "radial-gradient(1000px 600px at 30% -10%, #3a1207 0%, #120705 65%)", swatch: "#3a1207" },
  { id: "sakura", name: "Sakura", background: "radial-gradient(1000px 600px at 70% -10%, #3d1030 0%, #140715 65%)", swatch: "#3d1030" },
  { id: "aurora", name: "Aurora", background: "linear-gradient(160deg, #04121d 0%, #062b2b 45%, #0b0f2a 100%)", swatch: "#062b2b" },
  { id: "sunset", name: "Sunset", background: "linear-gradient(180deg, #2a0f2b 0%, #401a1a 55%, #10060a 100%)", swatch: "#401a1a" },
  { id: "slate", name: "Slate", background: "linear-gradient(180deg, #1b212b 0%, #0f131a 100%)", swatch: "#1b212b" },
  { id: "matrix", name: "Matrix", background: "radial-gradient(900px 500px at 50% 0%, #04240f 0%, #010703 70%)", swatch: "#04240f" },
  { id: "vaporwave", name: "Vaporwave", background: "linear-gradient(180deg, #2b0f45 0%, #4b1247 45%, #10061c 100%)", swatch: "#4b1247" },
  { id: "sand", name: "Dune", background: "linear-gradient(180deg, #2b2418 0%, #14100a 100%)", swatch: "#2b2418" },
  { id: "cobalt", name: "Cobalt", background: "radial-gradient(1000px 600px at 50% -10%, #0b2f6b 0%, #050b1c 65%)", swatch: "#0b2f6b" },
  { id: "blood", name: "Crimson", background: "radial-gradient(1000px 600px at 50% -10%, #4a0512 0%, #120306 65%)", swatch: "#4a0512" },
  { id: "mono", name: "Paperwhite", background: "linear-gradient(180deg, #16171a 0%, #0b0b0c 100%)", swatch: "#16171a" },
  { id: "teal", name: "Lagoon", background: "radial-gradient(1000px 600px at 20% -10%, #04353a 0%, #04141a 65%)", swatch: "#04353a" },
  { id: "royal", name: "Royal", background: "linear-gradient(160deg, #1a0b3d 0%, #251357 45%, #08040f 100%)", swatch: "#251357" },
  { id: "steel", name: "Steel", background: "linear-gradient(180deg, #202733 0%, #0a0d12 100%)", swatch: "#202733" },
  { id: "mocha", name: "Mocha", background: "linear-gradient(180deg, #2b1d16 0%, #120b08 100%)", swatch: "#2b1d16" },
  { id: "neon", name: "Neon Grid", background: "radial-gradient(900px 500px at 50% 110%, #16006b 0%, #05010f 70%)", swatch: "#16006b" },
  { id: "arctic", name: "Arctic", background: "linear-gradient(180deg, #16283a 0%, #070d14 100%)", swatch: "#16283a" },
  { id: "toxic", name: "Toxic", background: "radial-gradient(900px 500px at 80% -10%, #2c3a05 0%, #0a0e02 65%)", swatch: "#2c3a05" },
  { id: "citrus", name: "Citrus", background: "radial-gradient(1000px 600px at 30% -10%, #ffd93b 0%, #ff9f1c 55%, #ffedb0 100%)", swatch: "#ffd93b", light: true },
  { id: "cream", name: "Cream", background: "linear-gradient(180deg, #fdf7ea 0%, #f1e4cd 100%)", swatch: "#fdf7ea", light: true },
  { id: "tan", name: "Tan", background: "linear-gradient(180deg, #e8d4b0 0%, #c9a87c 100%)", swatch: "#d8bd94", light: true },
  { id: "mint-light", name: "Fresh Mint", background: "linear-gradient(180deg, #dbf7ec 0%, #a6e3c8 100%)", swatch: "#bdf0dc", light: true },
  { id: "peach", name: "Peach", background: "linear-gradient(180deg, #ffe3d3 0%, #ffb9a0 100%)", swatch: "#ffcbb6", light: true },
  { id: "sky-light", name: "Clear Sky", background: "linear-gradient(180deg, #dcefff 0%, #a8d3f5 100%)", swatch: "#c2e0fa", light: true },
  { id: "bubblegum", name: "Bubblegum", background: "linear-gradient(180deg, #ffdbef 0%, #ffb3d9 100%)", swatch: "#ffc7e4", light: true },
  { id: "lavender", name: "Lavender", background: "linear-gradient(180deg, #ece2ff 0%, #c6b1f5 100%)", swatch: "#d9c9fa", light: true },
];


export const ACCENTS: { id: string; name: string; value: string }[] = [
  { id: "sky", name: "Sky", value: "#38BDF8" },
  { id: "mint", name: "Mint", value: "#2DD4BF" },
  { id: "violet", name: "Violet", value: "#A78BFA" },
  { id: "lime", name: "Lime", value: "#A3E635" },
  { id: "rose", name: "Rose", value: "#FB7185" },
  { id: "amber", name: "Amber", value: "#FBBF24" },
  { id: "orange", name: "Ember", value: "#FB923C" },
  { id: "pink", name: "Bubblegum", value: "#F472B6" },
  { id: "indigo", name: "Indigo", value: "#818CF8" },
  { id: "emerald", name: "Emerald", value: "#34D399" },
  { id: "ice", name: "Ice", value: "#E2E8F0" },
  { id: "gold", name: "Gold", value: "#EAB308" },
  { id: "cyan", name: "Cyan", value: "#22D3EE" },
  { id: "coral", name: "Coral", value: "#F87171" },
  { id: "grape", name: "Grape", value: "#C084FC" },
  { id: "sun", name: "Sunburst", value: "#FDE047" },
];

const STORAGE_KEY = "naRankingsSettings";

const DEFAULTS: AppSettings = {
  theme: "midnight",
  accent: "#38BDF8",
  density: "cozy",
  motion: true,
  starfield: true,
  glow: 1,
  timeFormat: "seconds",
  fontScale: 1,
  monoTimes: true,
  rounded: true,
  highlightWr: true,
  showBadges: true,
  stickyHeaders: true,
  zebraRows: false,
  reducedBlur: false,
  showAvatars: true,
  cardOpacity: 1,
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
    root.style.setProperty("--app-glow", String(settings.glow));
    root.style.setProperty("--app-radius-scale", settings.rounded ? "1" : "0");
    root.style.setProperty("--app-card-opacity", String(settings.cardOpacity));
    root.style.fontSize = `${16 * settings.fontScale}px`;
    root.dataset.density = settings.density;
    root.dataset.motion = settings.motion ? "on" : "off";
    root.dataset.zebra = settings.zebraRows ? "on" : "off";
    root.dataset.sticky = settings.stickyHeaders ? "on" : "off";
    root.dataset.blur = settings.reducedBlur ? "off" : "on";
    root.dataset.tone = theme.light ? "light" : "dark";

  }, [settings]);


  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULTS), []);

  return { settings, update, reset };
}

/** Formats a completion time using the user's preferred display format. */
export function formatWithSettings(seconds: number, format: AppSettings["timeFormat"]) {
  if (format === "seconds") return `${seconds.toFixed(3)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, "0")}`;
}
