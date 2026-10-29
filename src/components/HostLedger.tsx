import { useEffect, useState } from "react";
import { Avatar, Money } from "@/components/kit";
import { formatGBP } from "@/lib/split";
import { activeGuests, fetchTable, getRecent, splitFor } from "@/lib/store";
import type { GuestRow } from "@/lib/mock";

type Row = { code: string; restaurant: string; link: string; owed: { g: GuestRow; pence: number }[] };

/** "You're owed" card for tables this phone hosts. */
export function HostLedger() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    const origin = window.location.origin;
    void Promise.all(getRecent().map(async (r): Promise<Row | null> => {
      const me = localStorage.getItem(`tabsplit:guest:${r.code}`);
      if (!me) return null;
      try {
        const s = await fetchTable(r.code);
        if (!s || !s.guests.some((g) => g.id === me && g.is_host)) return null;
        const split = splitFor(s);
        const owed = activeGuests(s)
          .filter((g) => !g.is_host && !g.paid_at)
          .map((g) => ({ g, pence: split.perGuest.find((p) => p.guest_id === g.id)?.total_pence ?? 0 }))
          .filter((o) => o.pence > 0);
        return { code: s.bill.code, restaurant: s.bill.restaurant_name, link: `${origin}/t/${s.bill.code}`, owed };
      } catch (e) { console.error(e); return null; }
    })).then((list) => { if (alive) setRows(list.filter((x): x is Row => Boolean(x && x.owed.length))); });
    return () => { alive = false; };
  }, []);

  const total = rows.reduce((s, r) => s + r.owed.reduce((t, o) => t + o.pence, 0), 0);
  if (!rows.length || total <= 0) return null;

  return (
    <section className="receipt border-2 border-primary p-4">
      <h2 className="text-xl">You're owed <Money p={formatGBP(total)} /> across {rows.length} table{rows.length > 1 ? "s" : ""}</h2>
      {rows.map((r) => {
        const msg = `Still owed for ${r.restaurant} 🧾 ${r.owed.map((o) => `${o.g.name} ${formatGBP(o.pence)}`).join(" · ")}, pay here: ${r.link}`;
        return (
          <div key={r.code}>
            <div className="rule-dashed my-3" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold">{r.restaurant}</span>
              <span className="shrink-0 font-mono text-sm text-muted-foreground">{r.code}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {r.owed.map((o) => (
                <li key={o.g.id} className="flex items-center gap-2 text-sm">
                  <Avatar g={o.g} size="sm" /><span className="min-w-0 flex-1 truncate">{o.g.name}</span><Money p={formatGBP(o.pence)} className="font-bold" />
                </li>
              ))}
            </ul>
            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-foreground font-semibold">Chase on WhatsApp</a>
          </div>
        );
      })}
    </section>
  );
}
