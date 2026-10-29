import type { TableState } from "./mock";
import { formatGBP, type SplitResult } from "./split";
import { activeGuests } from "./store";

export type Award = { key: string; title: string; guest_id: string; name: string; emoji: string; detail: string };

/** Table awards worked out from the same split totals the app shows. */
export function computeAwards(s: TableState, split: SplitResult): Award[] {
  const people = activeGuests(s);
  const total = (id: string) => split.perGuest.find((p) => p.guest_id === id)?.total_pence ?? 0;
  const out: Award[] = [];
  const add = (title: string, g: (typeof people)[number] | undefined, detail: string) => {
    if (g) out.push({ key: `${title}|${g.id}`, title, guest_id: g.id, name: g.name, emoji: g.emoji, detail });
  };
  const byTotal = [...people].filter((g) => total(g.id) > 0).sort((a, b) => total(b.id) - total(a.id));

  add("Big Spender", byTotal[0], formatGBP(total(byTotal[0]?.id ?? "")));

  if (s.bill.mode === "items") {
    const claimersOf = (itemId: string) => new Set(s.claims.filter((c) => c.item_id === itemId).map((c) => c.guest_id));
    const mineOf = (gid: string) => s.items.filter((i) => claimersOf(i.id).has(gid));
    // The Sharer
    let best: { g: (typeof people)[number]; n: number } | null = null;
    for (const g of people) {
      const n = mineOf(g.id).filter((i) => claimersOf(i.id).size > 1).length;
      if (n > 0 && (!best || n > best.n)) best = { g, n };
    }
    if (best) add("The Sharer", best.g, `${best.n} shared item${best.n > 1 ? "s" : ""}`);
    // <Dish> Hoarder
    let hoard: { g: (typeof people)[number]; dish: string; n: number } | null = null;
    for (const g of people) {
      const counts = new Map<string, number>();
      for (const i of mineOf(g.id)) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
      for (const [dish, n] of counts) if (n >= 2 && (!hoard || n > hoard.n)) hoard = { g, dish, n };
    }
    if (hoard) {
      const word = hoard.dish.trim().split(/\s+/).pop() ?? hoard.dish;
      add(`${word} Hoarder`, hoard.g, `${hoard.n} × ${hoard.dish}`);
    }
  }

  if (byTotal.length >= 2) { const g = byTotal[byTotal.length - 1]; add("Lightweight", g, formatGBP(total(g?.id ?? ""))); }

  const paid = people.filter((g) => g.paid_at).sort((a, b) => (a.paid_at! < b.paid_at! ? -1 : 1));
  add("Fastest Payer", paid[0], "first to pay");

  if (s.bill.status === "locked") {
    const owes = people.filter((g) => !g.is_host && !g.paid_at && total(g.id) > 0).sort((a, b) => total(b.id) - total(a.id));
    add("Still Owes 👀", owes[0], formatGBP(total(owes[0]?.id ?? "")));
  }
  return out;
}

export function awardsText(restaurant: string, awards: Award[], lines: Record<string, string>): string {
  return [`🏆 Table awards · ${restaurant}`, ...awards.map((a) => `${a.title}: ${a.emoji} ${a.name} (${a.detail})${lines[a.key] ? ` — ${lines[a.key]}` : ""}`)].join("\n");
}
