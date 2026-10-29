import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { matchClaims } from "@/lib/claim-text.functions";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar, Btn, Confetti, CopyBtn, Money } from "@/components/kit";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { newGuest, paidLabel, type GuestRow, type TableState } from "@/lib/mock";
import { allocate, formatGBP, isSettled, monzoLink, pickWinner, wheelOrder, type SplitResult } from "@/lib/split";
import { activeGuests, rows, splitFor, useTable } from "@/lib/store";
import { Wheel, useWheelSpin } from "@/components/Wheel";
import { Awards } from "@/components/Awards";
import { PaidSummary } from "@/components/PaidSummary";
import { captureShares, cardPaymentsAvailable, createGuestCheckout, createHostAccount, hostAccountStatus, releaseHolds, verifyGuestCheckout, youMustPayActive } from "@/lib/stripe.functions";
import { SecureSeat } from "@/components/SecureSeat";

// Stripe pages refuse to load inside an iframe (the Lovable editor preview):
// open them in a new tab there, and keep the same-tab redirect otherwise.
function openStripeUrl(url: string) {
  if (window.self !== window.top) {
    const win = window.open(url, "_blank");
    if (win) return;
    try { window.top!.location.href = url; } catch { window.location.href = url; }
    return;
  }
  window.location.href = url;
}

/** Bumps when the page regains focus/visibility or the host taps "refresh", so Stripe status is re-checked. */
function useRecheckTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setTick((n) => n + 1); };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("settld:stripe-recheck", bump);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("settld:stripe-recheck", bump);
    };
  }, []);
  return tick;
}
const recheckStripe = () => window.dispatchEvent(new Event("settld:stripe-recheck"));

function YouMustPay({ ctx }: { ctx: Ctx }) {
  const { state, mutate } = ctx;
  const bill = state.bill;
  const on = Boolean(bill.youmustpay);
  const create = useServerFn(createHostAccount);
  const status = useServerFn(hostAccountStatus);
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const tick = useRecheckTick();
  useEffect(() => {
    if (!on || !bill.host_stripe_account_id) { setReady(null); return; }
    let live = true;
    const acct = bill.host_stripe_account_id;
    status({ data: { code: bill.code } }).then((r) => {
      try {
        if (r.charges_enabled) localStorage.setItem("tabsplit:host_stripe", acct);
        else if (localStorage.getItem("tabsplit:host_stripe") === acct) localStorage.removeItem("tabsplit:host_stripe");
      } catch { /* ignore */ }
      if (live) setReady(r.charges_enabled);
    }).catch(() => live && setReady(false));
    return () => { live = false; };
  }, [on, bill.host_stripe_account_id, bill.code, tick]);
  const anyHeld = state.guests.some((g) => g.payment_status === "held" || g.payment_status === "captured");
  const [holdStr, setHoldStr] = useState(((bill.hold_amount_pence ?? 4000) / 100).toFixed(2));
  const saveHold = () => {
    const p = Math.round(Number.parseFloat(holdStr.replace(/[£,\s]/g, "")) * 100);
    if (!Number.isFinite(p) || p < 500 || p > 50000) { ctx.notify("Hold must be £5 to £500"); setHoldStr(((bill.hold_amount_pence ?? 4000) / 100).toFixed(2)); return; }
    if (p === bill.hold_amount_pence) return;
    void mutate((s) => ({ ...s, bill: { ...s.bill, hold_amount_pence: p } }),
      async () => { rows(await supabase.from("bills").update({ hold_amount_pence: p }).eq("id", bill.id)); });
  };
  const toggle = () => {
    const patch = { youmustpay: !on };
    void mutate((s) => ({ ...s, bill: { ...s.bill, ...patch } }),
      async () => { rows(await supabase.from("bills").update(patch).eq("id", bill.id)); });
  };
  const connect = async () => {
    setBusy(true);
    try { const { url } = await create({ data: { code: bill.code, origin: window.location.origin } }); openStripeUrl(url); setOpened(true); }
    catch { ctx.notify("Couldn't reach Stripe, try again"); }
    setBusy(false);
  };
  return (
    <div>
      <button role="switch" aria-checked={on} onClick={toggle} className="flex min-h-12 w-full items-center justify-between">
        <span className="text-left"><span className="block text-sm font-semibold">YouMustPay</span>
          <span className="block text-xs text-muted-foreground">Guests put a card hold on before claiming</span></span>
        <span className={cn("relative h-7 w-12 rounded-full transition", on ? "bg-primary" : "bg-input")}>
          <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-background transition-all", on ? "left-6" : "left-1")} />
        </span>
      </button>
      {on && !anyHeld && (
        <label className="mt-2 flex items-center justify-between gap-3">
          <span className="text-sm">Card hold per person (£)</span>
          <input className="h-12 w-28 rounded-xl border-2 border-input bg-background px-3 text-right font-mono" inputMode="decimal"
            value={holdStr} onChange={(e) => setHoldStr(e.target.value)} onBlur={saveHold} />
        </label>
      )}
      {on && (ready ? <p className="mt-2 text-sm font-semibold">Stripe connected ✅</p>
        : <Btn className="mt-2 w-full" disabled={busy} onClick={() => void connect()}>
            {busy ? "Opening Stripe…" : bill.host_stripe_account_id ? "Finish connecting Stripe" : "Connect Stripe to get paid"}
          </Btn>)}
      {on && !ready && opened && <button className="mt-2 min-h-12 w-full text-sm font-semibold underline" onClick={recheckStripe}>Finished in Stripe? Tap to refresh</button>}
    </div>
  );
}

function ConnectStripeCard({ ctx }: { ctx: Ctx }) {
  const create = useServerFn(createHostAccount);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const bill = ctx.state.bill;
  const connect = async () => {
    setBusy(true);
    try { const { url } = await create({ data: { code: bill.code, origin: window.location.origin } }); openStripeUrl(url); setOpened(true); }
    catch { ctx.notify("Couldn't reach Stripe, try again"); }
    setBusy(false);
  };
  return (
    <div className="receipt flex flex-col gap-3 border-2 border-primary p-5">
      <h2 className="text-xl">🔒 Connect Stripe to get paid</h2>
      <p className="text-sm text-muted-foreground">Payments go to Settld until you finish Stripe setup.</p>
      <Btn className="min-h-14 w-full text-lg" disabled={busy} onClick={() => void connect()}>
        {busy ? "Opening Stripe…" : bill.host_stripe_account_id ? "Finish connecting Stripe" : "Connect Stripe to get paid"}
      </Btn>
      {opened && <button className="min-h-12 text-sm font-semibold underline" onClick={recheckStripe}>Finished in Stripe? Tap to refresh</button>}
    </div>
  );
}

