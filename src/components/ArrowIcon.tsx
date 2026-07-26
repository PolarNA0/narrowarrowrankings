import * as React from "react";
import { cn } from "@/lib/utils";

// Import the uploaded game assets from the icons folder
// @ts-ignore
import speedyArrowImg from "../assets/icons/1356331493160386620.png";
// @ts-ignore
import energyArrowImg from "../assets/icons/1356331490010464421.png";
// @ts-ignore
import narrowArrowImg from "../assets/icons/1356331491746910319.png";

interface ArrowIconProps {
  name: string;
  className?: string;
}

export function ArrowIcon({ name, className }: ArrowIconProps) {
  const normalizedName = name.toLowerCase();

  let src = narrowArrowImg;
  let alt = "Narrow Arrow";

  if (normalizedName.includes("energy")) {
    src = energyArrowImg;
    alt = "Energy Arrow";
  } else if (normalizedName.includes("speedy")) {
    src = speedyArrowImg;
    alt = "Speedy Arrow";
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("inline-block object-contain shrink-0", className)}
      referrerPolicy="no-referrer"
    />
  );
}


