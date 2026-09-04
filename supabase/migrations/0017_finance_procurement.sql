-- =============================================================================
-- GrounUp Enterprise — 0017 Finance and procurement
--
-- SVC-FINANCE, SVC-BILLING, SVC-CASH, SVC-PROCURE and SVC-INVENTORY.
--
-- The commercial spine: a schedule of values is derived from the awarded
-- estimate, a pay application bills against it, retainage is withheld until
-- closeout, and a purchase order commits cost before an invoice ever arrives.
-- Committed cost is the number that tells a project manager they are over
-- budget while there is still time to do something about it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schedule of values — the billing breakdown of a contract
-- -----------------------------------------------------------------------------
create table schedule_of_values (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  -- The estimate line this billing item was derived from.
  source_line_item_id uuid references estimate_line_items(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  item_number         text not null,
  description         text not null,
  scheduled_value     numeric(18,2) not null check (scheduled_value >= 0),
  -- Unit-price contracts bill measured quantity; lump sum bills percentage.
  billing_basis       text not null default 'lump_sum' check (billing_basis in ('lump_sum', 'unit_price')),
  quantity            numeric(18,4),
  unit                app.unit_code,
  unit_price          numeric(16,4),
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, item_number),
  constraint sov_unit_price check (billing_basis <> 'unit_price' or (quantity is not null and unit_price is not null))
);
create index sov_project_idx on schedule_of_values(project_id, sort_order);

create trigger sov_tenant_parent
  before insert or update on schedule_of_values
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

-- -----------------------------------------------------------------------------
-- Pay applications
-- -----------------------------------------------------------------------------
create table pay_applications (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  project_id            uuid not null references projects(id) on delete cascade,
  application_number    int not null check (application_number >= 1),
  period_start          date not null,
  period_end            date not null,

  -- All figures are cumulative-to-date, as AIA G702 requires.
  contract_sum          numeric(18,2) not null default 0 check (contract_sum >= 0),
  approved_changes      numeric(18,2) not null default 0,
  contract_sum_to_date  numeric(18,2) generated always as (contract_sum + approved_changes) stored,
  completed_to_date     numeric(18,2) not null default 0 check (completed_to_date >= 0),
  stored_materials      numeric(18,2) not null default 0 check (stored_materials >= 0),
  total_earned          numeric(18,2) generated always as (completed_to_date + stored_materials) stored,
  retainage_percent     numeric(6,4) not null default 0.05 check (retainage_percent >= 0 and retainage_percent < 1),
  retainage_to_date     numeric(18,2) not null default 0 check (retainage_to_date >= 0),
  previous_payments     numeric(18,2) not null default 0 check (previous_payments >= 0),
  current_due           numeric(18,2) not null default 0,

  status                text not null default 'draft'
                          check (status in ('draft', 'submitted', 'approved', 'partially_paid', 'paid', 'rejected')),
  submitted_at          timestamptz,
  approved_at           timestamptz,
  paid_at               timestamptz,
  amount_paid           numeric(18,2) not null default 0 check (amount_paid >= 0),
  notes                 text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, application_number),
  constraint pay_applications_period check (period_end >= period_start),
  -- Cannot bill more than the contract is worth.
  constraint pay_applications_not_over_billed
    check (completed_to_date <= contract_sum + approved_changes),
  constraint pay_applications_submitted check (status = 'draft' or submitted_at is not null)
);
create index pay_applications_project_idx on pay_applications(project_id, application_number desc);
create index pay_applications_open_idx on pay_applications(company_id, status) where status not in ('paid', 'rejected');

comment on constraint pay_applications_not_over_billed on pay_applications is
  'Billing more than the contract sum plus approved changes is not a rounding error; it is a claim the owner will reject. Caught here rather than at the owner''s desk.';

