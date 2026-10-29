import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Bill, ClaimRow, GuestRow, ItemRow, ReceiptRow, TableState } from "./mock";
import { computeBill, computeEven, computeWheel, type SplitResult } from "./split";

/** The one typing helper: throws on error and casts rows to the shapes in mock.ts. */
export function rows<T>(r: { data: unknown; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

export async function fetchTable(code: string): Promise<TableState | null> {
  const bill = rows<Bill | null>(await supabase.from("bills").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!bill) return null;
  const [receipts, items, guests, claims] = await Promise.all([
    supabase.from("receipts").select("*").eq("bill_id", bill.id),
    supabase.from("items").select("*").eq("bill_id", bill.id),
    supabase.from("guests").select("*").eq("bill_id", bill.id).order("created_at"),
    supabase.from("claims").select("*").eq("bill_id", bill.id),
  ]);
  return {
    bill,
    receipts: rows<ReceiptRow[]>(receipts),
    items: rows<ItemRow[]>(items),
    guests: rows<GuestRow[]>(guests),
    claims: rows<ClaimRow[]>(claims),
  };
}

export type Recent = { code: string; restaurant_name: string; created_at: string };
export function getRecent(): Recent[] {
  try { return JSON.parse(localStorage.getItem("tabsplit:recent") ?? "[]") as Recent[]; } catch { return []; }
}
export function addRecent(r: Recent) {
  const list = [r, ...getRecent().filter((x) => x.code !== r.code)].slice(0, 8);
  localStorage.setItem("tabsplit:recent", JSON.stringify(list));
}

type Op = { kind: "add" | "remove"; claim: ClaimRow };
const opKey = (c: { item_id: string; guest_id: string }) => `${c.item_id}:${c.guest_id}`;

function applyOps(s: TableState, ops: Op[]): TableState {
  if (!ops.length) return s;
  let claims = s.claims;
  for (const op of ops) {
    claims = claims.filter((c) => opKey(c) !== opKey(op.claim));
    if (op.kind === "add") claims = [...claims, op.claim];
  }
  return { ...s, claims };
}

export function useTable(code: string) {
  const [server, setServer] = useState<TableState | null>(null);
  const [ready, setReady] = useState(false);
  const [ops, setOps] = useState<Op[]>([]);
  const reqId = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const s = await fetchTable(code);
      if (id !== reqId.current) return; // stale response
      setServer(s);
    } catch (e) {
      console.error(e);
    }
    if (id === reqId.current) setReady(true);
  }, [code]);

  useEffect(() => { void refetch(); }, [refetch]);

  const billId = server?.bill.id;
  useEffect(() => {
    if (!billId) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 250); };
    const ch = supabase.channel(`bill-${billId}-${Math.random().toString(36).slice(2)}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "bills", filter: `id=eq.${billId}` }, debounced);
    for (const table of ["receipts", "items", "guests", "claims"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `bill_id=eq.${billId}` }, debounced);
    }
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { debounced(); }
    });
    const onVis = () => { if (document.visibilityState === "visible") debounced(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", debounced);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", debounced);
      void supabase.removeChannel(ch);
    };
  }, [billId, refetch]);

  /** Optimistic local patch, then the remote write, then a fresh read. */
  const mutate = useCallback(async (local: (s: TableState) => TableState, remote: () => Promise<void>) => {
    reqId.current++; // drop any in-flight read that predates this change
    setServer((s) => (s ? local(s) : s));
    try { await remote(); } catch (e) { console.error(e); }
    await refetch();
  }, [refetch]);

  const serverRef = useRef(server);
  serverRef.current = server;
  const opsRef = useRef(ops);
  opsRef.current = ops;

  /** Returns "locked" if the bill stopped claiming before the tap could save. */
  const toggleClaim = useCallback(async (itemId: string, guestId: string): Promise<"ok" | "locked"> => {
    const s = serverRef.current;
    if (!s) return "ok";
    const current = applyOps(s, opsRef.current);
    const has = current.claims.some((c) => c.item_id === itemId && c.guest_id === guestId);
    const claim: ClaimRow = { id: crypto.randomUUID(), bill_id: s.bill.id, item_id: itemId, guest_id: guestId, created_at: new Date().toISOString() };
    const op: Op = { kind: has ? "remove" : "add", claim };
    setOps((o) => [...o, op]);
    const done = () => setOps((o) => o.filter((x) => x !== op));
    let result: "ok" | "locked" = "ok";
    try {
      if (has) {
        rows(await supabase.from("claims").delete().eq("item_id", itemId).eq("guest_id", guestId));
      } else {
        const b = rows<{ status: string } | null>(await supabase.from("bills").select("status").eq("id", s.bill.id).maybeSingle());
        if (b?.status !== "claiming") result = "locked";
        else rows(await supabase.from("claims").insert(claim));
      }
    } catch (e) { console.error(e); }
    await refetch();
    done();
    return result;
  }, [refetch]);

  const state = useMemo(() => (server ? applyOps(server, ops) : null), [server, ops]);
  return { state, ready, refetch, mutate, toggleClaim };
}

/** Guests who take part in the current mode: no-phone people only count in even and wheel. */
// On a YouMustPay table, phone guests only count once their card hold is confirmed.
export const holdPending = (s: TableState, g: TableState["guests"][number]) =>
  Boolean(s.bill.youmustpay) && s.bill.mode !== "wheel" && !g.is_host && g.has_phone
  && g.payment_status !== "held" && g.payment_status !== "captured";

export function activeGuests(s: TableState) {
  const gs = s.guests.filter((g) => !holdPending(s, g));
  return s.bill.mode === "items" ? gs.filter((g) => g.has_phone) : gs;
}

export function itemsSplit(s: TableState): SplitResult {
  const ids = s.guests.filter((g) => g.has_phone && !holdPending(s, g)).map((g) => g.id);
  const receipts = [...s.receipts].sort((a, b) => a.position - b.position).map((r) => ({
    id: r.id,
    items: s.items.filter((i) => i.receipt_id === r.id),
    service: { mode: r.service_mode, rate: Number(r.service_rate), included_pence: r.service_included_pence },
  }));
  return computeBill(receipts, s.claims, ids);
}

export function splitFor(s: TableState): SplitResult {
  const ids = activeGuests(s).map((g) => g.id);
  const base = itemsSplit(s);
  if (s.bill.mode === "even") return computeEven(base.billTotal, ids);
  if (s.bill.mode === "wheel") {
    if (s.bill.wheel_winner_id) return computeWheel(base.billTotal, s.bill.wheel_winner_id, ids);
    return {
      perGuest: ids.map((g) => ({ guest_id: g, food_pence: 0, service_pence: 0, total_pence: 0 })),
      unclaimed: [], billTotal: base.billTotal, claimedTotal: 0, remaining: base.billTotal,
    };
  }
  return base;
}
