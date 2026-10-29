import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { GuestRow } from "@/lib/mock";

const variants = {
  primary: "bg-primary text-primary-foreground hover:brightness-110",
  ink: "bg-foreground text-background hover:opacity-90",
  outline: "border-2 border-foreground bg-card text-foreground hover:bg-secondary",
  ghost: "text-foreground hover:bg-secondary",
  claimed: "bg-claimed text-primary-foreground",
};

export function Btn({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition active:scale-[0.98] disabled:opacity-40",
        variants[variant], className,
      )}
    />
  );
}

export function Avatar({ g, size = "md" }: { g: Pick<GuestRow, "emoji" | "color">; size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "h-6 w-6 text-xs" : size === "lg" ? "h-12 w-12 text-2xl" : "h-9 w-9 text-lg";
  return <span className={cn("grid shrink-0 place-items-center rounded-full", s)} style={{ background: g.color }}>{g.emoji}</span>;
}

export function Money({ p, className }: { p: string; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{p}</span>;
}

export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="min-h-10 shrink-0 rounded-lg border-2 border-foreground px-3 text-sm font-semibold"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

export function Confetti() {
  const cls = ["bg-primary", "bg-claimed", "bg-warning", "bg-unclaimed", "bg-foreground"];
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 40 }, (_, i) => (
        <span
          key={i}
          className={cn("animate-confetti absolute top-0 h-3 w-2 rounded-sm", cls[i % cls.length])}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 10) * 0.3}s`, animationDuration: `${2.5 + (i % 5) * 0.4}s` }}
        />
      ))}
    </div>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("receipt p-4", className)}>{children}</div>;
}
