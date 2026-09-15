/**
 * A proposal you can draft.
 *
 * `proposals.status` has allowed `'draft'` since migration 0006, and
 * `app.enforce_proposal_immutability` opens with `if old.status = 'draft' then
 * return new` — a branch that has never executed, because `issue_proposal`
 * inserts straight at `'issued'`. There has never been a moment when a proposal
 * was editable.
 *
 * That is why `commercial_terms` and `payment_terms` are written by nothing.
 * They are not missing columns or a missing form; they are two fields with
 * nowhere in the lifecycle to be filled in. The same goes for revising a cover
 * letter with a typo in it, which today means issuing a second proposal.
 *
 * So the draft is the missing state, not a missing screen:
 *
 *   `draft_proposal`   compose it — title, cover letter, commercial terms,
 *                      payment terms, validity, and what the customer sees
 *   `update_proposal`  change any of that, while and only while it is a draft
 *   `issue_drafted_proposal`  send it, which freezes it under the rules 0013
 *                      and 0045 already enforce
 *   `discard_proposal_draft`  throw away one that was never sent
 *
 * `issue_proposal` stays exactly as it is — approve, compose and send in one
 * call is the common case and nothing about it changes.
 *
 * The price is never typed. `app.enforce_proposal_price` (0045) derives a
 * draft's total from the cited version's bid price on every write, so a draft
 * that sits while the estimate is re-priced follows it, and the number is
 * frozen the moment it goes out.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- Composing one
-- -----------------------------------------------------------------------------

/**
 * Start a proposal without sending it.
 *
 * The estimate must already be approved, the same rule `issue_proposal`
 * applies — a draft is a document being written, not a way to quote from an
 * estimate nobody has signed off. The number is taken now so the draft has an
 * identity people can refer to.
 */
