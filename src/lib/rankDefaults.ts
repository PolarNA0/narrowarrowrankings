import { RankInfo } from "../types";
import { DEFAULT_RANKS } from "../constants";

const rawData: Record<string, Record<string, string>> = {
  Champion: {
    "1777118905185": "0:10.000",
    "801170f9": "0:13.050",
    b05c7ede: "0:10.700",
    "9892299a": "0:11.700",
    bbb1af96: "0:12.150",
    c68a5228: "0:12.400",
    "1b901dfe": "0:17.700",
    b91ca820: "0:11.300",
    d4111ef0: "0:15.825",
    "1778427891183": "0:12.000",
  },
  Grandmaster: {
    "1777118905185": "0:10.500",
    "801170f9": "0:13.075",
    b05c7ede: "0:10.725",
    "9892299a": "0:11.750",
    bbb1af96: "0:12.175",
    c68a5228: "0:12.475",
    "1b901dfe": "0:17.775",
    b91ca820: "0:11.325",
    d4111ef0: "0:15.863",
    "1778427891183": "0:12.500",
  },
  Elite: {
    "1777118905185": "0:11.000",
    "801170f9": "0:13.100",
    b05c7ede: "0:10.750",
    "9892299a": "0:11.800",
    bbb1af96: "0:12.200",
    c68a5228: "0:12.550",
    "1b901dfe": "0:17.850",
    b91ca820: "0:11.350",
    d4111ef0: "0:15.900",
    "1778427891183": "0:13.000",
  },
  Legend: {
    "1777118905185": "0:12.000",
    "801170f9": "0:13.150",
    b05c7ede: "0:10.800",
    "9892299a": "0:11.900",
    bbb1af96: "0:12.275",
    c68a5228: "0:12.700",
    "1b901dfe": "0:18.000",
    b91ca820: "0:11.400",
    d4111ef0: "0:15.950",
    "1778427891183": "0:14.000",
  },
  Expert: {
    "1777118905185": "0:14.000",
    "801170f9": "0:13.200",
    b05c7ede: "0:10.850",
    "9892299a": "0:12.100",
    bbb1af96: "0:12.400",
    c68a5228: "0:13.000",
    "1b901dfe": "0:18.150",
    b91ca820: "0:11.450",
    d4111ef0: "0:16.050",
    "1778427891183": "0:15.000",
  },
  Master: {
    "1777118905185": "0:16.000",
    "801170f9": "0:13.275",
    b05c7ede: "0:10.900",
    "9892299a": "0:12.350",
    bbb1af96: "0:12.600",
    c68a5228: "0:13.300",
    "1b901dfe": "0:18.350",
    b91ca820: "0:11.525",
    d4111ef0: "0:16.200",
    "1778427891183": "0:16.000",
  },
  Pro: {
    "1777118905185": "0:18.000",
    "801170f9": "0:13.400",
    b05c7ede: "0:11.000",
    "9892299a": "0:12.800",
    bbb1af96: "0:12.800",
    c68a5228: "0:13.600",
    "1b901dfe": "0:18.600",
    b91ca820: "0:11.650",
    d4111ef0: "0:16.500",
    "1778427891183": "0:17.000",
  },
  Skilled: {
    "1777118905185": "0:20.000",
    "801170f9": "0:13.600",
    b05c7ede: "0:11.300",
    "9892299a": "0:13.400",
    bbb1af96: "0:13.300",
    c68a5228: "0:14.000",
    "1b901dfe": "0:19.000",
    b91ca820: "0:11.800",
    d4111ef0: "0:16.900",
    "1778427891183": "0:18.000",
  },
  Average: {
    "1777118905185": "0:25.000",
    "801170f9": "0:13.800",
    b05c7ede: "0:11.800",
    "9892299a": "0:14.000",
    bbb1af96: "0:14.000",
    c68a5228: "0:14.500",
    "1b901dfe": "0:19.800",
    b91ca820: "0:12.500",
    d4111ef0: "0:17.600",
    "1778427891183": "0:20.000",
  },
  Beginner: {
    "1777118905185": "0:30.000",
    "801170f9": "0:14.500",
    b05c7ede: "0:13.000",
    "9892299a": "0:15.500",
    bbb1af96: "0:15.000",
    c68a5228: "0:15.500",
    "1b901dfe": "0:20.500",
    b91ca820: "0:13.500",
    d4111ef0: "0:18.500",
    "1778427891183": "0:25.000",
  },
};

function parseTime(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr);
}

export function getLevelDefaultRanks(
  levelId: string,
  baseRanks: Record<string, RankInfo> = DEFAULT_RANKS,
): Record<string, RankInfo> {
  if (!levelId) return baseRanks || {};
  const normalizedId = levelId.toLowerCase();
  const config: Record<string, RankInfo> = {};

  const safeBaseRanks = baseRanks || {};
  Object.keys(safeBaseRanks).forEach((rankId) => {
    const baseRank = safeBaseRanks[rankId];
    let timeCutoff = baseRank?.timeCutoff ?? 120.0;

    if (rankId === "Beginner+") {
      timeCutoff = 120.0; // 2:00.000
    } else if (rawData[rankId] && rawData[rankId][normalizedId]) {
      timeCutoff = parseTime(rawData[rankId][normalizedId]);
    }

    config[rankId] = {
      ...baseRank,
      timeCutoff,
    };
  });

  return config;
}