create table pay_application_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  pay_application_id    uuid not null references pay_applications(id) on delete cascade,
  sov_id                uuid references schedule_of_values(id) on delete set null,
  item_number           text not null,
  description           text not null,
  scheduled_value       numeric(18,2) not null default 0,
  previous_completed    numeric(18,2) not null default 0 check (previous_completed >= 0),
  this_period           numeric(18,2) not null default 0,
  stored_materials      numeric(18,2) not null default 0 check (stored_materials >= 0),
  completed_to_date     numeric(18,2) generated always as (previous_completed + this_period + stored_materials) stored,
  percent_complete      numeric(7,6),
  retainage             numeric(18,2) not null default 0 check (retainage >= 0),
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index pay_application_lines_app_idx on pay_application_lines(pay_application_id, sort_order);

create trigger pay_application_lines_tenant_parent
  before insert or update on pay_application_lines
  for each row execute function app.enforce_tenant_parent('pay_applications', 'pay_application_id', 'id');

/**
 * A submitted pay application is a signed certificate; its figures stop moving.
 *
 * Generated columns are skipped, because PostgreSQL does not populate them in a
 * BEFORE trigger — NEW carries NULL for them while OLD carries the stored value,
 * so comparing them would report every certified application as changed. They
 * need no guarding anyway: a generated column cannot move unless one of the
 * columns it derives from moves, and those are checked.
 */
create or replace function app.enforce_pay_application_lock()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_mutable constant text[] := array[
    'status', 'updated_at', 'approved_at', 'paid_at', 'amount_paid', 'notes'
  ];
  v_generated text[];
  k text;
begin
  if old.status = 'draft' then
    return new;
  end if;

  select coalesce(array_agg(a.attname::text), '{}')
  into v_generated
  from pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
    and a.attgenerated <> '';

  for k in select jsonb_object_keys(v_old) loop
    if k = any (v_mutable) or k = any (v_generated) then continue; end if;
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception
        'Pay application % is % and its figures are certified; field "%" cannot change. Bill the correction on the next application.',
        old.application_number, old.status, k
        using errcode = 'restrict_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger enforce_pay_application_lock
  before update on pay_applications
  for each row execute function app.enforce_pay_application_lock();

-- -----------------------------------------------------------------------------
-- Procurement
-- -----------------------------------------------------------------------------
create table rfqs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  estimate_version_id uuid references estimate_versions(id) on delete set null,
  number              text not null,
  title               text not null,
  scope_description   text,
  trade               text,
  due_at              timestamptz,
  status              text not null default 'draft'
                        check (status in ('draft', 'issued', 'receiving', 'leveling', 'awarded', 'canceled')),
  awarded_vendor_id   uuid references vendors(id) on delete set null,
  awarded_at          timestamptz,
  award_reason        text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  -- An award must say why. "Low bid" is a reason; nothing is not.
  constraint rfqs_award check (status <> 'awarded' or (awarded_vendor_id is not null and award_reason is not null))
);
create index rfqs_company_status_idx on rfqs(company_id, status);

comment on constraint rfqs_award on rfqs is
  'Awarding to anyone other than the low bidder is a defensible decision only if the reason was recorded at the time.';

create table rfq_responses (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  rfq_id              uuid not null references rfqs(id) on delete cascade,
  vendor_id           uuid not null references vendors(id) on delete cascade,
  quoted_amount       numeric(18,2) check (quoted_amount is null or quoted_amount >= 0),
  -- Adjustments applied during leveling to make quotes comparable.
  leveling_adjustment numeric(18,2) not null default 0,
  leveled_amount      numeric(18,2) generated always as (coalesce(quoted_amount, 0) + leveling_adjustment) stored,
  lead_time_days      int check (lead_time_days is null or lead_time_days >= 0),
  valid_until         date,
  inclusions          text,
  exclusions          text,
  status              text not null default 'invited'
                        check (status in ('invited', 'declined', 'received', 'leveled', 'awarded', 'not_awarded')),
  received_at         timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (rfq_id, vendor_id),
  constraint rfq_responses_received check (status = 'invited' or status = 'declined' or quoted_amount is not null)
);
create index rfq_responses_rfq_idx on rfq_responses(rfq_id);

