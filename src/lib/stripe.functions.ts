import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { chargeHeldGuests } from "./charge.server";

function stripe() {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("Stripe isn't set up yet.");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

function db() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => {
      const h = new Headers(init?.headers);
      if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
      h.set("apikey", key);
      return fetch(input, { ...init, headers: h });
    } },
  });
}

const FALLBACK_ORIGIN = "https://tabsplit-live.lovable.app";
function okOrigin(v: unknown, extra: string[] = []): string | null {
  try {
    const u = new URL(String(v));
    if (u.protocol !== "https:") return null;
    const h = u.hostname;
    if (h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com") || extra.includes(u.origin)) return u.origin;
  } catch { /* ignore */ }
  return null;
}
function safeOrigin(clientOrigin?: string): string {
  const req = getRequest();
  const hdrs: string[] = [];
  for (const k of ["origin", "referer"]) {
    const v = req.headers.get(k);
    if (v) { try { const u = new URL(v); if (u.protocol === "https:") hdrs.push(u.origin); } catch { /* ignore */ } }
  }
  return okOrigin(clientOrigin, hdrs) ?? FALLBACK_ORIGIN;
}

const codeInput = (input: { code: string; origin?: string }) => {
  const code = String(input?.code ?? "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error("Bad code");
  return { code, origin: typeof input?.origin === "string" ? input.origin : undefined };
};

async function loadBill(code: string) {
  const { data, error } = await db().from("bills").select("id, host_stripe_account_id").eq("code", code).maybeSingle();
  if (error || !data) throw new Error("Table not found");
  return data as { id: string; host_stripe_account_id: string | null };
}

export const createHostAccount = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }) => {
    const s = stripe();
    const bill = await loadBill(data.code);
    let accountId = bill.host_stripe_account_id;
    if (!accountId) {
      const acct = await s.accounts.create({
        type: "express",
        country: "GB",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      accountId = acct.id;
      const { error } = await db().from("bills").update({ host_stripe_account_id: accountId }).eq("id", bill.id);
      if (error) throw new Error("Couldn't save account");
    }
    const origin = safeOrigin(data.origin);
    const back = `${origin}/t/${data.code}`;
    const link = await s.accountLinks.create({ account: accountId, type: "account_onboarding", return_url: back, refresh_url: back });
    return { url: link.url };
  });

export const hostAccountStatus = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }) => {
    const bill = await loadBill(data.code);
    if (!bill.host_stripe_account_id) return { connected: false, charges_enabled: false };
    const acct = await stripe().accounts.retrieve(bill.host_stripe_account_id);
    return { connected: true, charges_enabled: Boolean(acct.charges_enabled) };
  });

// ---- Guest card payment (Stripe Checkout) ----
async function loadState(code: string) {
  const { splitFor } = await import("./store");
  const c = db();
  const { data: bill } = await c.from("bills").select("*").eq("code", code).maybeSingle();
  if (!bill) throw new Error("Table not found");
  const [r, i, g, cl] = await Promise.all([
    c.from("receipts").select("*").eq("bill_id", bill.id),
    c.from("items").select("*").eq("bill_id", bill.id),
    c.from("guests").select("*").eq("bill_id", bill.id).order("created_at"),
    c.from("claims").select("*").eq("bill_id", bill.id),
  ]);
  const state = { bill, receipts: r.data ?? [], items: i.data ?? [], guests: g.data ?? [], claims: cl.data ?? [] } as unknown as import("./mock").TableState;
  return { state, split: splitFor(state) };
}

// What a guest still owes by card: their share, minus a YouMustPay hold already charged against it.
function stillOwed(state: import("./mock").TableState, split: import("./split").SplitResult, guestId: string) {
  const g = state.guests.find((x) => x.id === guestId);
  const total = split.perGuest.find((p) => p.guest_id === guestId)?.total_pence ?? 0;
  const covered = g?.payment_status === "captured" && !g.paid_at ? Math.min(total, state.bill.hold_amount_pence ?? 0) : 0;
  return total - covered;
}

