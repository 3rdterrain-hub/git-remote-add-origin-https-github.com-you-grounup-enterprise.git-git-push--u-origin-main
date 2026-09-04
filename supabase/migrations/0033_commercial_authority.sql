-- =============================================================================
-- 0033 — Commercial authority
--
-- The platform had approval tiers, used them for estimating, and applied none
-- of them to the records that commit money. `projects.write` gated who could
-- touch a change order; nothing gated how large a change order that person
-- could execute. A junior estimator with write access could execute a
-- $900,000 amendment, and the only trace would be their name in `decided_by`.
--
-- Permission answers "may this person touch this record". Authority answers
-- "may this person commit this much". Every construction company runs on the
-- second, and it was the half that did not exist.
--
-- Thresholds are per company, because a signing limit is a company's own
-- policy — a $50,000 change order is routine for one contractor and a board
-- matter for another. A company with no limits configured is unrestricted,
-- which is the honest default: the platform must not invent a signing policy
-- nobody set.
-- =============================================================================

create table commercial_authority_limits (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,

  -- What is being committed. Kept as an explicit list rather than free text,
  -- because a limit on a record type nothing checks is a limit nobody has.
  record_type         text not null
                        check (record_type in ('change_order', 'contract', 'claim_settlement')),

  -- The tier required at or above this value. A row with a threshold of 0 is
  -- the floor: it applies to everything below the next threshold up.
  threshold_value     numeric(18,2) not null default 0 check (threshold_value >= 0),
  required_tier       int not null check (required_tier between 1 and 4),

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (company_id, record_type, threshold_value)
);
create index commercial_authority_limits_lookup_idx
  on commercial_authority_limits(company_id, record_type, threshold_value desc);

comment on table commercial_authority_limits is
  'Per-company signing limits. ENTITY. A company with none configured is unrestricted — the platform does not invent a policy nobody set.';

comment on column commercial_authority_limits.threshold_value is
  'The value at or above which required_tier applies. The highest threshold a value meets or exceeds is the one that governs.';

/**
 * The tier required to commit `p_value` of `p_record_type` at this company.
 *
 * Returns 0 when no limit applies, which the callers read as unrestricted.
 */
create or replace function app.required_authority_tier(
  p_company uuid, p_record_type text, p_value numeric)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(max(l.required_tier), 0)
  from commercial_authority_limits l
  where l.company_id = p_company
    and l.record_type = p_record_type
    and abs(p_value) >= l.threshold_value;
$$;

grant execute on function app.required_authority_tier(uuid, text, numeric) to authenticated, service_role;

comment on function app.required_authority_tier(uuid, text, numeric) is
  'The approval tier a commitment of this size requires. Uses the absolute value, because a $400,000 credit is as consequential as a $400,000 charge.';

/**
 * Refuse a commitment the acting user does not have the authority to make.
 *
 * Checked when the record crosses into its committing state, not on every
 * edit: a draft change order of any size is a proposal, and proposing is not
 * committing. The error names the tier held and the tier needed, because
 * "permission denied" tells somebody nothing about who to ask.
 *
 * TG_ARGV: [0] record type, [1] the column carrying the committed value,
 * [2] the states that count as committed.
 */
create or replace function app.enforce_commercial_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_value    numeric;
  v_required int;
  v_held     int;
  v_states   text[] := string_to_array(tg_argv[2], ',');
  v_old_state text;
  v_new_state text;
begin
  execute format('select ($1).%I::text', 'status') into v_new_state using new;
  if tg_op = 'UPDATE' then
    execute format('select ($1).%I::text', 'status') into v_old_state using old;
  end if;

  -- Only the crossing matters. Editing a record already committed is refused
  -- by the immutability triggers in 0032, not here.
  if not (v_new_state = any (v_states)) or v_new_state is not distinct from v_old_state then
    return new;
  end if;

  execute format('select ($1).%I::numeric', tg_argv[1]) into v_value using new;
  v_required := app.required_authority_tier(new.company_id, tg_argv[0], coalesce(v_value, 0));
  if v_required = 0 then
    return new;
  end if;

  v_held := app.approval_tier(new.company_id);
  if v_held < v_required then
    raise exception
      'Committing % of % requires approval tier %; you hold tier %.',
      tg_argv[0], to_char(coalesce(v_value, 0), 'FM999,999,999.00'), v_required, v_held
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger change_orders_authority
  before insert or update on change_orders
  for each row execute function app.enforce_commercial_authority(
    'change_order', 'price_impact', 'approved,executed');

create trigger contracts_authority
  before insert or update on contracts
  for each row execute function app.enforce_commercial_authority(
    'contract', 'original_value', 'executed,active');

create trigger claims_authority
  before insert or update on claims
  for each row execute function app.enforce_commercial_authority(
    'claim_settlement', 'cost_awarded', 'settled');

comment on function app.enforce_commercial_authority() is
  'Refuses a commitment above the acting user''s authority, naming both tiers. Permission says who may touch a record; this says how much they may commit.';

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------

-- A signing limit is read by everyone who might hit it and changed only by
-- someone who can manage the company.
select app.apply_tenant_rls('commercial_authority_limits', null, 'company.manage');

-- And audited. Raising your own signing limit is the first thing somebody
-- would try, and the ledger is what makes that visible.
select app.attach_standard_triggers('public.commercial_authority_limits'::regclass);

select app.assert_security_gates();