create trigger rfq_responses_tenant_parent
  before insert or update on rfq_responses
  for each row execute function app.enforce_tenant_parent('rfqs', 'rfq_id', 'id');

comment on column rfq_responses.leveling_adjustment is
  'Quotes are rarely like for like. Leveling adds back what a bidder excluded so the comparison is honest, and the adjustment stays visible rather than being folded into the quote.';

create table purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  vendor_id           uuid not null references vendors(id) on delete restrict,
  rfq_id              uuid references rfqs(id) on delete set null,
  number              text not null,
  title               text not null,
  po_type             text not null default 'material'
                        check (po_type in ('material', 'subcontract', 'rental', 'service')),
  -- The committed amount: cost the company is on the hook for before any
  -- invoice arrives. This is what makes a budget overrun visible in time.
  committed_amount    numeric(18,2) not null default 0 check (committed_amount >= 0),
  invoiced_amount     numeric(18,2) not null default 0 check (invoiced_amount >= 0),
  received_amount     numeric(18,2) not null default 0 check (received_amount >= 0),
  paid_amount         numeric(18,2) not null default 0 check (paid_amount >= 0),
  needed_by           date,
  status              text not null default 'draft'
                        check (status in ('draft', 'issued', 'partially_received', 'received', 'closed', 'canceled')),
  issued_at           timestamptz,
  closed_at           timestamptz,
  terms               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  -- Invoicing beyond the commitment means the PO needs a change, not a payment.
  constraint purchase_orders_not_over_invoiced check (invoiced_amount <= committed_amount * 1.001),
  constraint purchase_orders_paid check (paid_amount <= invoiced_amount)
);
create index purchase_orders_project_idx on purchase_orders(project_id) where project_id is not null;
create index purchase_orders_open_idx on purchase_orders(company_id, status) where status not in ('closed', 'canceled');

comment on constraint purchase_orders_not_over_invoiced on purchase_orders is
  'A vendor invoicing beyond the purchase order is a change that needs approving, not a payable to be quietly posted. The 0.1% tolerance absorbs freight and rounding.';

