import * as React from "react";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClickToCopyProps {
  text: string;
  className?: string;
  label?: string;
}

export function ClickToCopy({ text, className, label }: ClickToCopyProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <button
      id={`copy-btn-${text.replace(/\s+/g, "-")}`}
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono transition-all duration-200 cursor-pointer",
        copied 
          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/35" 
          : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5 hover:border-white/10",
        className
      )}
      title="Click to copy ID"
    >
      {label && <span>{label}:</span>}
      <span className="font-bold">{text}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <Copy className="w-2.5 h-2.5 opacity-60 hover:opacity-100 shrink-0" />
      )}
    </button>
  );
}
