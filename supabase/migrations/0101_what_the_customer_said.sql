-- =============================================================================
-- 0101 — What the customer said
--
-- `proposals` has carried `accepted_at`, `accepted_by_name` and `declined_at`
-- since migration 0006, and 0013 listed all three among the fields an issued
-- proposal may still change. Nothing has ever written one.
--
-- The consequence is not a missing timestamp. It is that a bid the customer
-- accepted leaves its estimate sitting at 'issued' forever — so the win rate
-- counts nothing, the award-to-project conversion in 0007 has nothing to
-- convert, and a company using this platform has no record of which bids they
-- won. Everything downstream of a signed proposal was waiting on a row nobody
-- could write.
--
-- Recording the answer moves both the proposal and the estimate, in one
-- statement, because they are one fact. Two updates from a browser is two
-- chances to leave an accepted proposal against a bid the platform still
-- believes is out for decision.
-- =============================================================================

create or replace function app.record_proposal_outcome(
  p_proposal uuid,
  p_outcome text,
  p_by_name text default null,
  p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_p proposals%rowtype;
begin
  select * into v_p from proposals where id = p_proposal;
  if not found then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  /*
   * Gated on issuing rather than on approving: recording that a customer signed
   * is part of running the bid, and the person who sent it is the person who
   * hears back.
   */
  if not app.has_permission(v_p.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to record a proposal outcome'
      using errcode = 'insufficient_privilege';
  end if;
  if p_outcome not in ('accepted', 'declined', 'withdrawn', 'expired') then
    raise exception 'A proposal is accepted, declined, withdrawn or expired, not %', p_outcome
      using errcode = 'check_violation';
  end if;
  if v_p.status <> 'issued' then
    raise exception 'Proposal % is %, so there is no answer to record', v_p.number, v_p.status
      using errcode = 'check_violation';
  end if;
  -- Somebody signed it. A signature belongs to a person, and "accepted by
  -- nobody" is not a record of anything.
  if p_outcome = 'accepted' and coalesce(trim(p_by_name), '') = '' then
    raise exception 'Say who accepted it' using errcode = 'check_violation',
      hint = 'The name on the customer''s acceptance.';
  end if;

  update proposals
     set status = p_outcome,
         accepted_at = case when p_outcome = 'accepted' then now() else accepted_at end,
         accepted_by_name = case when p_outcome = 'accepted' then trim(p_by_name)
                                 else accepted_by_name end,
         declined_at = case when p_outcome = 'declined' then now() else declined_at end,
         updated_at = now()
   where id = p_proposal;

  /*
   * And the estimate follows. Only for the two answers that decide a bid:
   * withdrawing a proposal or letting it expire does not mean the job was lost,
   * and marking it lost would make the win rate a lie in the company's favor
   * or against it depending on which way they withdrew.
   */
  if p_outcome in ('accepted', 'declined') then
    perform app.set_estimate_status(
      v_p.estimate_version_id,
      case when p_outcome = 'accepted' then 'awarded' else 'lost' end::app.estimate_status,
      coalesce(nullif(trim(coalesce(p_reason, '')), ''),
               'Proposal ' || v_p.number || ' ' || p_outcome
               || case when p_outcome = 'accepted' then ' by ' || trim(p_by_name) else '' end));
  end if;
end;
$$;

comment on function app.record_proposal_outcome(uuid, text, text, text) is
  'Records a customer''s answer to an issued proposal and moves the estimate with it: accepted makes the version awarded, declined makes it lost. One statement because they are one fact.';

revoke all on function app.record_proposal_outcome(uuid, text, text, text) from public, anon;
grant execute on function app.record_proposal_outcome(uuid, text, text, text) to authenticated;

create or replace function public.record_proposal_outcome(
  p_proposal uuid, p_outcome text, p_by_name text default null, p_reason text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.record_proposal_outcome(p_proposal, p_outcome, p_by_name, p_reason); end; $$;

revoke all on function public.record_proposal_outcome(uuid, text, text, text) from public, anon;
grant execute on function public.record_proposal_outcome(uuid, text, text, text) to authenticated;

select app.assert_security_gates();
