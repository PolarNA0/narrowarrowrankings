import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function capitalizeName(name: string): string {
  if (!name) return "";
  // If the name is a slug like "easy-pack" or "medium_pack", replace hyphens/underscores with spaces
  const cleanName = name.replace(/[-_]/g, " ");
  return cleanName
    .split(" ")
    .map(word => {
      if (!word) return "";
      const lower = word.toLowerCase();
      // Roman numerals
      if (lower === "ii") return "II";
      if (lower === "iii") return "III";
      if (lower === "iv") return "IV";
      if (lower === "v") return "V";
      if (lower === "vi") return "VI";
      if (lower === "vii") return "VII";
      if (lower === "viii") return "VIII";
      if (lower === "ix") return "IX";
      if (lower === "x") return "X";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

