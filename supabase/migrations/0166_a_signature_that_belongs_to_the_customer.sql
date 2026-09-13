-- =============================================================================
-- 0166 — A signature that belongs to the customer
--
-- `app.record_proposal_outcome` (0101) is the only way a customer's answer has
-- ever been recorded, it is gated on `estimates.issue`, and it takes the
-- customer's name as free text. So an acceptance is a member of staff typing
-- the customer's name. It moves the proposal and the estimate together, which
-- is right, and it rests on nothing.
--
-- A disputed bid deserves better than "our estimator typed that they accepted".
-- This gives the customer a way to answer for themselves without an account,
-- because a customer will not create one to accept a bid, and making them is
-- how acceptance stops happening in the platform and goes back to happening
-- over the phone.
--
-- Three rules it is built on.
--
--   1. **The token is never stored.** Only its SHA-256, exactly as `api_keys`
--      does, so a database read cannot be replayed as a customer.
--   2. **A link is a credential, not a row anyone may read.** `anon` may select
--      nothing here. Everything the public side does goes through a function
--      that takes the raw token and returns only what that token entitles.
--   3. **One decision.** A link that has been answered is spent, and answering
--      still goes through `app.record_proposal_outcome`, so there remains
--      exactly one path to "this bid was won".
-- =============================================================================

create table if not exists proposal_share_links (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  proposal_id       uuid not null references proposals(id) on delete cascade,

  -- SHA-256 of the token. The token itself is returned once at creation and
  -- never stored, so nobody with database access can act as the customer.
  token_hash        text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  -- Enough to tell two links apart in a list, and not enough to use one.
  token_prefix      text not null check (token_prefix ~ '^gp_[A-Za-z0-9]{8}$'),

  -- Who it was sent to. A link is attributable before it is ever opened, which
  -- is what makes "somebody accepted" into "this person accepted".
  recipient_name    text not null check (length(trim(recipient_name)) > 0),
  recipient_email   text,

  expires_at        timestamptz not null,
  opened_at         timestamptz,
  opened_count      int not null default 0 check (opened_count >= 0),
  responded_at      timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid references auth.users(id) on delete set null,
  revoke_reason     text,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint proposal_share_links_expiry check (expires_at > created_at),
  constraint proposal_share_links_revoked
    check (revoked_at is null or revoked_by is not null)
);
create index if not exists proposal_share_links_proposal_idx
  on proposal_share_links(proposal_id, created_at desc);
create index if not exists proposal_share_links_live_idx
  on proposal_share_links(company_id, expires_at)
  where revoked_at is null and responded_at is null;

comment on table proposal_share_links is
  'A single-use, expiring, revocable link that lets one named customer answer one proposal without an account. The token is held as a SHA-256 and never stored, so a database read cannot be replayed as the customer. ENTITY.';

/**
 * What the customer actually did, kept apart from the proposal it answers.
 *
 * `proposals.accepted_by_name` records the answer; this records the act — who
 * signed, from where, against which rendering of the document. The document
 * hash is the point: without it, "they accepted" says nothing about what they
 * accepted, and a proposal edited afterwards would carry a signature for a
 * version nobody signed.
 */
create table if not exists proposal_signatures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  proposal_id       uuid not null references proposals(id) on delete cascade,
  share_link_id     uuid references proposal_share_links(id) on delete set null,

  outcome           text not null check (outcome in ('accepted', 'declined')),
  signed_name       text not null check (length(trim(signed_name)) > 0),
  signed_title      text,
  signed_email      text,
  -- The signature as the person typed it, which is what they will be shown
  -- again if they ever ask what they signed.
  signature_text    text,
  decline_reason    text,

  -- The document as it stood. `total_price` and the hash together answer "what
  -- did this signature cover" without depending on the proposal never changing.
  total_price_at_signing numeric(18,2),
  document_hash     text check (document_hash is null or document_hash ~ '^[a-f0-9]{64}$'),

  ip_address        inet,
  user_agent        text,
  signed_at         timestamptz not null default now(),

  constraint proposal_signatures_declined_says_why
    check (outcome <> 'declined' or decline_reason is not null)
);
create index if not exists proposal_signatures_proposal_idx
  on proposal_signatures(proposal_id, signed_at desc);
-- Every table carrying a company_id is indexed on it; `schema-invariants`
-- checks that from the other side.
create index if not exists proposal_signatures_company_idx
  on proposal_signatures(company_id, signed_at desc);

