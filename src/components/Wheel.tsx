import { useEffect, useRef, useState, type ReactNode } from "react";
import { Confetti } from "@/components/kit";
import { wheelRotation } from "@/lib/split";
import type { GuestRow } from "@/lib/mock";

const SPIN_MS = 5000;

/**
 * Spins 0 → wheelRotation only when the winner goes from null to a value while mounted.
 * A winner already set on first render shows the result straight away.
 */
export function useWheelSpin(winnerId: string | null, order: string[]) {
  const initial = useRef(winnerId);
  const prev = useRef(winnerId);
  const [rotation, setRotation] = useState(() => {
    const i = winnerId ? order.indexOf(winnerId) : -1;
    return i >= 0 ? wheelRotation(i, order.length) : 0;
  });
  const [animating, setAnimating] = useState(false);
  const [done, setDone] = useState(Boolean(initial.current));

  useEffect(() => {
    const was = prev.current;
    prev.current = winnerId;
    if (!winnerId) { setRotation(0); setAnimating(false); setDone(false); return; }
    if (was !== null) return;
    const i = order.indexOf(winnerId);
    if (i < 0) return;
    setAnimating(false); setRotation(0); setDone(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      setAnimating(true); setRotation(wheelRotation(i, order.length));
    }));
    const t = setTimeout(() => setDone(true), SPIN_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerId]);

  return { rotation, animating, done };
}

export function Wheel({ players, rotation, animating, size, done, result }: {
  players: GuestRow[]; rotation: number; animating: boolean; size: string; done: boolean; result?: ReactNode;
}) {
  const n = Math.max(players.length, 1);
  const slice = 360 / n;
  // Shrinks with more people so labels stay inside their slice (slice width at 35% radius ≈ 1.1 × size / n).
  const fontScale = Math.min(0.055, 0.7 / n);
  const gradient = players.length
    ? `conic-gradient(${players.map((_, i) => `var(--wheel-${(i % 6) + 1}) ${i * slice}deg ${(i + 1) * slice}deg`).join(",")})`
    : "var(--muted)";
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {done && <Confetti />}
      <div className="relative aspect-square" style={{ width: size }}>
        <span className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 -translate-y-1 border-x-[14px] border-t-[26px] border-x-transparent border-t-foreground" />
        <div
          className="relative h-full w-full rounded-full border-4 border-card shadow-lg"
          style={{
            background: gradient,
            transform: `rotate(${rotation}deg)`,
            transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.7, 0.18, 1)` : "none",
          }}
        >
          {players.map((g, i) => {
            const a = (i + 0.5) * slice;
            const flip = a > 180; // keep left-side names reading the right way up
            const label = `${g.name.length > 10 ? `${g.name.slice(0, 10)}` : g.name}${g.has_phone ? "" : " 🪫"}`;
            return (
              // Arm from the centre to the rim along the slice's middle angle; text sits in 35%–85% of the radius.
              <span key={g.id} className="absolute left-1/2 top-1/2 h-0 w-1/2 origin-left"
                style={{ transform: `rotate(${a - 90}deg)` }}>
                <span className="absolute left-[35%] w-1/2 truncate text-center font-display leading-none text-primary-foreground"
                  style={{ fontSize: `calc(${size} * ${fontScale})`, top: "-0.5em", height: "1em", transform: flip ? "rotate(180deg)" : undefined }}>
                  {label}
                </span>
              </span>
            );
          })}
          <span className="absolute left-1/2 top-1/2 h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-foreground bg-card" />
        </div>
      </div>
      {done && result}
    </div>
  );
}
