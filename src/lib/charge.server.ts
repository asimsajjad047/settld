import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Charge each held guest exactly their share with a fresh PaymentIntent; fall back to partial capture. */
export async function chargeHeldGuests(
  s: Stripe,
  c: SupabaseClient,
  code: string,
  state: import("./mock").TableState,
  split: import("./split").SplitResult,
) {
  let charged = 0, partial = 0, failed = 0;
  for (const g of state.guests) {
    if (g.payment_status !== "held" || !g.stripe_payment_intent_id) continue;
    const owed = split.perGuest.find((p) => p.guest_id === g.id)?.total_pence ?? 0;
    try {
      const hold = await s.paymentIntents.retrieve(g.stripe_payment_intent_id);
      if (hold.metadata["guest_id"] !== g.id) continue;
      if (owed <= 0) {
        if (hold.status === "requires_capture") await s.paymentIntents.cancel(hold.id);
        await c.from("guests").update({ payment_status: "released" }).eq("id", g.id);
        continue;
      }
      const amount = Math.min(owed, hold.amount);
      const full = owed <= hold.amount;
      let newPiId: string | null = null;
      const customer = typeof hold.customer === "string" ? hold.customer : hold.customer?.id;
      const pm = typeof hold.payment_method === "string" ? hold.payment_method : hold.payment_method?.id;
      const dest = hold.transfer_data?.destination;
      if (customer && pm && ["requires_capture", "canceled"].includes(hold.status)) {
        try {
          const sharePi = await s.paymentIntents.create({
            amount,
            currency: "gbp",
            customer,
            payment_method: pm,
            off_session: true,
            confirm: true,
            ...(dest ? { transfer_data: { destination: typeof dest === "string" ? dest : dest.id } } : {}),
            description: `Settld · ${state.bill.restaurant_name} · table ${code} · ${g.name}`,
            statement_descriptor_suffix: `SETTLD ${code}`,
            metadata: { code, guest_id: g.id, hold_pi: hold.id },
          }, { idempotencyKey: `share-${hold.id}` });
          if (sharePi.status === "succeeded") newPiId = sharePi.id;
        } catch (e) {
          console.error(`[captureShares] off-session charge failed for guest ${g.id} (hold ${hold.id}):`, e instanceof Error ? e.message : e);
          newPiId = null;
        }
      }
      if (newPiId) {
        if (hold.status === "requires_capture") {
          try { await s.paymentIntents.cancel(hold.id); } catch { /* already gone */ }
        }
      } else if (hold.status === "requires_capture") {
        await s.paymentIntents.capture(hold.id, { amount_to_capture: amount }, { idempotencyKey: `capture-${hold.id}` });
      } else if (hold.status !== "succeeded") {
        failed++; await c.from("guests").update({ payment_status: "failed" }).eq("id", g.id); continue;
      }
      const base = newPiId ? { payment_status: "captured", stripe_payment_intent_id: newPiId } : { payment_status: "captured" };
      await c.from("guests").update(full
        ? { ...base, paid_at: new Date().toISOString(), paid_via: "stripe" }
        : base).eq("id", g.id);
      if (full) charged++; else partial++;
    } catch { failed++; }
  }
  return { charged, partial, failed };
}