comment on table proposal_signatures is
  'The customer''s own act of accepting or declining: who signed, from where, and against which rendering of the document. ENTITY.';

-- A signature is a statement of record and is not editable after the fact.
drop trigger if exists proposal_signatures_immutable on proposal_signatures;
create trigger proposal_signatures_immutable
  before update on proposal_signatures
  for each row execute function app.forbid_mutation();


-- -----------------------------------------------------------------------------
-- Making one
--
-- `sha256()` is a PostgreSQL built-in, not pgcrypto. Migration 0065 learned the
-- hard way that Supabase installs pgcrypto into the `extensions` schema, so a
-- migration reaching for `digest()` unqualified passes locally and fails on a
-- real project. The built-in has no such problem.
-- -----------------------------------------------------------------------------
create or replace function app.hash_share_token(p_token text)
returns text language sql immutable set search_path = public, pg_catalog
as $$ select encode(sha256(convert_to(p_token, 'utf8')), 'hex'); $$;

comment on function app.hash_share_token(text) is
  'SHA-256 of a share token, hex. Uses the PostgreSQL built-in rather than pgcrypto, which Supabase installs outside the default search path.';

/**
 * Issue a link for one named customer to answer one issued proposal.
 *
 * Returns the token **once**. It is never stored and cannot be recovered: lose
 * it and issue another, which is the same bargain `api_keys` strikes and for
 * the same reason.
 *
 * Only an issued proposal can be sent. A draft has no number the customer
 * should be answering, and one already accepted has an answer.
 */
create or replace function app.create_proposal_share_link(
  p_proposal uuid,
  p_recipient_name text,
  p_recipient_email text default null,
  p_days int default 30)
returns table (token text, expires_at timestamptz, link_id uuid)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_p      proposals%rowtype;
  v_token  text;
  v_id     uuid;
  v_expiry timestamptz;
begin
  select * into v_p from proposals where id = p_proposal;
  if not found then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_p.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to send a proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'issued' then
    raise exception 'Proposal % is %, so there is nothing to send for signature', v_p.number, v_p.status
      using errcode = 'check_violation',
            hint = 'Issue the proposal first.';
  end if;
  if coalesce(trim(p_recipient_name), '') = '' then
    raise exception 'Say who the link is for' using errcode = 'check_violation',
      hint = 'A link nobody is named on cannot say who signed.';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'A link lasts between one and three hundred and sixty-five days'
      using errcode = 'check_violation';
  end if;

  -- 244 bits from the same source `gen_random_uuid()` draws on.
  v_token  := 'gp_' || replace(gen_random_uuid()::text, '-', '')
                    || replace(gen_random_uuid()::text, '-', '');
  v_expiry := now() + make_interval(days => p_days);

  insert into proposal_share_links (
    company_id, proposal_id, token_hash, token_prefix,
    recipient_name, recipient_email, expires_at, created_by)
  values (
    v_p.company_id, p_proposal,
    app.hash_share_token(v_token), substr(v_token, 1, 11),
    trim(p_recipient_name), nullif(trim(coalesce(p_recipient_email, '')), ''),
    v_expiry, auth.uid())
  returning id into v_id;

  return query select v_token, v_expiry, v_id;
end;
$$;

comment on function app.create_proposal_share_link(uuid, text, text, int) is
  'Issues a single-use link for one named customer to answer one issued proposal. Returns the token once; only its hash is stored. WORKFLOW.';

