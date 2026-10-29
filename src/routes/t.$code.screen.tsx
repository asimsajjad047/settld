import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar, Confetti, Money } from "@/components/kit";
import { cn } from "@/lib/utils";
import { formatGBP, wheelOrder } from "@/lib/split";
import { Wheel, useWheelSpin } from "@/components/Wheel";
import { Awards } from "@/components/Awards";
import { PaidSummary } from "@/components/PaidSummary";
import { splitFor as splitOf } from "@/lib/store";
import { paidLabel, type TableState } from "@/lib/mock";
import { activeGuests, splitFor, useTable } from "@/lib/store";
import { useServerFn } from "@tanstack/react-start";
import { youMustPayActive } from "@/lib/stripe.functions";

export const Route = createFileRoute("/t/$code/screen")({
  head: ({ params }) => ({
    meta: [
      { title: `Big screen · ${params.code} — Settld` },
      { name: "description", content: "Live projector view of who had what and who has paid." },
      { property: "og:title", content: `Big screen · table ${params.code}` },
      { property: "og:description", content: "Live projector view of who had what and who has paid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Screen,
});

function Screen() {
  const code = Route.useParams().code.toUpperCase();
  const { state } = useTable(code);
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/t/${code}`), [code]);
  // Projector view must never scroll.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((e) => e.style.overflow);
    els.forEach((e) => (e.style.overflow = "hidden"));
    return () => els.forEach((e, i) => (e.style.overflow = prev[i] ?? ""));
  }, []);
  const ympCheck = useServerFn(youMustPayActive);
  const [ympReady, setYmpReady] = useState(false);
  const ympOn = Boolean(state?.bill.youmustpay);
  useEffect(() => {
    if (!ympOn) return;
    let live = true;
    ympCheck({ data: { code } }).then((r) => live && setYmpReady(r.active)).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ympOn, state?.bill.host_stripe_account_id, code]);
  if (!state) return <div className="h-screen overflow-hidden" />;

  const split = splitFor(state);
  const status = state.bill.status;
  const items = [...state.items].sort((a, b) => a.position - b.position);
  const unclaimedTotal = split.unclaimed.reduce((s, i) => s + i.price_pence, 0);
  const people = activeGuests(state);
  const owing = people.filter((g) => !g.is_host);
  const tot = (id: string) => split.perGuest.find((p) => p.guest_id === id)?.total_pence ?? 0;
  const owed = owing.reduce((s, g) => s + tot(g.id), 0);
  const back = owing.filter((g) => g.paid_at).reduce((s, g) => s + tot(g.id), 0);
  const bar = (v: number, of: number, label: string) => (
    <div>
      <div className="flex justify-between font-display text-[2.4vh]"><span>{label}</span><Money p={`${formatGBP(v)} of ${formatGBP(of)}`} /></div>
      <div className="mt-[0.8vh] h-[2vh] overflow-hidden rounded-full bg-secondary"><div className="h-full bg-claimed transition-all" style={{ width: `${of ? (v / of) * 100 : 0}%` }} /></div>
    </div>
  );

  return (
    <div className="fixed inset-0 grid grid-cols-[minmax(0,1fr)_32vh] grid-rows-[minmax(0,1fr)] gap-[3vh] overflow-hidden p-[3vh]">
      <section className="flex min-h-0 flex-col gap-[2vh] overflow-hidden">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="truncate text-[5vh] leading-none">{state.bill.restaurant_name}</h1>
          <Money p={formatGBP(split.billTotal)} className="text-[3.5vh] font-bold" />
        </header>

        {state.bill.mode === "wheel" ? (
          <ScreenWheel state={state} total={split.billTotal} />
        ) : status === "settled" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-[2vh]">
            <div className="receipt grid min-h-0 place-items-center"><Confetti />
              <div className="text-center"><p className="text-[14vh] leading-none">✅</p><h2 className="text-[10vh] leading-none">Settled</h2></div></div>
            <div className="flex min-h-0 flex-col gap-[2vh] overflow-hidden">
              <PaidSummary state={state} split={split} compact />
              <div className="min-h-0 overflow-hidden"><Awards state={state} split={split} compact /></div>
            </div>
          </div>
        ) : status === "locked" ? (
          <>
            <div className="receipt grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-[1.5vh] overflow-hidden p-[2vh]">
              {owing.map((g) => (
                <div key={g.id} className={cn("flex items-center gap-[1.5vh] rounded-xl px-[2vh]", g.paid_at ? "bg-claimed-soft" : "bg-warning-soft")}>
                  <Avatar g={g} size="lg" /><span className="min-w-0 flex-1 truncate font-display text-[3vh]">{g.name}{g.payment_status === "held" && " 🔒"}</span>
                  <Money p={formatGBP(tot(g.id))} className="text-[3vh] font-bold" /><span className="shrink-0 text-[2.2vh] font-semibold">{g.paid_at ? paidLabel(g) : "⏳"}</span>
                </div>
              ))}
            </div>
            {bar(back, owed, "Paid back")}
          </>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[2vh]">
              {state.bill.mode === "even" ? (
                <div className="receipt grid min-h-0 place-items-center p-[2vh] text-center">
                  <div><p className="font-mono text-[12vh] font-bold leading-none">{formatGBP(split.perGuest[0]?.total_pence ?? 0)}</p>
                    <p className="mt-[1vh] font-display text-[4vh]">each × {split.perGuest.length}</p></div>
                </div>
              ) : (
              <div className="receipt grid min-h-0 auto-rows-fr grid-cols-2 gap-[1vh] overflow-hidden p-[1.5vh]">
                {items.map((it) => {
                  const cl = [...new Set(state.claims.filter((c) => c.item_id === it.id).map((c) => c.guest_id))];
                  return (
                    <div key={it.id} className={cn("flex min-h-0 flex-col justify-center rounded-lg border-2 px-[1.5vh]", cl.length ? "border-claimed bg-claimed-soft" : "animate-unclaimed border-unclaimed bg-unclaimed-soft")}>
                      <div className="flex justify-between gap-2 text-[2vh] font-semibold"><span className="truncate">{it.name}</span><Money p={formatGBP(it.price_pence)} /></div>
                      <div className="mt-[0.5vh] flex gap-1">{cl.map((id) => { const g = state.guests.find((x) => x.id === id); return g ? <Avatar key={id} g={g} size="sm" /> : null; })}</div>
                    </div>
                  );
                })}
              </div>
              )}
              <div className="receipt flex min-h-0 flex-col gap-[1vh] overflow-hidden p-[2vh]">
                {people.map((g) => (
                  <div key={g.id} className="flex items-center gap-[1.5vh] text-[2.6vh]"><Avatar g={g} /><span className="min-w-0 flex-1 truncate font-semibold">{g.name}{g.payment_status === "held" && " 🔒"}</span><Money p={formatGBP(tot(g.id))} className="font-bold" /></div>
                ))}
                {state.bill.mode === "items" && split.unclaimed.length > 0 && (
                  <div className="animate-unclaimed mt-auto rounded-full bg-unclaimed px-[2vh] py-[1vh] text-center text-[2.4vh] font-semibold text-primary-foreground">
                    {split.unclaimed.length} unclaimed · <Money p={formatGBP(unclaimedTotal)} />
                  </div>
                )}
              </div>
            </div>
            {bar(split.claimedTotal, split.billTotal, "Claimed")}
          </>
        )}
      </section>

      <aside className="receipt flex min-h-0 flex-col overflow-hidden items-center justify-center gap-[2vh] p-[2vh]">
        {ympOn && !ympReady ? (
          <p className="text-center font-display text-[3.2vh] leading-tight">🔒 Waiting for host to connect Stripe</p>
        ) : (<>
        <p className="font-display text-[2.4vh]">Scan to join</p>
        <QRCodeSVG value={url || code} size={512} bgColor="transparent" fgColor="currentColor" className="h-auto max-h-[45vh] w-full" />
        </>)}
        <div className="rule-dashed w-full" />
        <p className="font-mono text-[11vh] font-bold leading-none tracking-wider">{code}</p>
        {ympOn && ympReady && <p className="text-center font-display text-[2.4vh]">🔒 {formatGBP(state.bill.hold_amount_pence ?? 4000)} card hold to join</p>}
      </aside>
    </div>
  );
}

function ScreenWheel({ state, total }: { state: TableState; total: number }) {
  const order = wheelOrder(state.guests.filter((g) => g.in_wheel).map((g) => g.id));
  const players = order.map((id) => state.guests.find((g) => g.id === id)!).filter(Boolean);
  const { rotation, animating, done } = useWheelSpin(state.bill.wheel_winner_id, order);
  const w = state.guests.find((g) => g.id === state.bill.wheel_winner_id);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-[4vh] overflow-hidden">
      <Wheel players={players} rotation={rotation} animating={animating} done={done} size="min(58vh, 45vw)" />
      <div className="w-[40%] text-center">
        {w && done ? (
          <div className="rounded-2xl border-4 border-foreground bg-card p-[3vh]">
            <p className="font-display text-[6vh] leading-tight">🎉 {w.name} pays <Money p={formatGBP(total)} /></p>
            {state.bill.status === "settled" && <p className="mt-[1vh] text-[3vh] font-bold text-claimed">Settled ✅</p>}
          </div>
        ) : (
          <p className="font-display text-[5vh]">{w ? "Spinning…" : `${players.length} on the wheel`}</p>
        )}
        {w && done && state.bill.status === "settled" && (
          <div className="mt-[2vh] max-h-[40vh] overflow-hidden text-left">
            <PaidSummary state={state} split={splitOf(state)} compact />
            <Awards state={state} split={splitOf(state)} compact />
          </div>
        )}
      </div>
    </div>
  );
}
