import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Btn, Money } from "@/components/kit";
import { cn } from "@/lib/utils";
import { DISHOOM_ITEMS, GUEST_COLORS, randomCode, type TableState } from "@/lib/mock";
import { computeSplit, formatGBP } from "@/lib/split";
import { addRecent, rows as dbRows } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { parseReceipt } from "@/lib/receipt.functions";
import { getTonight, resizeToDataURL, saveTonight, toUnitRows, withTimeout } from "@/lib/receipt-photos";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "Start a table — Settld" },
      { name: "description", content: "Add your receipt, check the total and open a table for your friends." },
      { property: "og:title", content: "Start a table — Settld" },
      { property: "og:description", content: "Add your receipt, check the total and open a table for your friends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewTable,
});

type Row = { key: string; name: string; price: string };
type Host = { name: string; monzo: string; revolut: string; sort: string; account: string; stripe_account_id?: string };
const emptyHost: Host = { name: "", monzo: "", revolut: "", sort: "", account: "" };

export const cleanHandle = (v: string) =>
  v.replace(/\s+/g, "").replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?(monzo|revolut)\.me\//i, "").replace(/^@/, "");
const toPence = (v: string) => { const n = Number.parseFloat(v.replace(/[£,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const toPounds = (p: number) => (p / 100).toFixed(2);

function NewTable() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [restaurant, setRestaurant] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [receiptTotal, setReceiptTotal] = useState("");
  const [svcMode, setSvcMode] = useState<"none" | "add" | "included">("none");
  const [svcIncluded, setSvcIncluded] = useState("");
  const [host, setHost] = useState<Host>(emptyHost);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ymp, setYmp] = useState(false);
  const [savedStripe, setSavedStripe] = useState<string | null>(null);
  const [holdStr, setHoldStr] = useState("40.00");
  const holdPence = toPence(holdStr);
  const holdOk = holdPence >= 500 && holdPence <= 50000;
  const [holdCustom, setHoldCustom] = useState(false);
  const isPreset = (p: number) => !holdCustom && holdPence === p;

  useEffect(() => {
    try { const h = localStorage.getItem("tabsplit:host"); if (h) setHost({ ...emptyHost, ...(JSON.parse(h) as Host) }); } catch { /* ignore */ }
    try { setSavedStripe(localStorage.getItem("tabsplit:host_stripe")); } catch { /* ignore */ }
  }, []);

  const useDemo = () => {
    setRestaurant("Dishoom Kensington");
    setRows(DISHOOM_ITEMS.map(([name, p], i) => ({ key: `d${i}`, name, price: toPounds(p) })));
    setReceiptTotal("74.93"); setSvcMode("included"); setSvcIncluded("8.33"); setStep(2);
  };
  const typeIn = () => { setRows([{ key: crypto.randomUUID(), name: "", price: "" }]); setStep(2); };

  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [tonight, setTonight] = useState<string[]>([]);
  useEffect(() => setTonight(getTonight()), []);
  const parse = useServerFn(parseReceipt);

  const sendImages = async (images: string[]) => {
    if (reading || !images.length) return;
    setReading(true); setReadError("");
    try {
      const p = await withTimeout(parse({ data: { images: images.slice(0, 4) } }));
      const units = toUnitRows(p);
      setRestaurant(p.restaurant_name || "");
      setRows(units.length ? units.map((u) => ({ key: crypto.randomUUID(), name: u.name, price: toPounds(u.price_pence) }))
        : [{ key: crypto.randomUUID(), name: "", price: "" }]);
      const svc = p.service_charge_pence ?? 0;
      if (svc > 0) { setSvcMode("included"); setSvcIncluded(toPounds(svc)); } else { setSvcMode("add"); setSvcIncluded(""); }
      setReceiptTotal(p.receipt_total_pence != null ? toPounds(p.receipt_total_pence) : "");
      const disc = p.discount_pence ?? 0;
      setDiscountNote(disc > 0 ? `Receipt has a ${formatGBP(disc)} discount: edit prices to apply it.` : "");
      setStep(2);
    } catch (e) {
      console.error(e);
      setReadError("Couldn't read that one. Type it in or use the demo receipt.");
    } finally {
      setReading(false);
    }
  };
  const readPhotos = async (files: File[]) => sendImages(await Promise.all(files.slice(0, 4).map((f) => resizeToDataURL(f, 1600))));

  const items = rows.map((r) => ({ id: r.key, price_pence: toPence(r.price) }));
  const counted = useMemo(
    () => computeSplit(items, [], [], { mode: svcMode, rate: 0.125, included_pence: toPence(svcIncluded) }).billTotal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, svcMode, svcIncluded],
  );
  const says = toPence(receiptTotal);
  const matches = says > 0 && says === counted;

  const open = async () => {
    if (saving) return;
    if (ymp && !holdOk) { setError("Card hold must be £5 to £500."); return; }
    setError("");
    const h: Host = { ...host, monzo: cleanHandle(host.monzo), revolut: cleanHandle(host.revolut) };
    localStorage.setItem("tabsplit:host", JSON.stringify(h));
    let code = randomCode(); const billId = crypto.randomUUID(); const receiptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const state: TableState = {
      bill: {
        id: billId, code, restaurant_name: restaurant || "Dinner", mode: "items", status: "claiming",
        host_name: h.name || null, host_monzo: h.monzo || null, host_revolut: h.revolut || null,
        host_sort_code: h.sort || null, host_account_number: h.account || null,
        wheel_winner_id: null, wheel_spun_at: null, wheel_pay_to: "host", settled_at: null, created_at: now,
        ...(ymp ? { youmustpay: true, hold_amount_pence: holdPence, ...((savedStripe ?? h.stripe_account_id) ? { host_stripe_account_id: savedStripe ?? h.stripe_account_id } : {}) } : {}),
      },
      receipts: [{
        id: receiptId, bill_id: billId, label: "Receipt 1", position: 0, service_mode: svcMode, service_rate: 0.125,
        service_included_pence: svcMode === "included" ? toPence(svcIncluded) : 0, receipt_total_pence: says || null, discount_pence: null,
      }],
      items: rows.filter((r) => r.name.trim()).map((r, i) => ({
        id: crypto.randomUUID(), bill_id: billId, receipt_id: receiptId, name: r.name.trim(), price_pence: toPence(r.price), position: i,
      })),
      guests: [{
        id: crypto.randomUUID(), bill_id: billId, name: h.name || "Host", emoji: "😎", color: GUEST_COLORS[1]!,
        is_host: true, has_phone: true, in_wheel: true, paid_at: null, created_at: now,
      }],
      claims: [],
    };
    setSaving(true);
    try {
      // Retry the code until it's free.
      let free = false;
      for (let i = 0; i < 10 && !free; i++) {
        const taken = dbRows<{ id: string } | null>(await supabase.from("bills").select("id").eq("code", code).maybeSingle());
        if (taken) code = randomCode(); else free = true;
      }
      state.bill.code = code;
      dbRows(await supabase.from("bills").insert(state.bill));
      dbRows(await supabase.from("receipts").insert(state.receipts));
      if (state.items.length) dbRows(await supabase.from("items").insert(state.items));
      dbRows(await supabase.from("guests").insert(state.guests));
      localStorage.setItem(`tabsplit:guest:${code}`, state.guests[0]!.id);
      addRecent({ code, restaurant_name: state.bill.restaurant_name, created_at: now });
      void navigate({ to: "/t/$code", params: { code } });
    } catch (e) {
      console.error(e);
      setError("Couldn't open the table. Try again.");
      setSaving(false);
    }
  };

  const field = "min-h-12 w-full min-w-0 rounded-xl border-2 border-input bg-background px-3 outline-none focus:border-primary";

  return (
    <main className="phone-page flex flex-col gap-5">
      <header className="flex items-center justify-between pt-2">
        <button onClick={() => (step > 1 ? setStep(step - 1) : void navigate({ to: "/" }))} className="min-h-12 px-1 font-semibold">← Back</button>
        <span className="font-mono text-sm">STEP {step}/3</span>
      </header>
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => <span key={s} className={cn("h-1.5 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-secondary")} />)}
      </div>

      {step === 1 && (
        <>
          <h1 className="text-3xl">Add the receipt</h1>
          <button onClick={useDemo} className="receipt min-h-20 p-5 text-left">
            <span className="block font-display text-xl">🧾 Use demo receipt</span>
            <span className="text-sm text-muted-foreground">Dishoom Kensington · 8 items</span>
          </button>
          <button onClick={typeIn} className="receipt min-h-20 p-5 text-left">
            <span className="block font-display text-xl">⌨️ Type it in</span>
            <span className="text-sm text-muted-foreground">Add each line yourself</span>
          </button>
          {reading ? (
            <div className="receipt grid min-h-20 place-items-center p-5 font-display text-xl animate-pulse">Reading receipt…</div>
          ) : (
            <>
              <label className="receipt block min-h-20 cursor-pointer p-5">
                <span className="block font-display text-xl">📸 Add photos</span>
                <span className="text-sm text-muted-foreground">Up to 4 photos of one receipt</span>
                <input type="file" accept="image/*" multiple className="sr-only"
                  onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void readPhotos(f); }} />
              </label>
              <div className="receipt p-5">
                <span className="block font-display text-xl">🌙 Tonight's receipt</span>
                {tonight.length ? (
                  <>
                    <span className="text-sm text-muted-foreground">{tonight.length} saved photo{tonight.length > 1 ? "s" : ""}</span>
                    <Btn className="mt-3 w-full" onClick={() => void sendImages(tonight)}>Read saved photos</Btn>
                    <label className="mt-2 block cursor-pointer text-center text-sm font-semibold text-primary underline">
                      Change saved photos
                      <input type="file" accept="image/*" multiple className="sr-only"
                        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void saveTonight(f).then(setTonight); }} />
                    </label>
                  </>
                ) : (
                  <label className="mt-1 block cursor-pointer text-sm font-semibold text-primary underline">
                    Pick up to 4 photos to keep ready
                    <input type="file" accept="image/*" multiple className="sr-only"
                      onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void saveTonight(f).then(setTonight); }} />
                  </label>
                )}
              </div>
              {readError && <p className="rounded-xl bg-warning-soft p-3 text-sm font-semibold">{readError}</p>}
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="text-3xl">Check the items</h1>
          {discountNote && <p className="rounded-xl bg-warning-soft p-3 text-sm font-semibold">{discountNote}</p>}
          <input className={field} placeholder="Restaurant name" value={restaurant} onChange={(e) => setRestaurant(e.target.value)} />
          <div className="receipt p-3">
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-2 py-1">
                <input className={cn(field, "flex-1")} placeholder="Item" value={r.name}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className={cn(field, "w-24 shrink-0 text-right font-mono")} inputMode="decimal" placeholder="0.00" value={r.price}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button aria-label="Remove item" className="h-12 w-10 shrink-0 text-xl text-muted-foreground" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="mt-2 min-h-12 w-full rounded-xl border-2 border-dashed border-input font-semibold"
              onClick={() => setRows([...rows, { key: crypto.randomUUID(), name: "", price: "" }])}>+ Add item</button>
            <div className="rule-dashed my-4" />
            <p className="mb-2 font-semibold">Service charge</p>
            <div className="grid grid-cols-3 gap-2">
              {([["none", "None"], ["add", "Add 12.5%"], ["included", "Included"]] as const).map(([m, l]) => (
                <button key={m} onClick={() => setSvcMode(m)}
                  className={cn("min-h-12 rounded-xl border-2 text-sm font-semibold", svcMode === m ? "border-primary bg-accent" : "border-input")}>{l}</button>
              ))}
            </div>
            {svcMode === "included" && (
              <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm">Service on receipt</span>
                <input className={cn(field, "w-28 text-right font-mono")} inputMode="decimal" value={svcIncluded} onChange={(e) => setSvcIncluded(e.target.value)} placeholder="0.00" />
              </label>
            )}
            <label className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm">Receipt total</span>
              <input className={cn(field, "w-28 text-right font-mono")} inputMode="decimal" value={receiptTotal} onChange={(e) => setReceiptTotal(e.target.value)} placeholder="0.00" />
            </label>
            <div className="rule-dashed my-4" />
            <p className={cn("rounded-xl p-3 text-sm font-semibold", matches ? "bg-claimed-soft" : "bg-warning-soft")}>
              {matches ? "✓ " : "⚠️ "}Receipt says <Money p={formatGBP(says)} />, we count <Money p={formatGBP(counted)} /> (items + service)
            </p>
          </div>
          <div className="sticky-footer"><div className="mx-auto max-w-lg">
            <Btn className="w-full" onClick={() => setStep(3)} disabled={!rows.some((r) => r.name.trim())}>Next →</Btn>
          </div></div>
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="text-3xl">You</h1>
          <p className="-mt-3 text-sm text-muted-foreground">Saved on this phone for next time.</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How people pay">
            {([[false, "Pay yourselves", "Everyone pays you back by Monzo, Revolut or bank."],
              [true, "YouMustPay 🔒", `Everyone puts a ${formatGBP(holdOk ? holdPence : 4000)} card hold on to join. You charge each person's share at the end.`]] as const).map(([v, t, d]) => (
              <button key={t} role="radio" aria-checked={ymp === v} onClick={() => setYmp(v)}
                className={cn("receipt min-h-28 border-2 p-3 text-left", ymp === v ? "border-primary bg-accent" : "border-input")}>
                <span className="block font-display">{t}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{d}</span>
              </button>
            ))}
          </div>
          {ymp && (
            <div className="receipt p-4">
              <p className="font-display text-lg">Max card hold per person</p>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Max card hold per person">
                {([[2000, "£20"], [4000, "£40"], [6000, "£60"], [10000, "£100"]] as const).map(([p, l]) => (
                  <button key={p} role="radio" aria-checked={isPreset(p)}
                    onClick={() => { setHoldCustom(false); setHoldStr(toPounds(p)); }}
                    className={cn("min-h-12 rounded-xl border-2 px-4 font-mono font-semibold", isPreset(p) ? "border-primary bg-accent" : "border-input")}>{l}</button>
                ))}
                <button role="radio" aria-checked={holdCustom} onClick={() => setHoldCustom(true)}
                  className={cn("min-h-12 rounded-xl border-2 px-4 font-semibold", holdCustom ? "border-primary bg-accent" : "border-input")}>Custom</button>
              </div>
              {holdCustom && (
                <label className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Card hold per person (£)</span>
                  <input className={cn(field, "w-28 text-right font-mono", !holdOk && "border-destructive")} inputMode="decimal" value={holdStr}
                    onChange={(e) => setHoldStr(e.target.value)} onBlur={() => holdOk && setHoldStr(toPounds(holdPence))} />
                </label>
              )}
              <p className="mt-3 text-sm text-muted-foreground">Guests see this before joining. They're only charged their share.</p>
            </div>
          )}
          {ymp && <p className="text-sm text-muted-foreground">{savedStripe ? "Stripe connected ✅" : "You'll connect Stripe once"} · Payment links below are optional.</p>}
          <div className="receipt flex flex-col gap-3 p-4">
            <input className={field} placeholder="Your name" value={host.name} onChange={(e) => setHost({ ...host, name: e.target.value })} />
            <div className="rule-dashed" />
            <input className={field} placeholder="Monzo username" value={host.monzo} onChange={(e) => setHost({ ...host, monzo: e.target.value })} onBlur={() => setHost({ ...host, monzo: cleanHandle(host.monzo) })} />
            <input className={field} placeholder="Revolut username" value={host.revolut} onChange={(e) => setHost({ ...host, revolut: e.target.value })} onBlur={() => setHost({ ...host, revolut: cleanHandle(host.revolut) })} />
            <div className="rule-dashed" />
            <div className="flex gap-2">
              <input className={cn(field, "w-32 font-mono")} placeholder="Sort code" value={host.sort} onChange={(e) => setHost({ ...host, sort: e.target.value })} />
              <input className={cn(field, "flex-1 font-mono")} placeholder="Account number" inputMode="numeric" value={host.account} onChange={(e) => setHost({ ...host, account: e.target.value })} />
            </div>
          </div>
          <div className="sticky-footer"><div className="mx-auto max-w-lg">
            {error && <p className="mb-2 text-center text-sm font-semibold text-destructive">{error}</p>}
            <Btn className="w-full min-h-14 text-lg" onClick={() => void open()} disabled={saving}>{saving ? "Opening…" : "Open the table"}</Btn>
          </div></div>
        </>
      )}
    </main>
  );
}
