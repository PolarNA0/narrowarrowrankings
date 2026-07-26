import { RankInfo } from "../types";
import { DEFAULT_RANKS } from "../constants";

const rawData: Record<string, Record<string, string>> = {
  "Champion": {
    "1777118905185": "0:10.000", "801170f9": "0:13.050", "b05c7ede": "0:10.700", "9892299a": "0:11.700", "bbb1af96": "0:12.150", "c68a5228": "0:12.400", "1b901dfe": "0:17.700", "b91ca820": "0:11.300", "d4111ef0": "0:15.825", "1778427891183": "0:12.000"
  },
  "Elite": {
    "1777118905185": "0:11.000", "801170f9": "0:13.100", "b05c7ede": "0:10.750", "9892299a": "0:11.800", "bbb1af96": "0:12.200", "c68a5228": "0:12.550", "1b901dfe": "0:17.850", "b91ca820": "0:11.350", "d4111ef0": "0:15.900", "1778427891183": "0:13.000"
  },
  "Legend": {
    "1777118905185": "0:12.000", "801170f9": "0:13.150", "b05c7ede": "0:10.800", "9892299a": "0:11.900", "bbb1af96": "0:12.275", "c68a5228": "0:12.700", "1b901dfe": "0:18.000", "b91ca820": "0:11.400", "d4111ef0": "0:15.950", "1778427891183": "0:14.000"
  },
  "Expert": {
    "1777118905185": "0:14.000", "801170f9": "0:13.200", "b05c7ede": "0:10.850", "9892299a": "0:12.100", "bbb1af96": "0:12.400", "c68a5228": "0:13.000", "1b901dfe": "0:18.150", "b91ca820": "0:11.450", "d4111ef0": "0:16.050", "1778427891183": "0:15.000"
  },
  "Master": {
    "1777118905185": "0:16.000", "801170f9": "0:13.275", "b05c7ede": "0:10.900", "9892299a": "0:12.350", "bbb1af96": "0:12.600", "c68a5228": "0:13.300", "1b901dfe": "0:18.350", "b91ca820": "0:11.525", "d4111ef0": "0:16.200", "1778427891183": "0:16.000"
  },
  "Pro": {
    "1777118905185": "0:18.000", "801170f9": "0:13.400", "b05c7ede": "0:11.000", "9892299a": "0:12.800", "bbb1af96": "0:12.800", "c68a5228": "0:13.600", "1b901dfe": "0:18.600", "b91ca820": "0:11.650", "d4111ef0": "0:16.500", "1778427891183": "0:17.000"
  },
  "Skilled": {
    "1777118905185": "0:20.000", "801170f9": "0:13.600", "b05c7ede": "0:11.300", "9892299a": "0:13.400", "bbb1af96": "0:13.300", "c68a5228": "0:14.000", "1b901dfe": "0:19.000", "b91ca820": "0:11.800", "d4111ef0": "0:16.900", "1778427891183": "0:18.000"
  },
  "Average": {
    "1777118905185": "0:25.000", "801170f9": "0:13.800", "b05c7ede": "0:11.800", "9892299a": "0:14.000", "bbb1af96": "0:14.000", "c68a5228": "0:14.500", "1b901dfe": "0:19.800", "b91ca820": "0:12.500", "d4111ef0": "0:17.600", "1778427891183": "0:20.000"
  },
  "Beginner": {
    "1777118905185": "0:30.000", "801170f9": "0:14.500", "b05c7ede": "0:13.000", "9892299a": "0:15.500", "bbb1af96": "0:15.000", "c68a5228": "0:15.500", "1b901dfe": "0:20.500", "b91ca820": "0:13.500", "d4111ef0": "0:18.500", "1778427891183": "0:25.000"
  }
};

function parseTime(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr);
}

export function getLevelDefaultRanks(levelId: string, baseRanks: Record<string, RankInfo> = DEFAULT_RANKS): Record<string, RankInfo> {
  if (!levelId) return baseRanks || {};
  const normalizedId = levelId.toLowerCase();
  const config: Record<string, RankInfo> = {};

  const safeBaseRanks = baseRanks || {};
  Object.keys(safeBaseRanks).forEach(rankId => {
    const baseRank = safeBaseRanks[rankId];
    let timeCutoff = baseRank?.timeCutoff ?? 120.0;

    if (rankId === "Beginner+") {
      timeCutoff = 120.0; // 2:00.000
    } else if (rawData[rankId] && rawData[rankId][normalizedId]) {
      timeCutoff = parseTime(rawData[rankId][normalizedId]);
    }

    config[rankId] = {
      ...baseRank,
      timeCutoff
    };
  });

  return config;
}
