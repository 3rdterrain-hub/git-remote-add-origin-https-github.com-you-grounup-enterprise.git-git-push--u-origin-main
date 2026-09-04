-- =============================================================================
-- Stripe price wiring — ENVIRONMENT SPECIFIC
--
-- Copy to 0003_plan_prices.sql and replace each price id with the one from your
-- own Stripe account. Prices are never hard-coded in the frontend: the app
-- reads plan_prices, so changing a price is a data change, not a release.
--
-- Create the products and prices in Stripe first, then run this.
-- =============================================================================

insert into plan_prices (plan_id, stripe_price_id, interval, unit_amount_cents, currency, usage_type) values
  ('starter',      'price_REPLACE_starter_monthly',      'month',   9900, 'USD', 'licensed'),
  ('starter',      'price_REPLACE_starter_yearly',       'year',   99000, 'USD', 'licensed'),
  ('professional', 'price_REPLACE_professional_monthly', 'month',  29900, 'USD', 'licensed'),
  ('professional', 'price_REPLACE_professional_yearly',  'year',  299000, 'USD', 'licensed'),
  ('business',     'price_REPLACE_business_monthly',     'month',  79900, 'USD', 'licensed'),
  ('business',     'price_REPLACE_business_yearly',      'year',  799000, 'USD', 'licensed'),
  ('enterprise',   'price_REPLACE_enterprise_monthly',   'month', 249900, 'USD', 'licensed'),
  ('enterprise',   'price_REPLACE_enterprise_yearly',    'year', 2499000, 'USD', 'licensed')
on conflict (stripe_price_id) do nothing;
