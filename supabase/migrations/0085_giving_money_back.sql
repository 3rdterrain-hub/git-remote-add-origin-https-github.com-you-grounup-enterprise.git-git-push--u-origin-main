-- =============================================================================
-- 0085 — Giving money back
--
-- The thing support is asked for most and could not do at all. A customer
-- charged for a month they did not use, a double charge after a card retry, a
-- price that was wrong: every one of those ended with somebody logging into
-- Stripe, moving money, and leaving no record in GrounUp of who decided or why.
--
-- What lives here is the **decision**, not the money. Stripe moves the money —
-- it holds the charge, it knows what is refundable, and it is the system of
-- record for anything that touches a card. Duplicating that here would create
-- a second ledger that disagrees with the first. What GrounUp keeps is the
-- part Stripe cannot: who asked, why, who approved it, and whether it worked.
--
-- Two kinds, because they are genuinely different:
--
--   * A **refund** puts money back on the card. It is irreversible and it
--     leaves the business.
--   * A **credit** reduces the next invoice. The money never moves, and a
--     customer who is staying usually prefers it.
--
-- And one rule: **the person who asks for a refund is not the person who
-- approves it** — the same segregation the platform already enforces on upsell
-- proposals and, inside a customer's account, on approving an estimate. The
-- superadmin is the deliberate exception, because they are the business and
-- there is nobody above them; on the day somebody is hired, the rule starts
-- applying to that person without anything being reconfigured.
-- =============================================================================

drop trigger if exists platform_permissions_frozen on platform_permissions;

insert into platform_permissions (key, label, description, is_powerful, sort_order) values
  ('refunds.request', 'Ask for a refund or credit',
   'Write up money going back to a customer, for somebody else to approve.', false, 42),
  ('refunds.approve', 'Approve a refund or credit',
   'Release the money. Never on a request you wrote yourself, unless you are the superadmin.',
   true, 43)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  is_powerful = excluded.is_powerful, sort_order = excluded.sort_order;

create trigger platform_permissions_frozen
  before insert or update or delete on platform_permissions
  for each row execute function app.forbid_mutation();

/*
 * Support asks; the superadmin releases. An account manager can ask too — they
 * are the one on the phone when it comes up — and finance can do neither,
 * because reconciling invoices and deciding to give money back are different
 * jobs held by different people for a reason.
 */
update platform_roles
   set permissions = permissions || array['refunds.request']
 where key in ('support', 'account_manager')
   and not permissions @> array['refunds.request'];

create table refund_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  -- Which invoice it is against. Null for a credit that is not tied to one.
  stripe_invoice_id text,
  kind              text not null check (kind in ('refund', 'credit')),
  amount_cents      int not null check (amount_cents > 0),
  currency          char(3) not null default 'USD',
  reason            text not null check (length(trim(reason)) >= 10),

  requested_by      uuid references auth.users(id) on delete set null,
  requested_at      timestamptz not null default now(),

  state             text not null default 'requested'
                      check (state in ('requested', 'approved', 'rejected', 'applied', 'failed')),
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,

  -- What Stripe did with it. Written only by the function that talks to Stripe.
  stripe_refund_id  text,
  applied_at        timestamptz,
  error             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint refund_requests_decided check (
    state in ('requested') or (decided_by is not null and decided_at is not null)),
  constraint refund_requests_rejection_reason check (
    state <> 'rejected' or (decision_note is not null and length(trim(decision_note)) >= 5))
);

comment on table refund_requests is
  'Money going back to a customer: who asked, why, who approved it, and what Stripe did. ENTITY. The decision lives here and the money lives in Stripe — duplicating the amounts would create a second ledger that disagrees with the first. A refund returns money to the card; a credit reduces the next invoice and never moves any.';

create index refund_requests_company on refund_requests (company_id, requested_at desc);
create index refund_requests_open on refund_requests (state) where state = 'requested';

select app.apply_tenant_rls('refund_requests');
select app.attach_standard_triggers('public.refund_requests'::regclass);
select app.guard_suspension('refund_requests');

/*
 * A customer reads their own — being unable to see a refund you were promised
 * is its own kind of defect — and writes none. Every write is one of the
 * functions below.
 */
drop policy if exists refund_requests_insert on refund_requests;
drop policy if exists refund_requests_update on refund_requests;
drop policy if exists refund_requests_delete on refund_requests;