const payInput = (input: { code: string; guest_id: string; origin?: string }) => {
  const { code, origin } = codeInput(input);
  const guest_id = String(input?.guest_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(guest_id)) throw new Error("Bad guest");
  return { code, guest_id, origin };
};

export const cardPaymentsAvailable = createServerFn({ method: "GET" }).handler(async () => {
  try { await stripe().balance.retrieve(); return { ok: true }; } catch { return { ok: false }; }
});

export const createGuestCheckout = createServerFn({ method: "POST" })
  .inputValidator(payInput)
  .handler(async ({ data }) => {
    const s = stripe();
    const { state, split } = await loadState(data.code);
    const owed = stillOwed(state, split, data.guest_id);
    if (owed <= 0) throw new Error("Nothing to pay");
    let destination: string | undefined;
    const acct = state.bill.host_stripe_account_id;
    if (acct) {
      try { if ((await s.accounts.retrieve(acct)).charges_enabled) destination = acct; } catch { /* platform */ }
    }
    const origin = safeOrigin(data.origin);
    const session = await s.checkout.sessions.create({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: owed,
        product_data: { name: `Settld · ${state.bill.restaurant_name} · table ${data.code}` } } }],
      metadata: { code: data.code, guest_id: data.guest_id },
      ...(destination ? { payment_intent_data: { transfer_data: { destination } } } : {}),
      success_url: `${origin}/t/${data.code}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/t/${data.code}`,
    });
    return { url: session.url! };
  });

export const verifyGuestCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; session_id: string }) => {
    const { code } = codeInput(input);
    const session_id = String(input?.session_id ?? "");
    if (!/^cs_[A-Za-z0-9_]+$/.test(session_id)) throw new Error("Bad session");
    return { code, session_id };
  })
  .handler(async ({ data }) => {
    const session = await stripe().checkout.sessions.retrieve(data.session_id);
    const guestId = session.metadata?.["guest_id"] ?? "";
    if (session.payment_status !== "paid" || session.metadata?.["code"] !== data.code || !guestId) return { ok: false };
    const { state, split } = await loadState(data.code);
    const owed = state.guests.some((g) => g.id === guestId) ? stillOwed(state, split, guestId) : -1;
    if (session.amount_total !== owed) return { ok: false };
    const { error } = await db().from("guests")
      .update({ paid_at: new Date().toISOString(), paid_via: "stripe", stripe_session_id: session.id })
      .eq("id", guestId).eq("bill_id", state.bill.id);
    return { ok: !error };
  });

// ---- YouMustPay: card holds (manual-capture destination charges to the host's account) ----
const holdInput = (input: { code: string; guestId: string }) => {
  const { code, guest_id } = payInput({ code: input?.code, guest_id: input?.guestId });
  return { code, guestId: guest_id };
};

async function readyHostAccount(s: Stripe, bill: { youmustpay?: boolean; host_stripe_account_id?: string | null }) {
  if (!bill.youmustpay || !bill.host_stripe_account_id) return null;
  try { return (await s.accounts.retrieve(bill.host_stripe_account_id)).charges_enabled ? bill.host_stripe_account_id : null; }
  catch { return null; }
}

/** Is YouMustPay active for this table (switch on AND host can take charges)? */
export const youMustPayActive = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }) => {
    try {
      const { data: bill } = await db().from("bills").select("youmustpay, host_stripe_account_id").eq("code", data.code).maybeSingle();
      if (!bill || !bill.youmustpay) return { active: false, host_ready: false };
      const s = stripe();
      let ready = false;
      try { ready = Boolean(await readyHostAccount(s, bill)); } catch { ready = false; }
      return { active: true, host_ready: ready };
    } catch { return { active: false, host_ready: false }; }
  });

