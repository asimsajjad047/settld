// All money is integer pence. Never use floats for money.
export type Item = { id: string; price_pence: number };
export type Claim = { item_id: string; guest_id: string };
export type ServiceMode = "none" | "add" | "included";
export type Service = { mode: ServiceMode; rate: number; included_pence?: number };

// Split `total` across weights so the parts always sum to exactly `total` (largest remainder).
export function allocate(total: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights).sort();
  const sum = ids.reduce((s, id) => s + (weights[id] ?? 0), 0);
  const out: Record<string, number> = {};
  if (sum <= 0 || total === 0) { ids.forEach((id) => (out[id] = 0)); return out; }
  const raw = ids.map((id) => ({ id, exact: (total * (weights[id] ?? 0)) / sum }));
  raw.forEach((r) => (out[r.id] = Math.floor(r.exact)));
  let left = total - raw.reduce((s, r) => s + (out[r.id] ?? 0), 0);
  raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.id.localeCompare(b.id));
  for (const r of raw) { if (left <= 0) break; out[r.id] = (out[r.id] ?? 0) + 1; left -= 1; }
  return out;
}

export function computeSplit(items: Item[], claims: Claim[], guestIds: string[], service: Service) {
  const food: Record<string, number> = Object.fromEntries(guestIds.map((g) => [g, 0]));
  const unclaimed: Item[] = [];
  for (const item of items) {
    const claimers = [...new Set(claims.filter((c) => c.item_id === item.id).map((c) => c.guest_id))]
      .filter((g) => g in food);
    if (claimers.length === 0) { unclaimed.push(item); continue; }
    const parts = allocate(item.price_pence, Object.fromEntries(claimers.map((g) => [g, 1])));
    for (const g of claimers) food[g] = (food[g] ?? 0) + (parts[g] ?? 0);
  }
  const itemsTotal = items.reduce((s, i) => s + i.price_pence, 0);
  const serviceTotal =
    service.mode === "add" ? Math.round(itemsTotal * service.rate)
    : service.mode === "included" ? (service.included_pence ?? 0)
    : 0;
  const claimedFood = Object.values(food).reduce((s, v) => s + v, 0);
  // Service on unclaimed food stays unallocated until those items are claimed.
  const serviceForClaimed = itemsTotal === 0 ? 0 : Math.round((serviceTotal * claimedFood) / itemsTotal);
  const svc = allocate(serviceForClaimed, food);
  const perGuest = guestIds.map((g) => ({
    guest_id: g, food_pence: food[g] ?? 0, service_pence: svc[g] ?? 0, total_pence: (food[g] ?? 0) + (svc[g] ?? 0),
  }));
  const billTotal = itemsTotal + serviceTotal;
  const claimedTotal = perGuest.reduce((s, p) => s + p.total_pence, 0);
  return { perGuest, unclaimed, billTotal, claimedTotal, remaining: billTotal - claimedTotal };
}

export const formatGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
// TODO verify in test run: monzo.me/<username>/<amount>?d=<description>
export const monzoLink = (user: string, pence: number, note: string) =>
  `https://monzo.me/${encodeURIComponent(user)}/${(pence / 100).toFixed(2)}?d=${encodeURIComponent(note)}`;

export type Guest = { id: string; is_host: boolean; paid_at: string | null };
export type SplitResult = {
  perGuest: { guest_id: string; food_pence: number; service_pence: number; total_pence: number }[];
  unclaimed: Item[]; billTotal: number; claimedTotal: number; remaining: number;
};

// A table can have several receipts ("rounds"), each with its own service charge. Split each, then add up.
export type Receipt = { id: string; items: Item[]; service: Service };
export function computeBill(receipts: Receipt[], claims: Claim[], guestIds: string[]): SplitResult {
  const perGuest = guestIds.map((g) => ({ guest_id: g, food_pence: 0, service_pence: 0, total_pence: 0 }));
  const out: SplitResult = { perGuest, unclaimed: [], billTotal: 0, claimedTotal: 0, remaining: 0 };
  for (const r of receipts) {
    const s = computeSplit(r.items, claims, guestIds, r.service);
    s.perGuest.forEach((p, i) => {
      const t = perGuest[i];
      if (!t) return;
      t.food_pence += p.food_pence; t.service_pence += p.service_pence; t.total_pence += p.total_pence;
    });
    out.unclaimed.push(...s.unclaimed);
    out.billTotal += s.billTotal;
    out.claimedTotal += s.claimedTotal;
  }
  out.remaining = out.billTotal - out.claimedTotal;
  return out;
}

// "Split evenly" mode: everyone at the table (host included) gets an equal, penny-exact share of the whole bill.
export function computeEven(billTotal: number, guestIds: string[]): SplitResult {
  const parts = allocate(billTotal, Object.fromEntries(guestIds.map((g) => [g, 1])));
  const perGuest = guestIds.map((g) => ({ guest_id: g, food_pence: parts[g] ?? 0, service_pence: 0, total_pence: parts[g] ?? 0 }));
  return { perGuest, unclaimed: [], billTotal, claimedTotal: billTotal, remaining: 0 };
}

// Wheel mode: the winner owes the whole bill, everyone else owes nothing.
// Settled rules for the wheel (no claiming involved): pay_to 'waiter' → settled on spin;
// pay_to 'host' → settled when the winner marks paid, or straight away if the host won.
export function computeWheel(billTotal: number, winnerId: string, guestIds: string[]): SplitResult {
  const perGuest = guestIds.map((g) => {
    const t = g === winnerId ? billTotal : 0;
    return { guest_id: g, food_pence: t, service_pence: 0, total_pence: t };
  });
  return { perGuest, unclaimed: [], billTotal, claimedTotal: billTotal, remaining: 0 };
}

// Wheel slices are ALWAYS in this order (by guest id, never by name, so a rename can't move them).
export const wheelOrder = (guestIds: string[]): string[] => [...guestIds].sort((a, b) => a.localeCompare(b));

// Wheel: the host's phone picks the winner once and saves it; every phone animates to the same result.
export function pickWinner(guestIds: string[]): string {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return guestIds[(r[0] ?? 0) % guestIds.length] ?? "";
}
// Clockwise rotation (degrees) that leaves the winner's slice under a pointer at the top (0°).
// Slice i covers [i*360/n, (i+1)*360/n) measured clockwise from the top before rotating.
export function wheelRotation(winnerIndex: number, n: number, turns = 6): number {
  const slice = 360 / n;
  return turns * 360 + (360 - (winnerIndex + 0.5) * slice);
}

// "Settled" only when every item is claimed, someone besides the host owes money, and all of them have paid.
export function isSettled(split: SplitResult, guests: Guest[]): boolean {
  const owing = split.perGuest.filter((p) => p.total_pence > 0 && !guests.find((g) => g.id === p.guest_id)?.is_host);
  return split.unclaimed.length === 0 && owing.length > 0
    && owing.every((p) => Boolean(guests.find((g) => g.id === p.guest_id)?.paid_at));
}
