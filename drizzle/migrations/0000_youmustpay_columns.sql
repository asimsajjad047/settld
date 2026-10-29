ALTER TABLE public.bills ADD COLUMN youmustpay boolean NOT NULL DEFAULT false;
ALTER TABLE public.bills ADD COLUMN hold_amount_pence integer NOT NULL DEFAULT 4000;
ALTER TABLE public.bills ADD COLUMN host_stripe_account_id text NULL;
ALTER TABLE public.guests ADD COLUMN stripe_payment_intent_id text NULL;
ALTER TABLE public.guests ADD COLUMN payment_status text NOT NULL DEFAULT 'none';