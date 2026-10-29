import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Btn } from "@/components/kit";
import { formatGBP } from "@/lib/split";
import { STRIPE_PUBLISHABLE_KEY } from "@/lib/stripe-config";
import { confirmHold, createHold } from "@/lib/stripe.functions";

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY));

/** YouMustPay: guest puts a card hold on before they can claim. Server confirms the hold, never the client. */
export function SecureSeat({ code, guestId, holdPence, onHeld }: { code: string; guestId: string; holdPence: number; onHeld: () => void }) {
  const create = useServerFn(createHold);
  const confirm = useServerFn(confirmHold);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    // Returning from a redirect (or a hold already placed): check with the server first.
    const params = new URLSearchParams(window.location.search);
    if (params.has("payment_intent")) {
      ["payment_intent", "payment_intent_client_secret", "redirect_status"].forEach((k) => params.delete(k));
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    confirm({ data: { code, guestId } })
      .then(async (r) => {
        if (!live) return;
        if (r.held) { onHeld(); return; }
        const h = await create({ data: { code, guestId } });
        if (live) setSecret(h.client_secret);
      })
      .catch(() => live && setErr("Couldn't start the card hold. Try again in a moment."));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, guestId]);

  return (
    <div className="receipt p-5">
      <h2 className="text-2xl">Secure your seat 🔒</h2>
      <p className="mt-1 text-muted-foreground">{formatGBP(holdPence)} hold — you'll only be charged your share</p>
      <div className="rule-dashed my-4" />
      {err ? <p className="text-sm font-semibold text-destructive">{err}</p>
        : !secret ? <p className="text-sm text-muted-foreground">Loading card options…</p>
        : (
          <Elements stripe={getStripe()} options={{ clientSecret: secret }}>
            <HoldForm code={code} guestId={guestId} onHeld={onHeld} />
          </Elements>
        )}
    </div>
  );
}

function HoldForm({ code, guestId, onHeld }: { code: string; guestId: string; onHeld: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const confirm = useServerFn(confirmHold);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr("");
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/t/${code}` },
    });
    if (error) { setErr(error.message ?? "Card declined"); setBusy(false); return; }
    try {
      const r = await confirm({ data: { code, guestId } });
      if (r.held) onHeld(); else setErr("Hold not confirmed yet. Try again.");
    } catch { setErr("Couldn't confirm the hold. Try again."); }
    setBusy(false);
  };

  const submitCard = async () => {
    if (!elements) return;
    const { error } = await elements.submit();
    if (error) { setErr(error.message ?? ""); return; }
    await run();
  };

  return (
    <div className="space-y-4">
      <ExpressCheckoutElement onConfirm={() => void run()} />
      <PaymentElement />
      {err && <p className="text-sm font-semibold text-destructive">{err}</p>}
      <Btn className="w-full" disabled={busy || !stripe} onClick={() => void submitCard()}>
        {busy ? "Placing hold…" : "Place hold 🔒"}
      </Btn>
    </div>
  );
}