create or replace function app.draft_proposal(
  p_version uuid,
  p_title text default null,
  p_cover_letter text default null,
  p_commercial_terms text default null,
  p_payment_terms text default null,
  p_validity_days int default 30,
  p_show_line_detail boolean default true,
  p_show_unit_prices boolean default true)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v estimate_versions%rowtype;
  v_e estimates%rowtype;
  v_number text;
  v_id uuid;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_v.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to draft a proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_v.status not in ('approved', 'issued') then
    raise exception 'An estimate is approved before a proposal is drafted from it'
      using errcode = 'check_violation',
            hint = 'A draft quotes a price; an unapproved estimate does not have one yet.';
  end if;

  select * into v_e from estimates where id = v_v.estimate_id;

  select 'P-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 4, '0')
    into v_number
    from proposals p
   where p.company_id = v_v.company_id
     and date_trunc('year', p.created_at) = date_trunc('year', now());

  /*
   * `total_price` is left to `enforce_proposal_price`, which sets it from the
   * version's bid price on insert and on every draft write. Passing a number
   * here would be a price somebody typed.
   */
  insert into proposals (company_id, estimate_version_id, customer_id, number, title,
                         cover_letter, commercial_terms, payment_terms, validity_days,
                         show_line_detail, show_unit_prices, status, created_by)
  values (v_v.company_id, p_version, v_e.customer_id, v_number,
          coalesce(nullif(trim(coalesce(p_title, '')), ''), v_e.name),
          nullif(trim(coalesce(p_cover_letter, '')), ''),
          nullif(trim(coalesce(p_commercial_terms, '')), ''),
          nullif(trim(coalesce(p_payment_terms, '')), ''),
          greatest(coalesce(p_validity_days, 30), 1),
          coalesce(p_show_line_detail, true), coalesce(p_show_unit_prices, true),
          'draft', auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.draft_proposal(uuid, text, text, text, text, integer, boolean, boolean) is
  'Starts a proposal without sending it. The draft state has been legal since 0006 and unreachable since 0006. WORKFLOW.';

/**
 * Change a draft.
 *
 * Null leaves a field alone, the same rule as `identify_sheet` and
 * `update_opportunity`: a form sends what it touched. Refused outright once the
 * proposal has been issued — `enforce_proposal_immutability` would refuse it
 * anyway, but a clear sentence beats a trigger's message.
 */
create or replace function app.update_proposal(
  p_proposal uuid,
  p_title text default null,
  p_cover_letter text default null,
  p_commercial_terms text default null,
  p_payment_terms text default null,
  p_validity_days int default null,
  p_show_line_detail boolean default null,
  p_show_unit_prices boolean default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_p proposals%rowtype;
begin
  select * into v_p from proposals where id = p_proposal;
  if v_p.id is null then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_p.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to change this proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Proposal % has been %; what the customer was sent does not change',
      v_p.number, v_p.status
      using errcode = 'restrict_violation',
            hint = 'Draft a new proposal from the estimate instead.';
  end if;
  if p_validity_days is not null and p_validity_days < 1 then
    raise exception 'A proposal is valid for at least a day' using errcode = 'check_violation';
  end if;

  update proposals
     set title            = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         cover_letter     = coalesce(p_cover_letter, cover_letter),
         commercial_terms = coalesce(p_commercial_terms, commercial_terms),
         payment_terms    = coalesce(p_payment_terms, payment_terms),
         validity_days    = coalesce(p_validity_days, validity_days),
         show_line_detail = coalesce(p_show_line_detail, show_line_detail),
         show_unit_prices = coalesce(p_show_unit_prices, show_unit_prices),
         updated_at       = now()
   where id = p_proposal;
end;
$$;

comment on function app.update_proposal(uuid, text, text, text, text, integer, boolean, boolean) is
  'Changes a proposal while it is a draft. The only writer of commercial_terms and payment_terms, which nothing has ever written. WORKFLOW.';

/**
 * Send it.
 *
 * Everything `issue_proposal` checks, checked again here, because a draft may
 * have sat for a week and the estimate behind it may have moved: the version
 * still has to be approved and still has to clear `assert_issuable`.
 *
 * Leaving draft is what arms both locks — `enforce_proposal_immutability` for
 * the header and `enforce_proposal_line_lock` for the lines — and what makes
 * `enforce_proposal_price` stop deriving the total. From here it is a record.
 */
create or replace function app.issue_drafted_proposal(p_proposal uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_p proposals%rowtype;
  v_v estimate_versions%rowtype;
begin
  select * into v_p from proposals where id = p_proposal;
  if v_p.id is null then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_p.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to issue a proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Proposal % is already %', v_p.number, v_p.status
      using errcode = 'check_violation';
  end if;

  select * into v_v from estimate_versions where id = v_p.estimate_version_id;
  if v_v.status not in ('approved', 'issued') then
    raise exception 'An estimate is approved before a proposal goes out'
      using errcode = 'check_violation';
  end if;
  if v_v.total_price <= 0 then
    raise exception 'That version has no price on it' using errcode = 'check_violation';
  end if;
  perform app.assert_issuable(v_p.estimate_version_id);

  update proposals
     set status = 'issued', issued_at = now(), updated_at = now()
   where id = p_proposal;

  if v_v.status <> 'issued' then
    perform app.set_estimate_status(v_p.estimate_version_id, 'issued',
      'Proposal ' || v_p.number || ' issued');
  end if;
end;
$$;

comment on function app.issue_drafted_proposal(uuid) is
  'Sends a drafted proposal, re-checking the estimate because a draft may have sat while it moved. WORKFLOW.';

/**
 * Throw away one that was never sent.
 *
 * Only a draft. An issued proposal is withdrawn, not deleted — the customer has
 * seen it, and a document that can be made to have never existed is not a
 * record of anything.
 */
create or replace function app.discard_proposal_draft(p_proposal uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_p proposals%rowtype;
begin
  select * into v_p from proposals where id = p_proposal;
  if v_p.id is null then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_p.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to discard this proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Proposal % has been sent; it is withdrawn, not deleted', v_p.number
      using errcode = 'restrict_violation';
  end if;
  delete from proposals where id = p_proposal;
end;
$$;

comment on function app.discard_proposal_draft(uuid) is
  'Deletes a proposal that was never sent. An issued one is withdrawn instead. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------
create or replace function public.draft_proposal(
  p_version uuid, p_title text default null, p_cover_letter text default null,
  p_commercial_terms text default null, p_payment_terms text default null,
  p_validity_days int default 30, p_show_line_detail boolean default true,
  p_show_unit_prices boolean default true)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.draft_proposal(p_version, p_title, p_cover_letter, p_commercial_terms,
       p_payment_terms, p_validity_days, p_show_line_detail, p_show_unit_prices); $$;

create or replace function public.update_proposal(
  p_proposal uuid, p_title text default null, p_cover_letter text default null,
  p_commercial_terms text default null, p_payment_terms text default null,
  p_validity_days int default null, p_show_line_detail boolean default null,
  p_show_unit_prices boolean default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_proposal(p_proposal, p_title, p_cover_letter, p_commercial_terms,
       p_payment_terms, p_validity_days, p_show_line_detail, p_show_unit_prices); $$;

create or replace function public.issue_drafted_proposal(p_proposal uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.issue_drafted_proposal(p_proposal); $$;

create or replace function public.discard_proposal_draft(p_proposal uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.discard_proposal_draft(p_proposal); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.draft_proposal(uuid, text, text, text, text, integer, boolean, boolean)',
    'public.update_proposal(uuid, text, text, text, text, integer, boolean, boolean)',
    'public.issue_drafted_proposal(uuid)',
    'public.discard_proposal_draft(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