const WATCH = "watch";
const now = () => new Date().toISOString();
const guestKey = (code: string) => `tabsplit:guest:${code}`;

type Ctx = {
  state: TableState; split: SplitResult; me: GuestRow | null; url: string;
  mutate: ReturnType<typeof useTable>["mutate"];
  toggleClaim: ReturnType<typeof useTable>["toggleClaim"];
  setTab: (t: "pick" | "table") => void;
  notify: (m: string) => void;
  ympActive?: boolean;
  ympPending?: boolean;
};

export function TableApp({ code }: { code: string }) {
  const { state, ready, mutate, toggleClaim, refetch } = useTable(code);
  const joinRetries = useRef(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [tab, setTab] = useState<"pick" | "table">("pick");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [demo, setDemo] = useState(false);
  useEffect(() => setDemo(new URLSearchParams(window.location.search).get("demo") === "1"), []);
  const noticeT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (m: string) => { setNotice(m); clearTimeout(noticeT.current); noticeT.current = setTimeout(() => setNotice(""), 2500); };

  useEffect(() => setUrl(`${window.location.origin}/t/${code}`), [code]);

  // YouMustPay is only active when the switch is on AND the host's Stripe account can take charges.
  const ympCheck = useServerFn(youMustPayActive);
  const [ympActive, setYmpActive] = useState(false);
  const [ympChecked, setYmpChecked] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const ympTick = useRecheckTick();
  const ympOn = Boolean(state?.bill.youmustpay);
  useEffect(() => {
    if (!ympOn) { setYmpActive(false); setHostReady(false); setYmpChecked(true); return; }
    let live = true;
    ympCheck({ data: { code } }).then((r) => { if (live) { setYmpActive(r.active); setHostReady(r.host_ready); } })
      .catch(() => live && setYmpActive(false))
      .finally(() => live && setYmpChecked(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ympOn, state?.bill.host_stripe_account_id, code, ympTick]);

  // Remember a working Stripe account on this phone so the host only onboards once.
  useEffect(() => {
    const acct = state?.bill.host_stripe_account_id;
    if (!ympActive || !hostReady || !acct || !meId || state?.guests.find((g) => g.id === meId)?.is_host !== true) return;
    try {
      const h = JSON.parse(localStorage.getItem("tabsplit:host") ?? "{}") as Record<string, unknown>;
      if (h["stripe_account_id"] !== acct) localStorage.setItem("tabsplit:host", JSON.stringify({ ...h, stripe_account_id: acct }));
    } catch { /* ignore */ }
  }, [ympActive, hostReady, state?.bill.host_stripe_account_id, meId, state?.guests]);

  // Returning from Stripe Checkout: verify on the server, then drop ?paid= from the URL.
  const verify = useServerFn(verifyGuestCheckout);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("paid");
    if (!sid) return;
    params.delete("paid");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    verify({ data: { code, session_id: sid } })
      .then((r) => notify(r.ok ? "Payment verified ✅" : "Couldn't verify that payment"))
      .catch(() => notify("Couldn't verify that payment"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Client-only identity: reuse the saved id, or create one (saved BEFORE the write) while claiming.
  const guestsLoaded = Boolean(state);
  useEffect(() => {
    if (!state) return;
    if (meId === WATCH) return;
    const saved = localStorage.getItem(guestKey(code));
    if (saved && state.guests.some((g) => g.id === saved)) { setMeId(saved); setIdentityChecked(true); return; }
    if (state.bill.status === "claiming") {
      const id = saved ?? crypto.randomUUID();
      localStorage.setItem(guestKey(code), id);
      setMeId(id);
      const g = newGuest(state.bill.id, state.guests, id);
      void mutate((s) => (s.guests.some((x) => x.id === id) ? s : { ...s, guests: [...s.guests, g as GuestRow] }),
        async () => { const { error } = await supabase.from("guests").upsert(g, { onConflict: "id", ignoreDuplicates: true }); if (error) throw error; });
    }
    setIdentityChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestsLoaded, state?.bill.status, state?.guests.length, code]);

  // Saved id but row not in the loaded list yet: refetch every 1s, up to 5 times, instead of watching.
  const meMissing = Boolean(state && meId && meId !== WATCH && state.bill.status === "claiming" && !state.guests.some((g) => g.id === meId));
  useEffect(() => {
    if (!meMissing || joinRetries.current >= 5) return;
    const t = setTimeout(() => { joinRetries.current++; void refetch(); }, 1000);
    return () => clearTimeout(t);
  }, [meMissing, state, refetch]);

  // Settle once every owing guest has paid.
  const split = state ? splitFor(state) : null;
  const settledNow = Boolean(state && split && state.bill.status === "locked" && isSettled(split, state.guests));
  useEffect(() => {
    if (!state || !settledNow) return;
    const at = now();
    void mutate((s) => ({ ...s, bill: { ...s.bill, status: "settled", settled_at: at } }),
      async () => { rows(await supabase.from("bills").update({ status: "settled", settled_at: at }).eq("id", state.bill.id)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledNow]);

  if (!ready) return <main className="phone-page" />;
  if (!state || !split) {
    return (
      <main className="phone-page grid place-items-center text-center">
        <div><h1 className="text-3xl">No table {code}</h1>
          <Link to="/" className="mt-4 inline-block font-semibold text-primary">← Home</Link></div>
      </main>
    );
  }

  const me = state.guests.find((g) => g.id === meId) ?? null;
  const watching = meId === WATCH;
  const isHost = Boolean(me?.is_host);
  const status = state.bill.status;
  // YouMustPay table whose host hasn't finished connecting Stripe yet.
  // Host's Stripe not ready yet: never blocks the table (holds go to the platform), just shows a note.
  const ympPending = false;
  const hostNotReady = Boolean(state.bill.youmustpay) && ympChecked && !hostReady;
  const holdLabel = formatGBP(state.bill.hold_amount_pence ?? 4000);
  const ctx: Ctx = { state, split, me, url, mutate, toggleClaim, setTab, notify, ympActive, ympPending };
  const needsHold = ympActive && Boolean(me) && !me!.is_host && status === "claiming" && state.bill.mode !== "wheel"
    && me!.payment_status !== "held" && me!.payment_status !== "captured";

  const needsWho = identityChecked && !me && !watching && status === "locked";

  return (
    <main className="phone-page flex flex-col gap-4">
      <Link to="/" className="-mb-2 self-start text-sm font-semibold text-muted-foreground">← Settld</Link>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{state.bill.restaurant_name}</h1>
          <p className="font-mono text-sm text-muted-foreground">TABLE {state.bill.code} · {formatGBP(split.billTotal)}</p>
        </div>
        {me && <NameChip g={me} ctx={ctx} />}
        {watching && <span className="shrink-0 font-semibold">👀 Watching</span>}
      </header>
      {state.bill.youmustpay && !isHost && (status === "claiming" || !me) && me?.payment_status !== "held" && me?.payment_status !== "captured" && (
        <p className="rounded-xl border-2 border-primary bg-accent p-3 text-sm font-semibold">🔒 This table requires a {holdLabel} card hold. You'll only be charged your share of the bill; the rest is released.</p>
      )}
      {isHost && hostNotReady && <ConnectStripeCard ctx={ctx} />}
      {isHost && <HostBar ctx={ctx} />}
      {isHost && demo && status === "claiming" && <SimulateTable state={state} />}
      {notice && <p className="rounded-xl bg-warning-soft p-3 text-center font-semibold">{notice}</p>}
      {status === "settled" && state.bill.mode !== "wheel" ? <SettledView ctx={ctx} />
        : needsWho ? <WhoView ctx={ctx} pick={(id) => { if (id !== WATCH) localStorage.setItem(guestKey(code), id); setMeId(id); }} />
        : state.bill.mode === "wheel" ? <WheelView ctx={ctx} />
        : ympPending && me && !isHost && status === "claiming" ? (
          <div className="receipt p-6 text-center"><p className="text-4xl">🔒</p><h2 className="mt-2 text-xl">This table requires a card hold</h2>
            <p className="mt-2 text-sm text-muted-foreground">Waiting for the host to connect Stripe. This page updates by itself.</p></div>)
        : needsHold && me ? <SecureSeat code={state.bill.code} guestId={me.id} holdPence={state.bill.hold_amount_pence ?? 4000}
            onHeld={() => void mutate((s) => ({ ...s, guests: s.guests.map((g) => (g.id === me.id ? { ...g, payment_status: "held" as const } : g)) }), async () => undefined)} />
        : status === "locked" ? (isHost ? <TrackView ctx={ctx} /> : me ? <PayView ctx={ctx} /> : <TableView ctx={ctx} />)
        : state.bill.mode === "even" || tab === "table" ? <TableView ctx={ctx} /> : tab === "pick" ? <PickView ctx={ctx} /> : <TableView ctx={ctx} />}
    </main>
  );
}

const share = (ctx: Ctx, id: string) => ctx.split.perGuest.find((p) => p.guest_id === id) ?? { food_pence: 0, service_pence: 0, total_pence: 0, guest_id: id };
const hostOf = (s: TableState) => s.guests.find((g) => g.is_host);

function setPaid(ctx: Ctx, id: string, paid: boolean, via: "self" | "host" = "self") {
  const at = paid ? now() : null;
  const paid_via = paid ? via : null;
  void ctx.mutate((s) => ({ ...s, guests: s.guests.map((g) => (g.id === id ? { ...g, paid_at: at, paid_via } : g)) }),
    async () => { rows(await supabase.from("guests").update({ paid_at: at, paid_via }).eq("id", id)); });
}

function NameChip({ g, ctx }: { g: GuestRow; ctx: Ctx }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(g.name);
  const save = () => {
    const n = val.trim();
    if (n && n !== g.name) void ctx.mutate((s) => ({ ...s, guests: s.guests.map((x) => (x.id === g.id ? { ...x, name: n } : x)) }),
      async () => { rows(await supabase.from("guests").update({ name: n }).eq("id", g.id)); });
    setEditing(false);
  };
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Avatar g={g} />
      {editing ? (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-10 w-32 rounded-lg border-2 border-primary bg-card px-2" aria-label="Your name" />
      ) : (
        <button onClick={() => { setVal(g.name); setEditing(true); }} className="min-h-10 max-w-36 truncate text-left font-semibold">{g.name} ✏️</button>
      )}
    </div>
  );
}

function lockHint(ctx: Ctx): string | null {
  if (!ctx.me?.is_host || ctx.state.bill.status !== "claiming" || !ctx.state.bill.youmustpay) return null;
  const n = ctx.split.unclaimed.length;
  return n === 0 ? null : `Claim everything first (${n} left)`;
}

function LockButton({ ctx, className }: { ctx: Ctx; className?: string }) {
  const { state, split, mutate } = ctx;
  const capture = useServerFn(captureShares);
  if (!ctx.me?.is_host || state.bill.status !== "claiming") return null;
  const ready = split.unclaimed.length === 0;
  const ymp = Boolean(state.bill.youmustpay);
  const autoCharge = ymp && state.guests.some((g) => g.payment_status === "held");
  return (
    <Btn variant="ink" disabled={ymp && !ready}
      className={cn("min-w-0 whitespace-normal text-center leading-tight", ready && "animate-pulse", className)}
      onClick={() => void mutate((s) => ({ ...s, bill: { ...s.bill, status: "locked" } }),
        async () => {
          rows(await supabase.from("bills").update({ status: "locked" }).eq("id", state.bill.id));
          if (!autoCharge) return;
          try {
            const r = await capture({ data: { code: state.bill.code } });
            const n = r.charged + r.partial;
            ctx.notify(`Charged ${n} card${n === 1 ? "" : "s"} ✅${r.partial ? ` · ${r.partial} still owe the rest` : ""}${r.failed ? ` · ${r.failed} failed, tap Charge everyone` : ""}`);
          } catch { ctx.notify("Couldn't charge cards, tap Charge everyone"); }
        })}>
      {ymp ? "🔒 Lock & charge cards" : "🔒 Lock"}
    </Btn>
  );
}

function HostBar({ ctx }: { ctx: Ctx }) {
  const { state, mutate, url } = ctx;
  const [qr, setQr] = useState(false);
  const [menu, setMenu] = useState(false);
  const release = useServerFn(releaseHolds);
  const btn = "flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl text-xs font-semibold";
  const billId = state.bill.id;
  const doShare = () => {
    const holdNote = state.bill.youmustpay ? ` 🔒 ${formatGBP(state.bill.hold_amount_pence ?? 4000)} card hold to join.` : "";
    const text = `Join our table on Settld: ${url} (code ${state.bill.code})${holdNote}`;
    if (navigator.share) void navigator.share({ text }).catch(() => undefined);
    else { void navigator.clipboard?.writeText(url); ctx.notify("Link copied"); }
  };
  return (
    <div>
      <div className="receipt flex gap-1 bg-foreground p-1 text-background">
        {ctx.ympPending ? (
          <span className="flex min-h-14 flex-[3] items-center justify-center text-sm font-semibold opacity-70">Connect Stripe first</span>
        ) : (<>
        <button className={btn} onClick={doShare}><span className="text-lg">📤</span>Share</button>
        <button className={btn} onClick={() => setQr(true)}><span className="text-lg">▦</span>QR</button>
        <Link to="/t/$code/screen" params={{ code: state.bill.code }} className={btn}><span className="text-lg">📺</span>Big screen</Link>
        </>)}
        <button className={btn} onClick={() => setMenu(!menu)} aria-label="Settings"><span className="text-lg">⚙️</span>More</button>
      </div>
      {menu && (
        <div className="receipt mt-2 p-3">
          <p className="mb-2 text-sm font-semibold">Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {([["items", "Split by items"], ["even", "Split evenly"], ["wheel", "Spin for it 🎡"]] as const).map(([m, l]) => (
              <button key={m}
                onClick={() => {
                  setMenu(false);
                  if (m === state.bill.mode) return;
                  const patch = { mode: m, status: "claiming" as const, wheel_winner_id: null, wheel_spun_at: null, settled_at: null };
                  if (state.bill.status === "claiming") {
                    void mutate((s) => ({ ...s, bill: { ...s.bill, ...patch } }),
                      async () => { rows(await supabase.from("bills").update(patch).eq("id", billId)); });
                    return;
                  }
                  if (!confirm("Switch mode? This reopens the bill and clears everyone's payments.")) return;
                  void mutate((s) => ({ ...s, guests: s.guests.map((g) => ({ ...g, paid_at: null })), bill: { ...s.bill, ...patch } }),
                    async () => {
                      rows(await supabase.from("guests").update({ paid_at: null }).eq("bill_id", billId));
                      rows(await supabase.from("bills").update(patch).eq("id", billId));
                    });
                }}
                className={cn("min-h-12 rounded-xl border-2 text-sm font-semibold", state.bill.mode === m ? "border-primary bg-accent" : "border-input")}>{l}</button>
            ))}
          </div>
          <div className="rule-dashed my-3" />
          <YouMustPay ctx={ctx} />
          <div className="rule-dashed my-3" />
          <div className="flex gap-2">
            <Btn variant="outline" className="flex-1" onClick={() => {
              const g = { ...newGuest(billId, state.guests), has_phone: false, emoji: "🪫" };
              void mutate((s) => ({ ...s, guests: [...s.guests, g] }), async () => { rows(await supabase.from("guests").insert(g)); });
            }}>+ Add person</Btn>
            <Btn variant="outline" className="flex-1" onClick={() => {
              if (!confirm("Reset all claims and payments?")) return;
              void release({ data: { code: state.bill.code } }).catch(() => undefined);
              void mutate(
                (s) => ({ ...s, claims: [], guests: s.guests.map((g) => ({ ...g, paid_at: null })),
                  bill: { ...s.bill, status: "claiming", settled_at: null, wheel_winner_id: null, wheel_spun_at: null } }),
                async () => {
                  rows(await supabase.from("claims").delete().eq("bill_id", billId));
                  rows(await supabase.from("guests").update({ paid_at: null }).eq("bill_id", billId));
                  rows(await supabase.from("bills").update({ status: "claiming", settled_at: null, wheel_winner_id: null, wheel_spun_at: null }).eq("id", billId));
                },
              );
              setMenu(false);
            }}>Reset</Btn>
          </div>
        </div>
      )}
      {qr && (
        <button className="fixed inset-0 z-50 grid place-items-center bg-foreground/70 p-6" onClick={() => setQr(false)}>
          <div className="receipt flex flex-col items-center gap-3 p-6">
            <QRCodeSVG value={url || state.bill.code} size={240} bgColor="transparent" fgColor="currentColor" />
            <span className="font-mono text-5xl font-bold tracking-[0.3em]">{state.bill.code}</span>
            {state.bill.youmustpay && <span className="font-semibold">🔒 {formatGBP(state.bill.hold_amount_pence ?? 4000)} card hold to join</span>}
            <span className="text-sm text-muted-foreground">Tap to close</span>
          </div>
        </button>
      )}
    </div>
  );
}

function PickView({ ctx }: { ctx: Ctx }) {
  const { state, me, split, setTab, toggleClaim, notify } = ctx;
  const items = [...state.items].sort((a, b) => a.position - b.position);
  const mine = me ? share(ctx, me.id) : null;
  const hint = lockHint(ctx);

  const toggle = async (itemId: string) => {
    if (!me) return;
    if (state.bill.status !== "claiming") { notify("The bill's locked"); return; }
    const r = await toggleClaim(itemId, me.id);
    if (r === "locked") notify("The bill's locked");
  };

  return (
    <>
      {state.bill.mode === "items" && (
        <>
          <WhoHad ctx={ctx} />
          {me && state.bill.status === "claiming" && <SayWhatYouHad ctx={ctx} />}
          <p className="text-sm text-muted-foreground">{me ? "Tap everything you had. Shared? Tap it too — we'll divide it." : "👀 Just watching."}</p>
          <div className="flex flex-col gap-2">
            {items.map((it) => {
              const claimers = [...new Set(state.claims.filter((c) => c.item_id === it.id).map((c) => c.guest_id))];
              const isMine = Boolean(me && claimers.includes(me.id));
              const myPart = isMine && me ? allocate(it.price_pence, Object.fromEntries(claimers.map((g) => [g, 1])))[me.id] ?? 0 : 0;
              return (
                <button key={it.id} onClick={() => void toggle(it.id)}
                  className={cn("receipt flex min-h-18 items-center gap-3 p-4 text-left transition",
                    isMine ? "border-2 border-claimed bg-claimed-soft" : claimers.length === 0 ? "border-2 border-unclaimed/60" : "")}>
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold",
                    isMine ? "border-claimed bg-claimed text-primary-foreground" : "border-input")}>{isMine ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{it.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {claimers.length === 0 && <span className="animate-unclaimed rounded-full bg-unclaimed px-2 text-xs font-semibold text-primary-foreground">unclaimed</span>}
                      {claimers.map((gid) => { const g = state.guests.find((x) => x.id === gid); return g ? <Avatar key={gid} g={g} size="sm" /> : null; })}
                      {claimers.length > 1 && <span className="font-mono text-xs text-muted-foreground">÷ {claimers.length}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money p={formatGBP(it.price_pence)} className={cn("block", isMine && claimers.length > 1 && "text-xs text-muted-foreground line-through")} />
                    {isMine && claimers.length > 1 && <Money p={formatGBP(myPart)} className="font-bold" />}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {state.bill.mode === "even" && (
        <div className="receipt p-6 text-center">
          <p className="text-sm text-muted-foreground">Split evenly between {state.guests.length}</p>
          <p className="font-mono text-5xl font-bold">{formatGBP(mine?.total_pence ?? split.perGuest[0]?.total_pence ?? 0)}</p>
          <p className="text-sm">each</p>
        </div>
      )}
      {state.bill.mode === "wheel" && <WheelView ctx={ctx} />}

      <div className="sticky-footer"><div className="receipt mx-auto flex max-w-lg items-center justify-between gap-2 p-3">
        <div className="min-w-0 pl-1">
          <p className="text-xs text-muted-foreground">Your share{mine && mine.service_pence > 0 ? ` · incl. ${formatGBP(mine.service_pence)} service` : ""}</p>
          <Money p={formatGBP(mine?.total_pence ?? 0)} className="text-2xl font-bold" />
        </div>
        <div className="flex shrink-0 gap-2">
          <LockButton ctx={ctx} />
          <Btn onClick={() => setTab("table")} className="px-5">Continue →</Btn>
        </div>
      </div>
      {hint && <p className="animate-unclaimed mx-auto max-w-lg pt-1 text-center text-sm font-semibold text-unclaimed">{hint}</p>}
    </div>
    </>
  );
}

type Recognition = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type RecognitionCtor = new () => Recognition;

function SayWhatYouHad({ ctx }: { ctx: Ctx }) {
  const { state, me, toggleClaim, notify } = ctx;
  const match = useServerFn(matchClaims);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [listening, setListening] = useState(false);
  const [Ctor, setCtor] = useState<RecognitionCtor | null>(null);
  const recRef = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setCtor(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null);
  }, []);
  if (!me) return null;

  const mic = () => {
    if (!Ctor) return;
    if (listening) { recRef.current?.stop(); return; }
    const r = new Ctor();
    r.lang = "en-GB"; r.interimResults = false;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" "); setText((p) => (p ? `${p} ${t}` : t)); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  };

  const tick = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setResult("");
    const fail = "Couldn't work that out, just tap your items.";
    try {
      const items = [...state.items].sort((a, b) => a.position - b.position).map((i) => ({
        id: i.id, name: i.name, price_pence: i.price_pence,
        claimed_by: new Set(state.claims.filter((c) => c.item_id === i.id).map((c) => c.guest_id)).size,
      }));
      const { item_ids } = await match({ data: { text, items } });
      if (!item_ids.length) { setResult(fail); return; }
      const todo = item_ids.filter((id) => !state.claims.some((c) => c.item_id === id && c.guest_id === me.id));
      const res = await Promise.all(todo.map((id) => toggleClaim(id, me.id)));
      if (res.includes("locked")) { notify("The bill's locked"); return; }
      setResult(`Ticked: ${item_ids.map((id) => state.items.find((i) => i.id === id)?.name).filter(Boolean).join(", ")}`);
    } catch (e) {
      console.error(e);
      setResult(fail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="receipt p-3">
      <p className="mb-2 font-display">Say what you had</p>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void tick()}
          placeholder="e.g. the lamb and half the naan" aria-label="Say what you had"
          className="min-h-12 w-full min-w-0 rounded-xl border-2 border-input bg-background px-3 outline-none focus:border-primary" />
        {Ctor && (
          <button onClick={mic} aria-label="Speak" className={cn("h-12 w-12 shrink-0 rounded-xl border-2 text-xl", listening ? "animate-pulse border-primary bg-accent" : "border-input")}>🎤</button>
        )}
      </div>
      <Btn className="mt-2 w-full" disabled={busy || !text.trim()} onClick={() => void tick()}>{busy ? "Ticking…" : "Tick them"}</Btn>
      {result && <p className="mt-2 text-sm font-semibold">{result}</p>}
    </div>
  );
}

function WhoHad({ ctx }: { ctx: Ctx }) {
  const { state, split } = ctx;
  if (state.bill.mode !== "items" || state.bill.status !== "claiming") return null;
  if (split.unclaimed.length < 1 || split.unclaimed.length > 2) return null;
  return (
    <>
      {split.unclaimed.map((u) => (
        <p key={u.id} className="animate-unclaimed rounded-xl border-2 border-unclaimed bg-unclaimed-soft p-3 text-center font-display">
          Who had the {state.items.find((i) => i.id === u.id)?.name}? 👀
        </p>
      ))}
    </>
  );
}

function setInWheel(ctx: Ctx, id: string, inWheel: boolean) {
  void ctx.mutate((s) => ({ ...s, guests: s.guests.map((g) => (g.id === id ? { ...g, in_wheel: inWheel } : g)) }),
    async () => { rows(await supabase.from("guests").update({ in_wheel: inWheel }).eq("id", id)); });
}

function WheelView({ ctx }: { ctx: Ctx }) {
  const { state, me, mutate, split } = ctx;
  const bill = state.bill;
  const order = wheelOrder(state.guests.filter((g) => g.in_wheel).map((g) => g.id));
  const players = order.map((id) => state.guests.find((g) => g.id === id)!).filter(Boolean);
  const winner = bill.wheel_winner_id;
  const { rotation, animating, done } = useWheelSpin(winner, order);
  const w = state.guests.find((g) => g.id === winner);
  const host = hostOf(state);
  const isHost = Boolean(me?.is_host);
  const out = state.guests.length - players.length;

  const spin = () => {
    if (order.length < 2) return;
    const id = pickWinner(wheelOrder(order));
    const patch = { wheel_winner_id: id, wheel_spun_at: now() };
    void mutate((s) => ({ ...s, bill: { ...s.bill, ...patch } }),
      async () => { rows(await supabase.from("bills").update(patch).eq("id", bill.id)); });
  };
  const choosePayTo = (to: "waiter" | "host") => {
    const settle = to === "waiter" || winner === host?.id;
    const patch = { wheel_pay_to: to, status: settle ? "settled" as const : "locked" as const, settled_at: settle ? now() : null };
    void mutate((s) => ({ ...s, bill: { ...s.bill, ...patch } }),
      async () => { rows(await supabase.from("bills").update(patch).eq("id", bill.id)); });
  };

  const subline = bill.status === "settled"
    ? <>{bill.wheel_pay_to === "waiter" ? "to the waiter" : `to ${host?.name ?? "the host"}`} · <span className="font-bold text-claimed">Settled ✅</span></>
    : bill.status === "locked" ? <>{`back to ${host?.name ?? "the host"}`}</> : null;

  return (
    <>
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Spin for it</p>
        <h2 className="text-2xl"><Money p={formatGBP(split.billTotal)} /> · one person pays</h2>
        <p className="text-sm text-muted-foreground">{players.length} on the wheel · {out ? `${out} sat out` : "nobody sat out"}</p>
      </div>
      <Wheel players={players} rotation={rotation} animating={animating} done={done} size="min(84vw, 380px, 55vh)"
        result={w && (
          <div className="w-full rounded-2xl border-2 border-foreground bg-card p-4 text-center">
            <p className="font-display text-2xl">🎉 {w.name} pays <Money p={formatGBP(split.billTotal)} /></p>
            {subline && <p className="mt-1 text-sm text-muted-foreground">{subline}</p>}
          </div>
        )} />

      {winner && done && isHost && bill.status === "claiming" && (
        <div className="receipt p-4">
          <p className="mb-2 font-semibold">Who does {w?.name} pay?</p>
          <div className="flex gap-2">
            <Btn variant="outline" className="flex-1" onClick={() => choosePayTo("waiter")}>The waiter</Btn>
            <Btn className="flex-1" onClick={() => choosePayTo("host")}>Me (I paid)</Btn>
          </div>
        </div>
      )}
      {winner && done && bill.status === "locked" && me && me.id === winner && !me.is_host && <PayView ctx={ctx} />}
      {winner && done && bill.status === "locked" && isHost && <TrackView ctx={ctx} />}
      {winner && done && bill.status === "settled" && (
        <><PaidSummary state={ctx.state} split={ctx.split} /><Awards state={ctx.state} split={ctx.split} /></>
      )}

      {!winner && isHost && state.guests.some((g) => !g.has_phone) && (
        <div className="receipt divide-y divide-dashed">
          {state.guests.filter((g) => !g.has_phone).map((g) => (
            <label key={g.id} className="flex min-h-14 items-center gap-3 px-4">
              <Avatar g={g} /><span className="min-w-0 flex-1 truncate font-semibold">{g.name}</span>
              <input type="checkbox" className="h-6 w-6 accent-primary" checked={g.in_wheel} onChange={(e) => setInWheel(ctx, g.id, e.target.checked)} />
            </label>
          ))}
        </div>
      )}
      {!winner && me && (
        <div className="sticky-footer"><div className="mx-auto flex max-w-lg flex-col gap-2">
          {isHost && (
            <Btn className="min-h-14 w-full text-lg" disabled={order.length < 2} onClick={spin}>
              {order.length < 2 ? "Need 2 on the wheel" : "Spin 🎡"}
            </Btn>
          )}
          <button onClick={() => setInWheel(ctx, me.id, !me.in_wheel)}
            className={cn("min-h-16 w-full rounded-2xl border-2 font-display text-lg",
              me.in_wheel ? "border-input bg-card text-muted-foreground" : "border-foreground bg-foreground text-background")}>
            {me.in_wheel ? "Sit this one out" : "Sitting out · tap to rejoin"}
          </button>
        </div></div>
      )}
    </>
  );
}

function GuestCard({ ctx, g, you }: { ctx: Ctx; g: GuestRow; you?: boolean }) {
  const { state } = ctx;
  const s = share(ctx, g.id);
  const theirs = state.items.filter((i) => state.claims.some((c) => c.item_id === i.id && c.guest_id === g.id));
  return (
    <div className={cn("receipt p-4", you && "border-2 border-primary")}>
      <div className="flex items-center gap-3">
        <Avatar g={g} />
        <span className="min-w-0 flex-1 truncate font-display">{you ? `You · ${g.name}` : g.name}{g.is_host && " 👑"}</span>
        <Money p={formatGBP(s.total_pence)} className="shrink-0 text-lg font-bold" />
      </div>
      {state.bill.mode === "items" && theirs.length > 0 && (
        <>
          <div className="rule-dashed my-3" />
          <ul className="space-y-1 text-sm">
            {theirs.map((i) => {
              const cl = [...new Set(state.claims.filter((c) => c.item_id === i.id).map((c) => c.guest_id))];
              return <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{i.name}{cl.length > 1 && <span className="font-mono text-muted-foreground"> ÷ {cl.length}</span>}</span><Money p={formatGBP(allocate(i.price_pence, Object.fromEntries(cl.map((x) => [x, 1])))[g.id] ?? 0)} /></li>;
            })}
            {s.service_pence > 0 && <li className="flex justify-between text-muted-foreground"><span>Service</span><Money p={formatGBP(s.service_pence)} /></li>}
          </ul>
        </>
      )}
    </div>
  );
}

function TableView({ ctx }: { ctx: Ctx }) {
  const { state, me, split, setTab } = ctx;
  const [open, setOpen] = useState(false);
  const unclaimedTotal = split.unclaimed.reduce((s, i) => s + i.price_pence, 0);
  const others = activeGuests(state).filter((g) => g.id !== me?.id);
  const claiming = state.bill.status === "claiming";
  const even = state.bill.mode === "even";
  const hint = lockHint(ctx);
  return (
    <>
      {even && (
        <div className="rounded-full bg-primary px-5 py-3 text-center font-display text-primary-foreground">
          <Money p={formatGBP(split.perGuest[0]?.total_pence ?? 0)} /> each × {split.perGuest.length}
        </div>
      )}
      <WhoHad ctx={ctx} />
      {!even && split.unclaimed.length > 0 && (
        <div>
          <button onClick={() => setOpen(!open)} className="animate-unclaimed flex min-h-12 w-full items-center justify-between rounded-full bg-unclaimed px-5 font-semibold text-primary-foreground">
            <span>{split.unclaimed.length} unclaimed · <Money p={formatGBP(unclaimedTotal)} /></span><span>{open ? "▲" : "▼"}</span>
          </button>
          {open && (
            <ul className="receipt mt-2 divide-y divide-dashed px-4">
              {split.unclaimed.map((i) => <li key={i.id} className="flex min-h-11 items-center justify-between"><span>{state.items.find((x) => x.id === i.id)?.name}</span><Money p={formatGBP(i.price_pence)} /></li>)}
            </ul>
          )}
        </div>
      )}
      {me && <GuestCard ctx={ctx} g={me} you />}
      {others.map((g) => <GuestCard key={g.id} ctx={ctx} g={g} />)}
      {!claiming && <Awards state={ctx.state} split={ctx.split} />}
      <div className="receipt flex justify-between p-4 font-semibold">
        <span>Claimed</span><span className="font-mono">{formatGBP(split.claimedTotal)} / {formatGBP(split.billTotal)}</span>
      </div>
      {claiming && (
        <div className="sticky-footer"><div className="mx-auto flex max-w-lg gap-2">
          {!even && <Btn variant="outline" className="flex-1" onClick={() => setTab("pick")}>← Edit my items</Btn>}
          <LockButton ctx={ctx} />
        </div>
        {hint && <p className="animate-unclaimed mx-auto max-w-lg pt-1 text-center text-sm font-semibold text-unclaimed">{hint}</p>}</div>
      )}
    </>
  );
}

function CardPay({ ctx, pence }: { ctx: Ctx; pence: number }) {
  const check = useServerFn(cardPaymentsAvailable);
  const create = useServerFn(createGuestCheckout);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { check().then((r) => setOk(r.ok)).catch(() => setOk(false)); }, []);
  if (!ok || !ctx.me || pence <= 0 || ctx.me.paid_at) return null;
  const go = async () => {
    setBusy(true);
    try { const { url } = await create({ data: { code: ctx.state.bill.code, guest_id: ctx.me!.id, origin: window.location.origin } }); openStripeUrl(url); }
    catch { ctx.notify("Card payment isn't available right now"); setBusy(false); }
  };
  return (
    <Btn className="w-full" disabled={busy} onClick={() => void go()}>
      {busy ? "Opening checkout…" : `Pay ${formatGBP(pence)} by card / Apple Pay`}
    </Btn>
  );
}

function PayView({ ctx }: { ctx: Ctx }) {
  const { state, me } = ctx;
  const host = hostOf(state);
  const hostName = state.bill.host_name ?? host?.name ?? "the host";
  if (!me) return null;
  const s = share(ctx, me.id);
  // YouMustPay: if the hold was smaller than the share, the hold was charged and only the rest is still owed.
  const covered = me.payment_status === "captured" && !me.paid_at ? Math.min(s.total_pence, state.bill.hold_amount_pence ?? 0) : 0;
  const due = s.total_pence - covered;
  const amount = (due / 100).toFixed(2);
  const note = `${state.bill.restaurant_name} · Settld`;
  const row = "flex min-h-16 items-center justify-between gap-3 px-4";
  const showBank = state.bill.status !== "claiming" && state.bill.host_sort_code && state.bill.host_account_number;
  return (
    <>
      <div className="receipt p-5">
        <p className="text-muted-foreground">You owe {hostName}</p>
        <p className="font-mono text-5xl font-bold">{formatGBP(due)}</p>
        <div className="rule-dashed my-4" />
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>Food & drink</span><Money p={formatGBP(s.food_pence)} /></div>
          <div className="flex justify-between"><span>Service</span><Money p={formatGBP(s.service_pence)} /></div>
          {covered > 0 && <div className="flex justify-between"><span>Card hold charged 🔒</span><Money p={`−${formatGBP(covered)}`} /></div>}
        </div>
      </div>
      <CardPay ctx={ctx} pence={due} />
      <div className="receipt divide-y divide-dashed">
        {state.bill.host_monzo && (
          <div className={row}><span className="min-w-0"><span className="block font-semibold">Monzo</span><span className="truncate font-mono text-xs text-muted-foreground">@{state.bill.host_monzo}</span></span>
            <a href={monzoLink(state.bill.host_monzo, due, note)} target="_blank" rel="noreferrer" className="min-h-10 shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Open ↗</a></div>
        )}
        {state.bill.host_revolut && (
          <div className={row}><span className="min-w-0"><span className="block font-semibold">Revolut</span><span className="truncate font-mono text-xs text-muted-foreground">@{state.bill.host_revolut}</span></span>
            <a href={`https://revolut.me/${encodeURIComponent(state.bill.host_revolut)}`} target="_blank" rel="noreferrer" className="min-h-10 shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Open ↗</a></div>
        )}
        <div className={row}><span className="font-semibold">Copy amount</span><span className="flex items-center gap-2"><Money p={amount} /><CopyBtn text={amount} /></span></div>
        {showBank && (
          <div className="px-4 py-3">
            <p className="font-semibold">Bank transfer</p>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-sm">Sort code <Money p={state.bill.host_sort_code!} /></span><CopyBtn text={state.bill.host_sort_code!} /></div>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-sm">Account <Money p={state.bill.host_account_number!} /></span><CopyBtn text={state.bill.host_account_number!} /></div>
            {(() => { const ref = `Settld ${state.bill.code} ${me.name}`.slice(0, 18).trim(); return (
              <div className="mt-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm">Reference <Money p={ref} /></span><CopyBtn text={ref} /></div>); })()}
          </div>
        )}
      </div>
      <Awards state={ctx.state} split={ctx.split} />
      <div className="sticky-footer"><div className="mx-auto flex max-w-lg gap-2">
        {me.paid_at ? (
          <Btn variant="claimed" className="flex-1" onClick={() => setPaid(ctx, me.id, false)}>✓ Paid · undo</Btn>
        ) : (
          <Btn variant="ink" className="flex-1" onClick={() => setPaid(ctx, me.id, true)}>I've paid</Btn>
        )}
      </div></div>
    </>
  );
}

function TrackView({ ctx }: { ctx: Ctx }) {
  const { state, url, split } = ctx;
  const list = activeGuests(state).filter((g) => !g.is_host && (state.bill.mode !== "wheel" || share(ctx, g.id).total_pence > 0));
  const back = list.filter((g) => g.paid_at).reduce((s, g) => s + share(ctx, g.id).total_pence, 0);
  const owed = list.reduce((s, g) => s + share(ctx, g.id).total_pence, 0);
  const hold = state.bill.hold_amount_pence ?? 0;
  // What's still owed outside the card: held → nothing yet (charged on Lock); captured → share beyond the hold.
  const remainder = (g: GuestRow) => {
    const t = share(ctx, g.id).total_pence;
    if (g.payment_status === "held") return 0;
    if (g.payment_status === "captured" && !g.paid_at) return Math.max(0, t - Math.min(t, hold));
    return t;
  };
  const unpaid = list.filter((g) => !g.paid_at && remainder(g) > 0);
  const capture = useServerFn(captureShares);
  const [charging, setCharging] = useState(false);
  const held = state.guests.filter((g) => g.payment_status === "held");
  const chargeAll = async () => {
    setCharging(true);
    try {
      const r = await capture({ data: { code: state.bill.code } });
      ctx.notify(`Charged ${r.charged + r.partial}${r.partial ? ` · ${r.partial} still owe the rest` : ""}${r.failed ? ` · ${r.failed} failed` : ""}`);
    } catch { ctx.notify("Couldn't charge, try again"); }
    setCharging(false);
  };
  const chaseAll = `Still owed for ${state.bill.restaurant_name} 🧾 ${unpaid.map((g) => `${g.name} ${formatGBP(remainder(g))}`).join(" · ")}, pay here: ${url}`;
  return (
    <>
      {state.bill.youmustpay && held.length > 0 && (
        <Btn className="min-h-14 w-full" disabled={charging} onClick={() => void chargeAll()}>
          {charging ? "Charging…" : `Charge everyone 💳 (${held.length})`}
        </Btn>
      )}
      {unpaid.length > 0 && (
        <a href={`https://wa.me/?text=${encodeURIComponent(chaseAll)}`} target="_blank" rel="noreferrer"
          className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-foreground font-semibold text-background">Chase on WhatsApp ({unpaid.length})</a>
      )}
      <div className="receipt p-4">
        <div className="flex justify-between font-semibold"><span>Paid back</span><Money p={`${formatGBP(back)} of ${formatGBP(owed)}`} /></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-claimed" style={{ width: `${owed ? (back / owed) * 100 : 0}%` }} /></div>
        {split.unclaimed.length > 0 && <p className="mt-2 text-sm font-semibold text-unclaimed">{split.unclaimed.length} items still unclaimed</p>}
      </div>
      <div className="receipt divide-y divide-dashed">
        {list.map((g) => {
          const t = share(ctx, g.id).total_pence;
          const rem = remainder(g);
          const isHeld = g.payment_status === "held";
          const partly = g.payment_status === "captured" && !g.paid_at;
          const msg = `Hey ${g.name}! You owe ${formatGBP(rem)} for ${state.bill.restaurant_name}. Pay here: ${url}`;
          return (
            <div key={g.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-3">
                <Avatar g={g} />
                <span className="min-w-0 flex-1 truncate font-semibold">{g.name}{g.payment_status === "held" && " 🔒"}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", g.paid_at ? "bg-claimed-soft" : "bg-warning-soft")}>{g.paid_at ? paidLabel(g) : isHeld ? "🔒 card hold, charges on Lock" : partly ? `Card charged ${formatGBP(Math.min(t, hold))} · ${formatGBP(rem)} still owed` : "owes ⏳"}</span>
                <Money p={formatGBP(t)} className="shrink-0 font-bold" />
              </div>
              {!isHeld && !(g.paid_at && g.paid_via === "stripe") && <div className="flex gap-2">
                {g.paid_at ? <Btn variant="outline" className="flex-1" onClick={() => setPaid(ctx, g.id, false)}>Undo</Btn>
                  : <Btn variant="claimed" className="flex-1" onClick={() => setPaid(ctx, g.id, true, "host")}>Mark paid</Btn>}
                {!g.paid_at && <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border-2 border-foreground font-semibold">Chase on WhatsApp</a>}
              </div>}
            </div>
          );
        })}
      </div>
      <Awards state={ctx.state} split={ctx.split} />
    </>
  );
}

function WhoView({ ctx, pick }: { ctx: Ctx; pick: (id: string) => void }) {
  const list = ctx.state.guests.filter((g) => !g.is_host && !g.paid_at && g.has_phone);
  return (
    <>
      <h2 className="text-3xl">Who are you?</h2>
      <Btn variant="outline" className="min-h-14 w-full" onClick={() => pick(WATCH)}>Just watching 👀</Btn>
      <div className="flex flex-col gap-2">
        {list.map((g) => (
          <button key={g.id} onClick={() => pick(g.id)} className="receipt flex min-h-16 items-center gap-3 px-4 text-left">
            <Avatar g={g} /><span className="font-semibold">{g.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function SettledView({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <Confetti />
      <div className="receipt mt-8 p-8 text-center">
        <p className="text-7xl">✅</p>
        <h2 className="mt-4 text-4xl">Settled</h2>
        <p className="mt-2 text-muted-foreground">Everyone's square for {ctx.state.bill.restaurant_name}.</p>
        <Link to="/" className="mt-6 inline-block font-semibold text-primary">← Home</Link>
      </div>
      <PaidSummary state={ctx.state} split={ctx.split} />
      <Awards state={ctx.state} split={ctx.split} />
    </>
  );
}

const SIM_GUESTS: [string, string][] = [["Priya", "🌶️"], ["Tom", "🍟"], ["Sam", "🥟"], ["Jess", "🍩"]];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function SimulateTable({ state }: { state: TableState }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const at = now();
      const guests = SIM_GUESTS.map(([name, emoji], i) => ({
        ...newGuest(state.bill.id, state.guests), name, emoji,
        color: ["oklch(0.86 0.09 27)", "oklch(0.88 0.1 70)", "oklch(0.87 0.08 200)", "oklch(0.86 0.09 320)"][i]!, created_at: at,
      }));
      rows(await supabase.from("guests").insert(guests));
      const claimed = new Set(state.claims.map((c) => c.item_id));
      const free = state.items.map((i) => i.id).filter((id) => !claimed.has(id)).sort(() => Math.random() - 0.5);
      for (const g of guests) {
        const n = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < n && free.length; k++) {
          await sleep(1000 + Math.random() * 1000);
          const item_id = free.shift()!;
          rows(await supabase.from("claims").insert({ id: crypto.randomUUID(), bill_id: state.bill.id, item_id, guest_id: g.id, created_at: now() }));
        }
      }
      setDone(true);
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };
  if (done) return null;
  return (
    <Btn variant="outline" className="w-full" disabled={running} onClick={() => void run()}>
      {running ? "Simulating…" : "🎭 Simulate table"}
    </Btn>
  );
}
