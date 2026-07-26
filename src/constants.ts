import { RankInfo, LevelInfo, RankName, LevelPack } from "./types";

export const LEVEL_PACKS: LevelPack[] = [];

export const LEVELS: LevelInfo[] = [];

export const DEFAULT_RANKS: Record<string, RankInfo> = {
  "Champion": {
    name: "Champion",
    color: "text-[#D300CF]",
    bgColor: "bg-[#D300CF]/10",
    borderColor: "border-[#D300CF]/50",
    timeCutoff: 10.0,
  },
  "Elite": {
    name: "Elite",
    color: "text-[#A804D6]",
    bgColor: "bg-[#A804D6]/10",
    borderColor: "border-[#A804D6]/50",
    timeCutoff: 15.0,
  },
  "Legend": {
    name: "Legend",
    color: "text-[#7681FF]",
    bgColor: "bg-[#7681FF]/10",
    borderColor: "border-[#7681FF]/50",
    timeCutoff: 20.0,
  },
  "Expert": {
    name: "Expert",
    color: "text-[#14E6FF]",
    bgColor: "bg-[#14E6FF]/10",
    borderColor: "border-[#14E6FF]/50",
    timeCutoff: 30.0,
  },
  "Master": {
    name: "Master",
    color: "text-[#8DFF00]",
    bgColor: "bg-[#8DFF00]/10",
    borderColor: "border-[#8DFF00]/50",
    timeCutoff: 45.0,
  },
  "Pro": {
    name: "Pro",
    color: "text-[#FACC15]",
    bgColor: "bg-[#FACC15]/10",
    borderColor: "border-[#FACC15]/50",
    timeCutoff: 60.0,
  },
  "Skilled": {
    name: "Skilled",
    color: "text-[#FB923C]",
    bgColor: "bg-[#FB923C]/10",
    borderColor: "border-[#FB923C]/50",
    timeCutoff: 90.0,
  },
  "Average": {
    name: "Average",
    color: "text-[#FF5031]",
    bgColor: "bg-[#FF5031]/10",
    borderColor: "border-[#FF5031]/50",
    timeCutoff: 120.0,
  },
  "Beginner": {
    name: "Beginner",
    color: "text-[#7F1D1D]",
    bgColor: "bg-[#7F1D1D]/10",
    borderColor: "border-[#7F1D1D]/50",
    timeCutoff: 120.0,
  },
  "Beginner+": {
    name: "Beginner+",
    color: "text-[#78350F]",
    bgColor: "bg-[#78350F]/10",
    borderColor: "border-[#78350F]/50",
    timeCutoff: 9999.0,
  },
};

export const DEFAULT_OVERALL_RANKS: Record<string, RankInfo> = {
  "Champion": { ...DEFAULT_RANKS["Champion"], timeCutoff: 23.05 },
  "Elite": { ...DEFAULT_RANKS["Elite"], timeCutoff: 24.10 },
  "Legend": { ...DEFAULT_RANKS["Legend"], timeCutoff: 25.15 },
  "Expert": { ...DEFAULT_RANKS["Expert"], timeCutoff: 27.20 },
  "Master": { ...DEFAULT_RANKS["Master"], timeCutoff: 29.27 },
  "Pro": { ...DEFAULT_RANKS["Pro"], timeCutoff: 31.40 },
  "Skilled": { ...DEFAULT_RANKS["Skilled"], timeCutoff: 33.60 },
  "Average": { ...DEFAULT_RANKS["Average"], timeCutoff: 38.80 },
  "Beginner": { ...DEFAULT_RANKS["Beginner"], timeCutoff: 44.50 },
  "Beginner+": { ...DEFAULT_RANKS["Beginner+"], timeCutoff: 240.0 },
};

export const RANK_ORDER = [
  "Champion", "Elite", "Legend", "Expert", "Master", "Pro", "Skilled", "Average", "Beginner", "Beginner+"
];

export const THEORETICAL_MAX_DEFAULTS: Record<string, number> = {
  "1777118905185": 10.0,
  "801170F9": 12.9,
  "B05C7EDE": 10.59,
  "9892299A": 11.53,
  "BBB1AF96": 12.073,
  "C68A5228": 12.97,
  "1B901DFE": 17.423,
  "B91CA820": 12.027,
  "D4111EF0": 15.57,
  "1778427891183": 11.5,
  "1776365701718": 8.5,
  "1776607121274": 11.2,
  "3FC555C7": 9.8,
  "1F9537A9": 14.5,
  "1776585530826": 10.2,
  "F3D36D72": 22.0,
  "8440FB48": 12.0,
  "AAA35C8F": 15.1,
  "EE4C77BD": 13.4,
  "0928C4FA": 11.0,
  "DDD467F7": 16.5,
  "5B719122": 18.0,
  "7913D7AD": 9.5,
  "ADEEF62A": 14.0,
};

export const HUMAN_LIMIT_DEFAULTS: Record<string, number> = {
  "1777118905185": 10.5,
  "801170F9": 12.925,
  "B05C7EDE": 10.55,
  "9892299A": 11.2,
  "BBB1AF96": 12.0,
  "C68A5228": 12.1,
  "1B901DFE": 17.45,
  "B91CA820": 11.9,
  "D4111EF0": 15.5,
  "1778427891183": 11.8,
  "1776365701718": 8.8,
  "1776607121274": 11.5,
  "3FC555C7": 10.1,
  "1F9537A9": 14.8,
  "1776585530826": 10.5,
  "F3D36D72": 22.5,
  "8440FB48": 12.3,
  "AAA35C8F": 15.5,
  "EE4C77BD": 13.8,
  "0928C4FA": 11.3,
  "DDD467F7": 16.9,
  "5B719122": 18.4,
  "7913D7AD": 9.8,
  "ADEEF62A": 14.4,
};
