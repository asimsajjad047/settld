import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { TableState } from "@/lib/mock";
import type { SplitResult } from "@/lib/split";
import { awardsText, computeAwards } from "@/lib/awards";

// Roast lines are picked deterministically from the bill id, so every phone and the big screen match.
const POOL: Record<string, string[]> = {
  spender: ["Ordered like the menu was a checklist.", "Treated the menu as a personal challenge.", "Came hungry, left legendary.", "Main character energy, main course appetite."],
  sharer: ["Generous with the naan, generous with the vibes.", "Never met a plate they wouldn't split.", "Sharing is caring, and they cared a lot."],
  hoarder: ["Loyalty to one dish is a virtue.", "Found a favourite and refused to let go.", "Why try anything else when you've found perfection?"],
  light: ["Here for the company, clearly.", "Pacing themselves for dessert elsewhere.", "Ordered with admirable restraint."],
  fast: ["Paid before the plates were cleared.", "Fastest transfer in the West.", "Speedrun champion of settling up."],
  owes: ["The group chat is watching. 👀", "Your friends believe in you. Mostly.", "The reminder is coming, gently."],
};
const kind = (title: string) => title === "Big Spender" ? "spender" : title === "The Sharer" ? "sharer" : title.endsWith("Hoarder") ? "hoarder"
  : title === "Lightweight" ? "light" : title === "Fastest Payer" ? "fast" : "owes";
function seeded(seed: string) { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function Awards({ state, split, compact }: { state: TableState; split: SplitResult; compact?: boolean }) {
  const awards = useMemo(() => computeAwards(state, split), [state, split]);
  const [copied, setCopied] = useState(false);
  const billId = state.bill.id;
  const lines = useMemo(() => Object.fromEntries(awards.map((a) => {
    const pool = POOL[kind(a.title)] ?? [];
    return [a.key, pool[seeded(`${billId}|${a.key}`) % pool.length] ?? ""];
  })), [awards, billId]);

  if (!awards.length) return null;

  const share = () => {
    const text = awardsText(state.bill.restaurant_name, awards, lines);
    if (navigator.share) void navigator.share({ text }).catch(() => undefined);
    else { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  return (
    <div className={cn("receipt", compact ? "flex min-h-0 flex-col p-[2vh]" : "p-4")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={compact ? "text-[3.2vh]" : "text-xl"}>Table awards 🏆</h3>
        {!compact && <button onClick={share} className="min-h-10 rounded-lg border-2 border-foreground px-3 text-sm font-semibold">{copied ? "Copied ✓" : "Share"}</button>}
      </div>
      <div className={cn("rule-dashed", compact ? "my-[1.2vh]" : "my-3")} />
      <ul className={cn(compact ? "grid min-h-0 grid-cols-2 gap-[1.2vh]" : "space-y-3")}>
        {awards.map((a) => (
          <li key={a.key} className="min-w-0">
            <p className={cn("font-mono uppercase tracking-wider text-muted-foreground", compact ? "text-[1.6vh]" : "text-xs")}>{a.title}</p>
            <p className={cn("truncate font-display", compact ? "text-[2.6vh]" : "text-lg")}>{a.emoji} {a.name} <span className="font-mono text-muted-foreground">· {a.detail}</span></p>
            {lines[a.key] && <p className={cn("italic", compact ? "truncate text-[1.9vh]" : "text-sm")}>“{lines[a.key]}”</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
