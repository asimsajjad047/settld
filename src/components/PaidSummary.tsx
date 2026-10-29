import { formatGBP, type SplitResult } from "@/lib/split";
import type { TableState } from "@/lib/mock";
import { Money } from "@/components/kit";
import { cn } from "@/lib/utils";

/** "Who paid what" summary for settled tables (phone + big screen). */
export function PaidSummary({ state, split, compact = false }: { state: TableState; split: SplitResult; compact?: boolean }) {
  const bill = state.bill;
  const wheel = bill.mode === "wheel";
  const hold = bill.hold_amount_pence ?? 0;
  const shareOf = (id: string) => split.perGuest.find((p) => p.guest_id === id)?.total_pence ?? 0;

  const rows: { id: string; name: string; amount: number; method: string; released: number }[] = [];
  if (wheel) {
    const w = state.guests.find((g) => g.id === bill.wheel_winner_id);
    if (w) rows.push({ id: w.id, name: w.name, amount: split.billTotal, method: "Wheel winner 🎡", released: 0 });
  } else {
    for (const g of state.guests) {
      const amount = shareOf(g.id);
      if (amount <= 0) continue;
      const method = g.paid_via === "stripe" ? "Card ✅" : g.paid_via === "host" ? "Marked paid ✅" : "Bank/Monzo ✅";
      const released = bill.youmustpay && (g.payment_status === "captured" || g.payment_status === "released")
        ? Math.max(0, hold - Math.min(amount, hold))
        : 0;
      rows.push({ id: g.id, name: g.name, amount, method, released });
    }
  }
  if (!rows.length) return null;
  const paidTotal = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className={cn("receipt", compact ? "p-[1.5vh] text-[2vh]" : "mt-4 p-4")}>
      <p className={cn("font-mono uppercase tracking-[0.25em] text-muted-foreground", compact ? "text-[1.6vh]" : "text-xs")}>Who paid what</p>
      <div className="divide-y divide-dashed">
        {rows.map((r) => (
          <div key={r.id} className={compact ? "py-[0.6vh]" : "py-2"}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className={cn("shrink-0 text-muted-foreground", compact ? "text-[1.8vh]" : "text-sm")}>{r.method}</span>
              <Money p={formatGBP(r.amount)} className="shrink-0 font-bold" />
            </div>
            {r.released > 0 && (
              <p className={cn("text-muted-foreground", compact ? "text-[1.6vh]" : "text-xs")}>hold released {formatGBP(r.released)}</p>
            )}
          </div>
        ))}
      </div>
      <div className={cn("flex items-baseline justify-between gap-2 border-t border-dashed font-bold", compact ? "mt-[0.6vh] pt-[0.6vh]" : "mt-2 pt-2")}>
        <span>Total paid</span>
        <Money p={`${formatGBP(paidTotal)} of ${formatGBP(split.billTotal)}`} />
      </div>
    </div>
  );
}