/** Ask for money to go back. */
create or replace function app.request_refund(
  p_company uuid, p_kind text, p_amount_cents int, p_reason text,
  p_invoice text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('refunds.request') and not app.operator_can('refunds.approve') then
    raise exception 'You do not have permission to ask for a refund'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('refund', 'credit') then
    raise exception 'Money goes back on the card or onto the next invoice, not "%"', p_kind
      using errcode = 'check_violation';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A refund of nothing is not a refund' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'Say why, at length. This is money leaving the business'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;
  /*
   * An invoice is checked against this company's own, so a mistyped id cannot
   * quietly file a refund against somebody else's charge.
   */
  if p_invoice is not null
     and not exists (select 1 from billing_invoices i
                      where i.stripe_invoice_id = p_invoice and i.company_id = p_company) then
    raise exception 'Invoice % does not belong to that company', p_invoice
      using errcode = 'no_data_found';
  end if;

  insert into refund_requests
    (company_id, stripe_invoice_id, kind, amount_cents, reason, requested_by)
  values (p_company, p_invoice, p_kind, p_amount_cents, trim(p_reason), auth.uid())
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'insert', 'public.refund_requests', v_id::text,
          jsonb_build_object('kind', p_kind, 'amount_cents', p_amount_cents),
          trim(p_reason));
  return v_id;
end;
$$;

/** Release it, or refuse it. */
create or replace function app.decide_refund(
  p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_r refund_requests%rowtype;
begin
  if not app.operator_can('refunds.approve') then
    raise exception 'You do not have permission to approve a refund'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_r from refund_requests where id = p_request;
  if not found then
    raise exception 'No refund request %', p_request using errcode = 'no_data_found';
  end if;
  if v_r.state <> 'requested' then
    raise exception 'That request is already %', v_r.state using errcode = 'check_violation';
  end if;
  /*
   * The person who asked is not the person who releases it — the same rule the
   * platform enforces on upsell proposals and, inside a customer's account, on
   * approving an estimate.
   *
   * The superadmin is the exception, and deliberately so: they are the
   * business, there is nobody above them, and a rule that made refunds
   * impossible for a company of one would be a rule people worked around in
   * Stripe instead. The moment anybody is hired, it applies to that person
   * without anything being reconfigured.
   */
  if v_r.requested_by = auth.uid() and not app.is_superadmin() then
    raise exception 'The person who asked for a refund cannot be the one who releases it'
      using errcode = 'insufficient_privilege',
            hint = 'Somebody holding refunds.approve has to decide this one.';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 5) then
    raise exception 'A refusal has to say why' using errcode = 'check_violation';
  end if;

  update refund_requests
     set state = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_request;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_r.company_id, auth.uid(), 'update', 'public.refund_requests', p_request::text,
          jsonb_build_object('state', case when p_approve then 'approved' else 'rejected' end,
                             'amount_cents', v_r.amount_cents),
          coalesce(p_note, v_r.reason));
end;
$$;

/**
 * Claim an approved request so it can be sent to Stripe.
 *
 * Read by the Edge Function running as service_role. Only an approved request
 * is handed over, so nothing reaches Stripe that a second person did not
 * release, and the amount comes from the row rather than from the caller.
 */
create or replace function app.claim_refund(p_request uuid)
returns table (
  company_id uuid, kind text, amount_cents int, currency char(3),
  stripe_invoice_id text, reason text)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_state text;
begin
  select r.state into v_state from refund_requests r where r.id = p_request;
  if v_state is null then
    raise exception 'No refund request %', p_request using errcode = 'no_data_found';
  end if;
  if v_state <> 'approved' then
    raise exception 'That request is %, not approved', v_state
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select r.company_id, r.kind, r.amount_cents, r.currency,
           r.stripe_invoice_id, r.reason
    from refund_requests r where r.id = p_request;
end;
$$;

/** Record what Stripe did. */
create or replace function app.finish_refund(
  p_request uuid, p_applied boolean, p_stripe_refund_id text default null,
  p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_r refund_requests%rowtype;
begin
  select * into v_r from refund_requests where id = p_request;
  if not found then
    raise exception 'No refund request %', p_request using errcode = 'no_data_found';
  end if;

  update refund_requests
     set state = case when p_applied then 'applied' else 'failed' end,
         stripe_refund_id = nullif(trim(coalesce(p_stripe_refund_id, '')), ''),
         applied_at = case when p_applied then now() end,
         error = case when p_applied then null else left(coalesce(p_error, 'Unknown'), 1000) end,
         updated_at = now()
   where id = p_request;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_r.company_id, v_r.decided_by, 'update', 'public.refund_requests',
          p_request::text,
          jsonb_build_object('state', case when p_applied then 'applied' else 'failed' end,
                             'stripe_refund_id', p_stripe_refund_id,
                             'amount_cents', v_r.amount_cents),
          case when p_applied
               then 'Refund issued: ' || v_r.reason
               else 'Refund failed: ' || coalesce(p_error, 'unknown') end);