/**
 * Resolve one level's rank cutoffs, preferring the stored config and falling
 * back to the level's generated default for any rank the saved config predates.
 *
 * A saved `levelConfigs/<id>` doc is a snapshot of the ranks that existed when
 * an admin last saved it, so a rank added later has no cutoff there. Falling
 * back to the *global* cutoff in that case is wrong: the global ladder is
 * absolute (Champion 10s) while a level's authored ladder is relative to its own
 * WR, so on a fast level the global Champion cutoff lands *above* the level's
 * own Elite cutoff and the ladder inverts — the rank becomes unreachable, or
 * resolves a time to a rank the level never intended.
 *
 * Only a *configured* level falls back; a level with no stored config keeps
 * contributing nothing, as it did before.
 */
export function resolveLevelRanks(
  levelId: string,
  storedRanks: Record<string, RankInfo> | undefined | null,
  baseRanks: Record<string, RankInfo> = DEFAULT_RANKS,
  rankOrder: string[] = Object.keys(baseRanks || {}),
): Record<string, RankInfo> {
  const base = baseRanks || DEFAULT_RANKS;
  const hasConfig = !!storedRanks && Object.keys(storedRanks).length > 0;
  const defaults = getLevelDefaultRanks(levelId, base);

  // Where each rank sits in the ladder, so a rank with no stored cutoff can be
  // placed between the ranks either side of it.
  const indexOf = new Map(rankOrder.map((id, i) => [id, i]));

  const readCutoff = (id: string): number | null => {
    const lRank = storedRanks?.[id];
    if (typeof lRank === "number") return lRank > 0 ? lRank : null;
    if (lRank && typeof lRank.timeCutoff === "number" && lRank.timeCutoff > 0) {
      return lRank.timeCutoff;
    }
    return null;
  };

  /**
   * A rank added after this doc was saved has no cutoff in it. It cannot come
   * from the level's generated default: that is either the *global* cutoff or a
   * hand-authored one, both of which are absolute, while a saved ladder is
   * tuned to the level's own WR — on Diamond Rally the stored Champion is 16.21
   * while the authored table says 13.05, so mixing them inverts the ladder.
   * Instead take a gap-weighted blend of the stored cutoffs either side of this
   * rank, which is relative to the level's real ladder and is what "in between"
   * means here. Falls back to a scaled neighbour when only one side exists.
   */
  const resolveCutoff = (id: string, position: number): number => {
    const stored = readCutoff(id);
    if (stored !== null) return stored;
    if (!hasConfig) return 0;

    const neighbours = () => {
      for (let i = position - 1; i >= 0; i--) {
        const v = readCutoff(rankOrder[i]);
        if (v !== null) return { index: i, value: v };
      }
      return null;
    };
    const before = neighbours();
    let after: { index: number; value: number } | null = null;
    for (let i = position + 1; i < rankOrder.length; i++) {
      const v = readCutoff(rankOrder[i]);
      if (v !== null) {
        after = { index: i, value: v };
        break;
      }
    }

    if (before && after && after.index > before.index) {
      const t = (position - before.index) / (after.index - before.index);
      return before.value + (after.value - before.value) * t;
    }
    if (before) {
      // Only a lower neighbour exists: scale it by this rank's own weight in the
      // global ladder, so the gap keeps the level's proportions.
      const baseRank = base[id] || DEFAULT_RANKS[id];
      const champion = base.Champion || DEFAULT_RANKS.Champion;
      const scale =
        champion?.timeCutoff && baseRank?.timeCutoff
          ? baseRank.timeCutoff / champion.timeCutoff
          : 1;
      return before.value * scale;
    }
    if (after) return after.value;
    return 0;
  };

  const resolved: Record<string, RankInfo> = {};
  const derived: boolean[] = [];
  for (const id of rankOrder) {
    const gRank = base[id] || DEFAULT_RANKS[id];
    const position = indexOf.get(id) ?? 0;
    const stored = readCutoff(id);
    resolved[id] = { ...gRank, timeCutoff: stored ?? resolveCutoff(id, position) };
    derived.push(stored === null && resolved[id].timeCutoff > 0);
  }

  // An interpolated cutoff is only as ordered as the cutoffs it sits between, so
  // clamp it — but never an explicitly stored value, since that is the admin's
  // own choice and silently rewriting it would be worse than a lax ladder.
  let previous = 0;
  rankOrder.forEach((id, i) => {
    if (id === "Beginner+") return;
    const value = resolved[id].timeCutoff;
    if (value <= 0) return;
    if (derived[i] && value <= previous) {
      resolved[id] = { ...resolved[id], timeCutoff: previous + 0.001 };
    }
    previous = resolved[id].timeCutoff;
  });

  return resolved;
}