export const createHold = createServerFn({ method: "POST" })
  .inputValidator(holdInput)
  .handler(async ({ data }) => {
    const s = stripe();
    const c = db();
    const { data: bill } = await c.from("bills").select("*").eq("code", data.code).maybeSingle();
    if (!bill) throw new Error("Table not found");
    if (!bill.youmustpay) throw new Error("YouMustPay isn't on");
    // Host not ready yet → hold on the platform account so the table never gets stuck.
    let dest: string | null = null;
    try { dest = await readyHostAccount(s, bill); } catch { dest = null; }
    const { data: guest } = await c.from("guests").select("*").eq("id", data.guestId).eq("bill_id", bill.id).maybeSingle();
    if (!guest || guest.is_host) throw new Error("Guest not found");
    let customerId: string | null = null;
    if (guest.stripe_payment_intent_id) {
      try {
        const pi = await s.paymentIntents.retrieve(guest.stripe_payment_intent_id);
        customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
        // Only reuse a hold whose card can be charged off-session later; otherwise cancel it and start fresh.
        const reusable = Boolean(customerId) && pi.setup_future_usage === "off_session";
        const usable = ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture"].includes(pi.status);
        if (usable && reusable && pi.amount === bill.hold_amount_pence && pi.metadata["guest_id"] === guest.id && pi.client_secret)
          return { client_secret: pi.client_secret, amount: pi.amount };
        if (!reusable && !["succeeded", "canceled"].includes(pi.status)) {
          try { await s.paymentIntents.cancel(pi.id); } catch { /* already gone */ }
        }
      } catch { /* make a new one */ }
    }
    if (!customerId) {
      const cust = await s.customers.create(
        { name: guest.name, metadata: { code: data.code, guest_id: guest.id } },
        { idempotencyKey: `cust-${guest.id}` },
      );
      customerId = cust.id;
    }
    const pi = await s.paymentIntents.create({
      amount: bill.hold_amount_pence,
      currency: "gbp",
      capture_method: "manual",
      customer: customerId,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      ...(dest ? { transfer_data: { destination: dest } } : {}),
      description: `Settld card hold · ${bill.restaurant_name} · table ${data.code} · ${guest.name}`,
      metadata: { code: data.code, guest_id: guest.id, customer: customerId },
    });
    const { error } = await c.from("guests").update({ stripe_payment_intent_id: pi.id }).eq("id", guest.id);
    if (error) throw new Error("Couldn't save hold");
    return { client_secret: pi.client_secret!, amount: pi.amount };
  });

export const confirmHold = createServerFn({ method: "POST" })
  .inputValidator(holdInput)
  .handler(async ({ data }) => {
    const c = db();
    const { data: bill } = await c.from("bills").select("id").eq("code", data.code).maybeSingle();
    if (!bill) return { held: false };
    const { data: guest } = await c.from("guests").select("id, stripe_payment_intent_id").eq("id", data.guestId).eq("bill_id", bill.id).maybeSingle();
    if (!guest?.stripe_payment_intent_id) return { held: false };
    const pi = await stripe().paymentIntents.retrieve(guest.stripe_payment_intent_id);
    const ok = pi.status === "requires_capture" && pi.metadata["guest_id"] === guest.id && pi.metadata["code"] === data.code;
    if (!ok) return { held: false };
    await c.from("guests").update({ payment_status: "held" }).eq("id", guest.id);
    return { held: true };
  });

export const captureShares = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }) => {
    const { state, split } = await loadState(data.code);
    if (state.bill.status === "claiming") throw new Error("Lock the bill first");
    return chargeHeldGuests(stripe(), db(), data.code, state, split);
  });

export const releaseHolds = createServerFn({ method: "POST" })
  .inputValidator(codeInput)
  .handler(async ({ data }) => {
    const s = stripe();
    const c = db();
    const { data: bill } = await c.from("bills").select("id").eq("code", data.code).maybeSingle();
    if (!bill) return { released: 0 };
    const { data: guests } = await c.from("guests").select("id, stripe_payment_intent_id, payment_status").eq("bill_id", bill.id);
    let released = 0;
    for (const g of guests ?? []) {
      if (!g.stripe_payment_intent_id || g.payment_status === "captured") continue;
      try {
        const pi = await s.paymentIntents.retrieve(g.stripe_payment_intent_id);
        if (!["succeeded", "canceled"].includes(pi.status)) await s.paymentIntents.cancel(pi.id);
        await c.from("guests").update({ payment_status: "released", stripe_payment_intent_id: null }).eq("id", g.id);
        released++;
      } catch { /* leave as is */ }
    }
    return { released };
  });