end;
$$;

-- Grants. Only service_role may claim or finish: an operator approving a refund
-- must not also be able to declare Stripe paid it.
revoke all on function app.request_refund(uuid, text, int, text, text) from public, anon;
grant execute on function app.request_refund(uuid, text, int, text, text) to authenticated;
revoke all on function app.decide_refund(uuid, boolean, text) from public, anon;
grant execute on function app.decide_refund(uuid, boolean, text) to authenticated;
revoke all on function app.claim_refund(uuid) from public, anon, authenticated;
grant execute on function app.claim_refund(uuid) to service_role;
revoke all on function app.finish_refund(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function app.finish_refund(uuid, boolean, text, text) to service_role;

create or replace function public.request_refund(
  p_company uuid, p_kind text, p_amount_cents int, p_reason text,
  p_invoice text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.request_refund(p_company, p_kind, p_amount_cents, p_reason, p_invoice); end; $$;

create or replace function public.decide_refund(
  p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.decide_refund(p_request, p_approve, p_note); end; $$;

create or replace function public.claim_refund(p_request uuid)
returns table (
  company_id uuid, kind text, amount_cents int, currency char(3),
  stripe_invoice_id text, reason text)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.claim_refund(p_request); $$;

create or replace function public.finish_refund(
  p_request uuid, p_applied boolean, p_stripe_refund_id text default null,
  p_error text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.finish_refund(p_request, p_applied, p_stripe_refund_id, p_error); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.request_refund(uuid, text, integer, text, text)',
    'public.decide_refund(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
  foreach v_sig in array array[
    'public.claim_refund(uuid)',
    'public.finish_refund(uuid, boolean, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Seeing it, from both sides
-- -----------------------------------------------------------------------------
create or replace view admin_refunds as
select
  r.id, r.company_id, c.name as company_name,
  r.kind, r.amount_cents, r.currency, r.reason, r.stripe_invoice_id,
  r.state, r.requested_at, r.decided_at, r.decision_note, r.applied_at,
  r.stripe_refund_id, r.error,
  asked.email as requested_by_email,
  decided.email as decided_by_email,
  -- Whether the person reading this may decide it, which is what the screen
  -- needs and would otherwise have to reconstruct from three separate facts.
  (r.state = 'requested'
     and app.operator_can('refunds.approve')
     and (r.requested_by <> auth.uid() or app.is_superadmin())) as you_may_decide
from refund_requests r
join companies c on c.id = r.company_id
left join user_profiles asked on asked.id = r.requested_by
left join user_profiles decided on decided.id = r.decided_by
where app.operator_can('refunds.request') or app.operator_can('refunds.approve')
order by
  case when r.state = 'requested' then 0 else 1 end,
  r.requested_at desc;

comment on view admin_refunds is
  'Money going back, at every stage: asked for, approved or refused, and what Stripe did with it. `you_may_decide` is derived so a screen does not have to reassemble the segregation rule from three separate facts and get it subtly wrong.';

grant select on admin_refunds to authenticated;
revoke all on admin_refunds from anon;

create or replace view my_refunds
with (security_invoker = true) as
select
  r.company_id, r.kind, r.amount_cents, r.currency,
  -- The state, in words, and never the internal reason or the note between
  -- operators. A customer sees that money is coming, not what was said about
  -- them while it was decided.
  case r.state
    when 'requested' then 'Being reviewed'
    when 'approved'  then 'Approved, being processed'
    when 'applied'   then case when r.kind = 'refund'
                               then 'Refunded to your card'
                               else 'Credited to your next invoice' end
    when 'rejected'  then 'Not approved'
    when 'failed'    then 'Could not be processed'
  end                                     as standing,
  r.requested_at,
  r.applied_at
from refund_requests r
where r.state <> 'rejected';

comment on view my_refunds is
  'A company''s own refunds and credits, in words. A rejected request is not shown: a customer who was never told a refund was under consideration should not learn of it by being told it was refused.';

grant select on my_refunds to authenticated;
revoke all on my_refunds from anon;

select app.assert_security_gates();
