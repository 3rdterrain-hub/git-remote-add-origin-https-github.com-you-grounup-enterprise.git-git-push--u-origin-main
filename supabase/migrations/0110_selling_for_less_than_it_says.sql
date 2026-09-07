-- =============================================================================
-- 0110 — Selling for less than the estimate says
--
-- A discount is not a negative markup, and the platform should not pretend it
-- is. The engine asserts every markup component is non-negative on purpose: a
-- component that reduced the price would make "what is this job marked up at"
-- unanswerable, and the answer to that question is what a contractor runs their
-- business on.
--
-- So a concession lives on the version, applied after the price is known, and
-- reported separately. That separation is the point: a discount folded into the
-- markup shows up as a thinner markup, which reads like a cheaper job rather
-- than like money given away.
--
-- The reason is not optional in spirit — the engine warns when one is missing —
-- and it is not enforced here, because refusing to record a discount somebody
-- has already agreed with a customer would leave the estimate wrong instead.
-- =============================================================================

alter table estimate_versions
  add column if not exists discount_percent numeric(6,4) not null default 0
    check (discount_percent >= 0 and discount_percent < 1),
  add column if not exists discount_amount numeric(16,2) not null default 0
    check (discount_amount >= 0),
  add column if not exists discount_reason text,
  add column if not exists discount_approved_by uuid references auth.users(id) on delete set null;

comment on column estimate_versions.discount_percent is
  'A concession against the marked-up price, as a fraction. Applied after markup because a discount is agreed against the number quoted, not against cost — taking it earlier would give away more than the figure states.';

comment on column estimate_versions.discount_reason is
  'Why the price was cut. Not enforced: refusing to record a discount somebody has already agreed with a customer would leave the estimate wrong rather than the paperwork tidy. The engine warns when it is missing, which is the right place for that.';

/*
 * Anything at all off is a decision somebody has to own. Below-cost bids
 * happen deliberately — a contractor buying into a client or keeping a crew
 * busy through winter — and the platform's job is to make sure it was a
 * decision rather than an accident.
 */
create index if not exists estimate_versions_discounted_idx on estimate_versions(company_id)
  where discount_percent > 0 or discount_amount > 0;

/**
 * Cut the price.
 *
 * Separate from `app.update_estimate_version` because it is a different kind of
 * act: the rest of that function is how a bid is put together, and this is a
 * decision to sell it for less than it came to.
 */
create or replace function app.set_estimate_discount(
  p_version uuid,
  p_percent numeric default 0,
  p_amount numeric default 0,
  p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status app.estimate_status;
begin
  select company_id, status into v_company, v_status
  from estimate_versions where id = p_version;

  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;
  if coalesce(p_percent, 0) < 0 or coalesce(p_amount, 0) < 0 then
    raise exception 'A discount does not raise the price'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_percent, 0) >= 1 then
    raise exception 'A discount of the whole price is not a discount'
      using errcode = 'check_violation';
  end if;

  update estimate_versions
     set discount_percent = coalesce(p_percent, 0),
         discount_amount  = coalesce(p_amount, 0),
         discount_reason  = nullif(trim(coalesce(p_reason, '')), ''),
         -- Who cut it. Cleared along with the discount, so a version showing no
         -- concession does not still name somebody as having approved one.
         discount_approved_by = case
           when coalesce(p_percent, 0) > 0 or coalesce(p_amount, 0) > 0
           then auth.uid() else null end,
         updated_at = now()
   where id = p_version;
end;
$$;

revoke all on function app.set_estimate_discount(uuid, numeric, numeric, text)
  from public, anon;
grant execute on function app.set_estimate_discount(uuid, numeric, numeric, text)
  to authenticated;

create or replace function public.set_estimate_discount(
  p_version uuid, p_percent numeric default 0, p_amount numeric default 0,
  p_reason text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_estimate_discount(p_version, p_percent, p_amount, p_reason); end; $$;

revoke all on function public.set_estimate_discount(uuid, numeric, numeric, text)
  from public, anon;
grant execute on function public.set_estimate_discount(uuid, numeric, numeric, text)
  to authenticated;

select app.assert_security_gates();
