# Settld

**Everyone taps what they had. Nobody does maths.**

Settld is a mobile-first web app for splitting a restaurant bill fairly. The person who paid opens a table, friends scan a QR code, everyone taps the dishes they ate, and Settld works out each person's exact share (service charge included) and gets the host paid back.

Built in one evening at the **Lovable Buildathon at Imperial College London (October 2026)** by **Asim Sajjad** and **Faizan Arif**.

## Features

- **Live QR claiming.** The host opens a table with a 4-character code and QR. Guests join from their phones and tap the items they had. Claims sync in real time across every phone (Supabase Realtime), and shared dishes split automatically between everyone who claimed them.
- **Fair, penny-exact maths.** All money is integer pence. Shared items and service are split with a largest-remainder method, so the shares always add up to the bill exactly.
- **Proportional 12.5% service.** Service can be off, added at 12.5%, or taken from the receipt. It's split in proportion to what each person ate, and service on unclaimed food stays unallocated until someone claims it.
- **AI receipt scan.** Snap up to 4 photos of one receipt. An AI model reads the line items, quantities, service charge, discounts and total, then Settld checks that the items add up to the printed total.
- **"Just say what you had."** Guests can type something like "half the naan and a chai" and AI matches it to the right bill items.
- **Pay the host back in one tap.** Prefilled Monzo and Revolut payment links with the exact amount, plus bank details to copy.
- **YouMustPay (Stripe Connect).** Optional mode for groups who never pay back: each guest puts a card hold (for example £40) on before they can claim. When the bill is locked, the host charges each person *exactly their share* off-session, and the rest of the hold is released. Payments go straight to the host's Stripe Express account.
- **Other ways to split.** Split evenly, or spin the wheel and let one unlucky person pay the lot (with an animated wheel every phone sees land on the same winner).
- **Big-screen mode.** A projector view of the table showing claimed vs. unclaimed items, who owes what and who has paid.
- **Table awards.** Fun end-of-night awards like Big Spender, The Sharer and Fastest Payer, plus a "You're owed" ledger with a WhatsApp chase message for anyone who hasn't paid.

## Tech stack

- **Frontend:** React 19, TanStack Start and TanStack Router (file-based routes, SSR), TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui (Radix UI)
- **Backend:** Supabase (Postgres + Realtime), TanStack Start server functions
- **Payments:** Stripe Connect (Express accounts, Checkout, manual-capture PaymentIntents, off-session charges), Stripe Elements
- **AI:** Lovable AI Gateway (Gemini) for receipt parsing and free-text claim matching
- **Tooling:** Vite, Vitest, ESLint, Prettier, Drizzle (migrations)
- **Built with:** [Lovable](https://lovable.dev)

## Project structure

```
src/
  routes/            Pages: / (start or join), /new (create a table), /t/$code (table), /t/$code/screen (big screen)
  components/        TableApp (main table UI), SecureSeat (card hold), Wheel, Awards, PaidSummary, HostLedger, ui/ (shadcn)
  lib/
    split.ts         Bill-splitting maths (integer pence, service, even and wheel modes)
    store.ts         Supabase data loading, realtime sync, optimistic claims
    stripe.functions.ts / charge.server.ts   Stripe Connect onboarding, Checkout, YouMustPay holds and share charges
    receipt.functions.ts / claim-text.functions.ts   AI receipt reading and free-text claim matching
drizzle/             Database migration for the YouMustPay columns
```

## Running it locally

You'll need Node.js 20+ (or Bun), a Supabase project and a Stripe account in test mode.

```sh
git clone https://github.com/asimsajjad047/settld.git
cd settld
npm install        # or: bun install
cp .env.example .env
npm run dev
```

Then fill in `.env`:

| Variable | What it is |
| --- | --- |
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable (anon) key |
| `STRIPE_SECRET_KEY` | Your Stripe **test** secret key (server side only, never commit it) |

A few things to know:

- **Stripe publishable key:** `src/lib/stripe-config.ts` holds the Stripe *test publishable* key used during the hackathon. Publishable keys are safe in the browser, but **replace it with your own** `pk_test_...` key so payments go to your Stripe account.
- **Database:** the app expects the tables `bills`, `receipts`, `items`, `guests` and `claims` (see `src/integrations/supabase/types.ts` for the columns) with Realtime enabled. `drizzle/migrations` adds the YouMustPay columns.
- **AI features** call the Lovable AI Gateway, which works out of the box when the app is hosted on Lovable. To run them elsewhere, swap `generateChatCompletion` for your own model provider.

Other scripts: `npm run build`, `npm run test`, `npm run lint`.

## Credits

Made by **Asim Sajjad** ([@asimsajjad047](https://github.com/asimsajjad047)) and **Faizan Arif** at the Lovable Buildathon, Imperial College London, October 2026.