create table purchase_order_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  purchase_order_id   uuid not null references purchase_orders(id) on delete cascade,
  material_id         uuid references materials(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  sort_order          int not null default 0,
  description         text not null,
  quantity            numeric(18,4) not null default 0 check (quantity >= 0),
  unit                app.unit_code,
  unit_price          numeric(16,4) not null default 0 check (unit_price >= 0),
  extended            numeric(18,2) generated always as (quantity * unit_price) stored,
  quantity_received   numeric(18,4) not null default 0 check (quantity_received >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index purchase_order_items_po_idx on purchase_order_items(purchase_order_id, sort_order);

create trigger purchase_order_items_tenant_parent
  before insert or update on purchase_order_items
  for each row execute function app.enforce_tenant_parent('purchase_orders', 'purchase_order_id', 'id');

create table deliveries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  purchase_order_id   uuid not null references purchase_orders(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  ticket_number       text,
  delivered_at        timestamptz not null default now(),
  received_by         uuid references auth.users(id) on delete set null,
  quantity            numeric(18,4) not null check (quantity > 0),
  unit                app.unit_code,
  -- Three-way match: PO, delivery, invoice. A discrepancy here stops payment.
  is_accepted         boolean not null default true,
  discrepancy_note    text,
  storage_path        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deliveries_discrepancy check (is_accepted or discrepancy_note is not null)
);
create index deliveries_po_idx on deliveries(purchase_order_id, delivered_at desc);

create trigger deliveries_tenant_parent
  before insert or update on deliveries
  for each row execute function app.enforce_tenant_parent('purchase_orders', 'purchase_order_id', 'id');

-- -----------------------------------------------------------------------------
-- Inventory
-- -----------------------------------------------------------------------------
create table inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  material_id         uuid references materials(id) on delete set null,
  sku                 text not null,
  name                text not null,
  category            text,
  unit                app.unit_code not null default 'EA',
  location            text not null default 'Main yard',
  quantity_on_hand    numeric(18,4) not null default 0,
  quantity_reserved   numeric(18,4) not null default 0 check (quantity_reserved >= 0),
  quantity_available  numeric(18,4) generated always as (quantity_on_hand - quantity_reserved) stored,
  reorder_point       numeric(18,4) check (reorder_point is null or reorder_point >= 0),
  reorder_quantity    numeric(18,4) check (reorder_quantity is null or reorder_quantity >= 0),
  unit_cost           numeric(16,4) not null default 0 check (unit_cost >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, sku, location),
  -- Reserving more than is on hand is how two crews both plan on the same pipe.
  constraint inventory_items_reserved check (quantity_reserved <= quantity_on_hand)
);
create index inventory_items_reorder_idx on inventory_items(company_id)
  where reorder_point is not null;

create table inventory_transactions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  inventory_item_id   uuid not null references inventory_items(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  purchase_order_id   uuid references purchase_orders(id) on delete set null,
  transaction_type    text not null
                        check (transaction_type in ('receipt', 'issue', 'return', 'adjustment', 'transfer', 'count')),
  -- Positive adds to stock, negative removes. Signed so the ledger sums.
  quantity            numeric(18,4) not null,
  unit_cost           numeric(16,4) not null default 0,
  reference           text,
  reason              text,
  transacted_at       timestamptz not null default now(),
  recorded_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  -- An adjustment that is not explained is indistinguishable from shrinkage.
  constraint inventory_transactions_adjustment check (transaction_type <> 'adjustment' or reason is not null)
);
create index inventory_transactions_item_idx on inventory_transactions(inventory_item_id, transacted_at desc);

create trigger inventory_transactions_tenant_parent
  before insert or update on inventory_transactions
  for each row execute function app.enforce_tenant_parent('inventory_items', 'inventory_item_id', 'id');

/** Keeps quantity_on_hand equal to the sum of its transaction ledger. */
create or replace function app.apply_inventory_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update inventory_items
  set quantity_on_hand = quantity_on_hand + new.quantity,
      updated_at = now()
  where id = new.inventory_item_id;
  return new;
end;
$$;

create trigger apply_inventory_transaction
  after insert on inventory_transactions
  for each row execute function app.apply_inventory_transaction();

-- -----------------------------------------------------------------------------
-- Accounting integration staging
-- -----------------------------------------------------------------------------
create table ap_invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  vendor_id           uuid not null references vendors(id) on delete restrict,
  purchase_order_id   uuid references purchase_orders(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,
  invoice_number      text not null,
  invoice_date        date not null,
  due_date            date,
  amount              numeric(18,2) not null check (amount >= 0),
  tax                 numeric(18,2) not null default 0 check (tax >= 0),
  retainage_withheld  numeric(18,2) not null default 0 check (retainage_withheld >= 0),
  amount_paid         numeric(18,2) not null default 0 check (amount_paid >= 0),
  -- Three-way match state: PO, receipt and invoice must agree before payment.
  match_status        text not null default 'unmatched'
                        check (match_status in ('unmatched', 'matched', 'quantity_variance', 'price_variance', 'no_po')),
  approval_state      app.approval_state not null default 'pending',
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  status              text not null default 'received'
                        check (status in ('received', 'approved', 'on_hold', 'partially_paid', 'paid', 'disputed', 'void')),
  exported_at         timestamptz,
  export_batch        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, vendor_id, invoice_number),
  constraint ap_invoices_paid check (amount_paid <= amount + tax),
  -- Paying an unmatched invoice is how a company pays for materials it never received.
  constraint ap_invoices_pay_requires_match
    check (status not in ('partially_paid', 'paid') or match_status in ('matched', 'no_po'))
);
create index ap_invoices_company_status_idx on ap_invoices(company_id, status);
create index ap_invoices_project_idx on ap_invoices(project_id) where project_id is not null;

comment on constraint ap_invoices_pay_requires_match on ap_invoices is
  'An invoice cannot be paid while it fails the three-way match. This is the control that stops payment for goods never received.';