create or replace function app.revoke_proposal_share_link(p_link uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_l proposal_share_links%rowtype;
begin
  select * into v_l from proposal_share_links where id = p_link;
  if not found then
    raise exception 'No such link' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_l.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to revoke a proposal link'
      using errcode = 'insufficient_privilege';
  end if;
  if v_l.responded_at is not null then
    raise exception 'That link has already been answered and cannot be revoked'
      using errcode = 'check_violation',
            hint = 'Revoking it would not unsay what the customer said.';
  end if;
  update proposal_share_links
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_link and revoked_at is null;
end;
$$;

comment on function app.revoke_proposal_share_link(uuid, text) is
  'Withdraws an unanswered proposal link. An answered one is left alone, because revoking it would not unsay what the customer said. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The estimate has to be able to move on the customer's word
--
-- `app.set_estimate_status` (0098) checks a permission and then runs the state
-- machine — the transitions, the self-approval guard, the snapshot capture, the
-- audit event. A customer holds no permission and never will, so the first
-- attempt at this failed with "You do not have permission to approve an
-- estimate", which is the database being exactly right.
--
-- Split the same way the proposal outcome is split, and for the same reason:
-- the permission question and the work are two different things, and copying
-- the work would leave two state machines to keep in step. `awarded` reached
-- from a signed proposal is not somebody approving an estimate — the estimate
-- was approved and issued before the proposal went out, and this is the
-- consequence of a customer answering it.
--
-- The audit event records `auth.uid()`, which is null for a customer. That is
-- the honest entry: the actor was not one of this company's users, and the
-- reason line names who signed.
-- -----------------------------------------------------------------------------
create or replace function app.move_estimate_status(
  p_version uuid, p_status app.estimate_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v        estimate_versions%rowtype;
  v_lines    int;
  v_unpriced int;
  v_snapshot uuid;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;

  select count(*), count(*) filter (where total_direct_cost = 0 and measured_quantity > 0)
    into v_lines, v_unpriced
  from estimate_line_items where estimate_version_id = p_version;

  if p_status = 'approved' then
    if v_lines = 0 then
      raise exception 'There is nothing on this estimate to approve'
        using errcode = 'check_violation';
    end if;
    if v_unpriced > 0 then
      raise exception '% line(s) have a quantity and no price. Price it first', v_unpriced
        using errcode = 'check_violation',
              hint = 'Pricing runs the engine over every line and writes what it costs.';
    end if;
    /*
     * Not your own — below tier 3. The oldest rule in a bid room: the person
     * who wants the job is not the person who decides the number is right.
     */
    if v_v.created_by = auth.uid() and app.approval_tier(v_v.company_id) < 3 then
      raise exception 'The person who built an estimate cannot be the one who approves it'
        using errcode = 'insufficient_privilege',
              hint = 'Somebody at chief-estimator authority or above has to sign this off.';
    end if;
    perform app.assert_not_expired(p_version);
    perform app.assert_issuable(p_version);
    if v_v.library_snapshot_id is null then
      v_snapshot := app.capture_library_snapshot(p_version);
      update estimate_versions set library_snapshot_id = v_snapshot where id = p_version;
    end if;
  end if;

  if p_status = 'issued' then
    if v_v.status <> 'approved' then
      raise exception 'An estimate is approved before it is issued'
        using errcode = 'check_violation';
    end if;
    perform app.assert_not_expired(p_version);
    perform app.assert_issuable(p_version);
  end if;
  if v_v.status in ('issued', 'awarded', 'lost') and p_status in ('draft', 'in_review') then
    raise exception 'This version has already gone out; make a new version instead'
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  update estimate_versions
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         issued_by   = case when p_status = 'issued'   then auth.uid() else issued_by end,
         issued_at   = case when p_status = 'issued'   then now() else issued_at end,
         updated_at = now()
   where id = p_version;

  update estimates e set status = p_status, updated_at = now()
   where e.id = v_v.estimate_id and e.current_version_id = p_version;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_v.company_id, auth.uid(),
          case when p_status = 'approved' then 'approve'
               when p_status = 'issued' then 'issue'
               when p_status = 'awarded' then 'award'
               when p_status = 'lost' then 'reject'
               else 'update' end::app.audit_action,
          'public.estimate_versions', p_version::text,
          jsonb_build_object('status', p_status, 'was', v_v.status),
          nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

comment on function app.move_estimate_status(uuid, app.estimate_status, text) is
  'The estimate state machine without the permission question: transitions, the self-approval guard, the snapshot and the audit entry. Internal — every caller makes its own check. ENGINE.';

revoke all on function app.move_estimate_status(uuid, app.estimate_status, text) from public, anon, authenticated;

create or replace function app.set_estimate_status(
  p_version uuid, p_status app.estimate_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from estimate_versions where id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;

  if p_status in ('approved', 'awarded') then
    if not app.has_permission(v_company, 'estimates.approve') then
      raise exception 'You do not have permission to approve an estimate'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_status = 'issued' then
    if not app.has_permission(v_company, 'estimates.issue') then
      raise exception 'You do not have permission to issue a bid'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not app.has_permission(v_company, 'estimates.write') then
      raise exception 'You do not have permission to change this estimate'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform app.move_estimate_status(p_version, p_status, p_reason);
end;
$$;

revoke all on function app.set_estimate_status(uuid, app.estimate_status, text) from public, anon;
grant execute on function app.set_estimate_status(uuid, app.estimate_status, text) to authenticated;

-- -----------------------------------------------------------------------------
-- One path to "this bid was won"
--
-- `app.record_proposal_outcome` carries the permission check and the work in
-- one body, so the token path could not reuse it — an anonymous customer holds
-- no permission and never will. Splitting the work out rather than copying it
-- keeps a single statement of what accepting a proposal does to the estimate
-- behind it, which is the whole reason 0101 put them together.
-- -----------------------------------------------------------------------------
create or replace function app.apply_proposal_outcome(
  p_proposal uuid, p_outcome text, p_by_name text default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_p proposals%rowtype;
begin
  select * into v_p from proposals where id = p_proposal;
  if not found then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  if p_outcome not in ('accepted', 'declined', 'withdrawn', 'expired') then
    raise exception 'A proposal is accepted, declined, withdrawn or expired, not %', p_outcome
      using errcode = 'check_violation';
  end if;
  if v_p.status <> 'issued' then
    raise exception 'Proposal % is %, so there is no answer to record', v_p.number, v_p.status
      using errcode = 'check_violation';
  end if;
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

  if p_outcome in ('accepted', 'declined') then
    perform app.move_estimate_status(
      v_p.estimate_version_id,
      case when p_outcome = 'accepted' then 'awarded' else 'lost' end::app.estimate_status,
      coalesce(nullif(trim(coalesce(p_reason, '')), ''),
               'Proposal ' || v_p.number || ' ' || p_outcome
               || case when p_outcome = 'accepted' then ' by ' || trim(p_by_name) else '' end));
  end if;
end;
$$;

comment on function app.apply_proposal_outcome(uuid, text, text, text) is
  'Moves a proposal and its estimate together on the customer''s answer. Internal: it carries no permission check, and every caller must make its own. ENGINE.';

revoke all on function app.apply_proposal_outcome(uuid, text, text, text) from public, anon, authenticated;

-- The staff-side entry point keeps its check and now does the work once.
create or replace function app.record_proposal_outcome(
  p_proposal uuid, p_outcome text, p_by_name text default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from proposals where id = p_proposal;
  if v_company is null then
    raise exception 'No such proposal' using errcode = 'no_data_found';
  end if;
  /*
   * Gated on issuing rather than on approving: recording that a customer signed
   * is part of running the bid, and the person who sent it is the person who
   * hears back.
   */
  if not app.has_permission(v_company, 'estimates.issue') then
    raise exception 'You do not have permission to record a proposal outcome'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.apply_proposal_outcome(p_proposal, p_outcome, p_by_name, p_reason);
end;
$$;

revoke all on function app.record_proposal_outcome(uuid, text, text, text) from public, anon;
grant execute on function app.record_proposal_outcome(uuid, text, text, text) to authenticated;

create or replace function public.create_proposal_share_link(
  p_proposal uuid, p_recipient_name text,
  p_recipient_email text default null, p_days int default 30)
returns table (token text, expires_at timestamptz, link_id uuid)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.create_proposal_share_link(
        p_proposal, p_recipient_name, p_recipient_email, p_days); $$;

create or replace function public.revoke_proposal_share_link(
  p_link uuid, p_reason text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.revoke_proposal_share_link(p_link, p_reason); $$;

revoke all on function public.create_proposal_share_link(uuid, text, text, int) from public, anon;
grant execute on function public.create_proposal_share_link(uuid, text, text, int) to authenticated;
revoke all on function public.revoke_proposal_share_link(uuid, text) from public, anon;
grant execute on function public.revoke_proposal_share_link(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The customer's side
--
-- Two functions, both taking the raw token, both `security definer`, and both
-- returning only what that one token entitles. `anon` selects from no table
-- here: a link is a credential, not a row anyone may read.
-- -----------------------------------------------------------------------------

/**
 * Resolve a token to the link it names, refusing every reason it should not be
 * honored — and saying which, because "this link is not valid" leaves somebody
 * on the phone asking which of four things went wrong.
 */
create or replace function app.share_link_for_token(p_token text)
returns proposal_share_links
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare v_l proposal_share_links%rowtype;
begin
  select * into v_l from proposal_share_links
   where token_hash = app.hash_share_token(coalesce(p_token, ''));
  if not found then
    raise exception 'This link is not recognized' using errcode = 'no_data_found';
  end if;
  if v_l.revoked_at is not null then
    raise exception 'This link was withdrawn' using errcode = 'check_violation';
  end if;
  if v_l.responded_at is not null then
    raise exception 'This proposal has already been answered' using errcode = 'check_violation';
  end if;
  if v_l.expires_at <= now() then
    raise exception 'This link expired on %', to_char(v_l.expires_at, 'FMMonth FMDD, YYYY')
      using errcode = 'check_violation',
            hint = 'Ask for a new one.';
  end if;
  return v_l;
end;
$$;

revoke all on function app.share_link_for_token(text) from public, anon, authenticated;

/**
 * The proposal, as the customer holding this link may see it.
 *
 * Returned as one document rather than a set of tables, because this is the one
 * place in the platform where an anonymous caller receives tenant data and the
 * list of what escapes should be readable in a single place rather than
 * assembled from policies.
 *
 * `show_line_detail` and `show_unit_prices` are the proposal's own settings and
 * are honored here: a company that chose not to itemize does not get itemized
 * by the signing page.
 */
create or replace function app.open_proposal_by_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_l     proposal_share_links%rowtype;
  v_p     proposals%rowtype;
  v_co    companies%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  v_l := app.share_link_for_token(p_token);
  select * into v_p  from proposals where id = v_l.proposal_id;
  select * into v_co from companies where id = v_l.company_id;

  if v_p.show_line_detail then
    select coalesce(jsonb_agg(jsonb_build_object(
             'description', l.description,
             'quantity',    l.adjusted_quantity,
             'unit',        l.unit,
             'unitPrice',   case when v_p.show_unit_prices then l.unit_price else null end,
             'total',       l.total_price)
           order by l.sort_order), '[]'::jsonb)
      into v_lines
      from estimate_line_items l
     where l.estimate_version_id = v_p.estimate_version_id
       and l.client_visible;
  end if;

  update proposal_share_links
     set opened_at = coalesce(opened_at, now()),
         opened_count = opened_count + 1
   where id = v_l.id;

  return jsonb_build_object(
    'proposalId',     v_p.id,
    'number',         v_p.number,
    'title',          v_p.title,
    'coverLetter',    v_p.cover_letter,
    'commercialTerms',v_p.commercial_terms,
    'paymentTerms',   v_p.payment_terms,
    'totalPrice',     v_p.total_price,
    'issuedAt',       v_p.issued_at,
    'validityDays',   v_p.validity_days,
    'showLineDetail', v_p.show_line_detail,
    'showUnitPrices', v_p.show_unit_prices,
    'lines',          v_lines,
    'company',        jsonb_build_object(
                        'name',  v_co.name,
                        'city',  v_co.city,
                        'state', v_co.state_province),
    'recipientName',  v_l.recipient_name,
    'expiresAt',      v_l.expires_at);
end;
$$;

comment on function app.open_proposal_by_token(text) is
  'The proposal a valid link entitles its holder to read, honoring the proposal''s own line-detail and unit-price settings. The single place tenant data reaches an anonymous caller. WORKFLOW.';

/**
 * The customer's answer, and the evidence that it was theirs.
 *
 * The signature is written first and the outcome applied second, in one
 * transaction: an outcome recorded without the act behind it is the state we
 * started from, and it is the half worth keeping if anything can only be half
 * done.
 *
 * `p_document_hash` is what the signing page rendered. Storing it is what makes
 * "they accepted" mean something later — without it a proposal edited
 * afterwards carries a signature for a version nobody ever saw.
 */
create or replace function app.respond_to_proposal_by_token(
  p_token         text,
  p_outcome       text,
  p_signed_name   text,
  p_signed_title  text default null,
  p_signed_email  text default null,
  p_signature_text text default null,
  p_decline_reason text default null,
  p_document_hash text default null,
  p_ip            inet default null,
  p_user_agent    text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_l proposal_share_links%rowtype;
  v_p proposals%rowtype;
begin
  v_l := app.share_link_for_token(p_token);
  select * into v_p from proposals where id = v_l.proposal_id;

  if p_outcome not in ('accepted', 'declined') then
    raise exception 'Answer is accepted or declined, not %', p_outcome
      using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_signed_name), '') = '' then
    raise exception 'Type your name to sign' using errcode = 'check_violation';
  end if;
  if p_outcome = 'declined' and coalesce(trim(coalesce(p_decline_reason, '')), '') = '' then
    raise exception 'Say why, so the contractor knows what to change'
      using errcode = 'check_violation';
  end if;

  insert into proposal_signatures (
    company_id, proposal_id, share_link_id, outcome,
    signed_name, signed_title, signed_email, signature_text, decline_reason,
    total_price_at_signing, document_hash, ip_address, user_agent)
  values (
    v_l.company_id, v_l.proposal_id, v_l.id, p_outcome,
    trim(p_signed_name),
    nullif(trim(coalesce(p_signed_title, '')), ''),
    nullif(trim(coalesce(p_signed_email, '')), ''),
    nullif(trim(coalesce(p_signature_text, '')), ''),
    nullif(trim(coalesce(p_decline_reason, '')), ''),
    v_p.total_price, p_document_hash, p_ip, p_user_agent);

  -- Spent, before the outcome moves anything, so a retry cannot answer twice.
  update proposal_share_links set responded_at = now() where id = v_l.id;

  perform app.apply_proposal_outcome(
    v_l.proposal_id, p_outcome, trim(p_signed_name),
    case when p_outcome = 'declined' then trim(p_decline_reason) else null end);

  return jsonb_build_object(
    'outcome', p_outcome,
    'number',  v_p.number,
    'signedBy', trim(p_signed_name),
    'signedAt', now());
end;
$$;

comment on function app.respond_to_proposal_by_token(text, text, text, text, text, text, text, text, inet, text) is
  'Records the customer''s own acceptance or decline against a valid link, with the evidence that it was theirs, then moves the proposal and its estimate through the one path that does that. WORKFLOW.';

/*
 * The customer calls something in `public`, and `app` stays closed to them.
 *
 * Granting execute on an `app` function is not enough on its own: a visitor has
 * no `usage` on that schema and should not be given any, so a definer wrapper
 * in `public` is how migration 0065 opened the lead form to the world and is
 * how this opens the signing page. The wrappers add no privilege of their own —
 * everything is done by the functions above, which validate the token first.
 */
create or replace function public.open_proposal_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$ begin return app.open_proposal_by_token(p_token); end; $$;

create or replace function public.respond_to_proposal_by_token(
  p_token text, p_outcome text, p_signed_name text,
  p_signed_title text default null, p_signed_email text default null,
  p_signature_text text default null, p_decline_reason text default null,
  p_document_hash text default null, p_ip inet default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  return app.respond_to_proposal_by_token(
    p_token, p_outcome, p_signed_name, p_signed_title, p_signed_email,
    p_signature_text, p_decline_reason, p_document_hash, p_ip, p_user_agent);
end;
$$;

revoke all on function app.open_proposal_by_token(text) from public, anon, authenticated;
revoke all on function app.respond_to_proposal_by_token(text, text, text, text, text, text, text, text, inet, text) from public, anon, authenticated;

revoke all on function public.open_proposal_by_token(text) from public;
grant execute on function public.open_proposal_by_token(text) to anon, authenticated;
revoke all on function public.respond_to_proposal_by_token(text, text, text, text, text, text, text, text, inet, text) from public;
grant execute on function public.respond_to_proposal_by_token(text, text, text, text, text, text, text, text, inet, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row level security
--
-- The company sees and manages its own links and signatures. `anon` selects
-- from neither table: everything the public side does goes through the
-- definer functions above, which is what keeps the token a credential rather
-- than a lookup key.
-- -----------------------------------------------------------------------------
alter table proposal_share_links enable row level security;
alter table proposal_share_links force row level security;
create policy proposal_share_links_select on proposal_share_links for select to authenticated
  using (app.has_permission(company_id, 'estimates.read'));
create policy proposal_share_links_write on proposal_share_links for all to authenticated
  using (app.has_permission(company_id, 'estimates.issue'))
  with check (app.has_permission(company_id, 'estimates.issue'));

alter table proposal_signatures enable row level security;
alter table proposal_signatures force row level security;
create policy proposal_signatures_select on proposal_signatures for select to authenticated
  using (app.has_permission(company_id, 'estimates.read'));
-- No insert policy: a signature is written by the token function with definer
-- rights, and a member typing one by hand is the thing this migration exists
-- to replace.

revoke all on proposal_share_links from anon;
revoke all on proposal_signatures from anon;

-- A new tenant table falls outside every suspension until it is guarded. The
-- loop in 0082 covered what existed then; a migration that adds one calls this.
-- A link is issued, opened, answered and withdrawn, all of it worth keeping.
-- `proposal_signatures` is frozen instead, which satisfies the same rule from
-- the other side: a table is either audited or immutable, never neither.
select app.attach_standard_triggers('public.proposal_share_links');

select app.guard_suspension('proposal_share_links');
select app.guard_suspension('proposal_signatures');

select app.assert_security_gates();
