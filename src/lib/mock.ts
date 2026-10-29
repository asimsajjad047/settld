export type BillMode = "items" | "even" | "wheel";
export type BillStatus = "claiming" | "locked" | "settled";

export type Bill = {
  id: string;
  code: string;
  restaurant_name: string;
  mode: BillMode;
  status: BillStatus;
  host_name: string | null;
  host_monzo: string | null;
  host_revolut: string | null;
  host_sort_code: string | null;
  host_account_number: string | null;
  wheel_winner_id: string | null;
  wheel_spun_at: string | null;
  wheel_pay_to: "waiter" | "host";
  settled_at: string | null;
  created_at: string;
  youmustpay?: boolean;
  hold_amount_pence?: number;
  host_stripe_account_id?: string | null;
};

export type ReceiptRow = {
  id: string;
  bill_id: string;
  label: string;
  position: number;
  service_mode: "none" | "add" | "included";
  service_rate: number;
  service_included_pence: number;
  receipt_total_pence: number | null;
  discount_pence: number | null;
};

export type ItemRow = {
  id: string;
  bill_id: string;
  receipt_id: string;
  name: string;
  /** ONE unit; quantities are separate rows */
  price_pence: number;
  position: number;
};

export type GuestRow = {
  id: string;
  bill_id: string;
  name: string;
  emoji: string;
  color: string;
  is_host: boolean;
  has_phone: boolean;
  in_wheel: boolean;
  paid_at: string | null;
  paid_via?: "self" | "host" | "stripe" | null;
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_status?: "none" | "held" | "captured" | "released" | "failed";
  created_at: string;
};

export type ClaimRow = {
  id: string;
  bill_id: string;
  item_id: string;
  guest_id: string;
  created_at: string;
};

export type TableState = {
  bill: Bill;
  receipts: ReceiptRow[];
  items: ItemRow[];
  guests: GuestRow[];
  claims: ClaimRow[];
};

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(): string {
  const r = new Uint32Array(4);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
}

export const GUEST_COLORS = [
  "oklch(0.86 0.09 150)",
  "oklch(0.86 0.09 262)",
  "oklch(0.88 0.1 70)",
  "oklch(0.86 0.09 27)",
  "oklch(0.87 0.08 200)",
  "oklch(0.86 0.09 320)",
];

export const FOOD_ALIASES: [string, string][] = [
  ["🥑", "Avocado Bandit"], ["🌶️", "Chilli Menace"], ["🥟", "Dumpling Dynamo"],
  ["🍟", "Chip Goblin"], ["🧄", "Garlic Gremlin"], ["🍕", "Pizza Pirate"],
  ["🌮", "Taco Tornado"], ["🍜", "Noodle Ninja"], ["🧀", "Cheese Wizard"],
  ["🍩", "Donut Duke"], ["🥐", "Croissant Captain"], ["🍤", "Prawn Prince"],
];

export function newGuest(billId: string, existing: GuestRow[], id: string = crypto.randomUUID()): GuestRow {
  const used = new Set(existing.map((g) => g.name));
  const pool = FOOD_ALIASES.filter(([, n]) => !used.has(n));
  const [emoji, name] = pool[Math.floor(Math.random() * pool.length)] ?? ["🍽️", `Guest ${existing.length + 1}`];
  return {
    id, bill_id: billId, name, emoji,
    color: GUEST_COLORS[existing.length % GUEST_COLORS.length] ?? GUEST_COLORS[0]!,
    is_host: false, has_phone: true, in_wheel: true, paid_at: null, created_at: new Date().toISOString(),
  };
}

export const DISHOOM_ITEMS: [string, number][] = [
  ["Chicken Ruby", 1590], ["House Black Daal", 990], ["Lamb Biryani", 1690],
  ["Garlic Naan", 450], ["Garlic Naan", 450], ["Okra Fries", 550],
  ["Mango Lassi", 550], ["Masala Chai", 390],
];

/** How a payment was recorded, as shown on Track and the big screen. */
export const paidLabel = (g: Pick<GuestRow, "paid_via">) =>
  g.paid_via === "stripe" ? "Verified ✅ card" : g.paid_via === "host" ? "Marked paid ✅" : "Says paid ✅";
