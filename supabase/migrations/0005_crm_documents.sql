-- =============================================================================
-- GrounUp Enterprise — 0005 CRM and document control
--
-- The CRM chain (lead -> opportunity -> customer -> estimate -> award) and the
-- document chain (upload -> version -> sheet -> AI finding -> approved scope)
-- both terminate in the estimate, which is what makes the platform one source
-- of truth rather than two systems that happen to share a login.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Customers and contacts
-- -----------------------------------------------------------------------------
create table customers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  division_id       uuid references divisions(id) on delete set null,
  code              text not null,
  name              text not null check (length(trim(name)) between 1 and 300),
  customer_type     text not null default 'commercial'
                      check (customer_type in ('residential', 'commercial', 'municipal', 'state_dot', 'federal', 'industrial', 'developer', 'general_contractor')),
  industry          text,
  email             text,
  phone             text,
  website           text,
  address_line1     text,
  address_line2     text,
  city              text,
  state_province    text,
  postal_code       text,
  country           text not null default 'US',
  payment_terms     text default 'Net 30',
  credit_limit      numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  tax_exempt        boolean not null default false,
  default_pricing_profile_id uuid references pricing_profiles(id) on delete set null,
  notes             text,
  status            app.record_status not null default 'active',
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code)
);
create index customers_company_idx on customers(company_id) where status = 'active';
create index customers_name_idx on customers using gin (name gin_trgm_ops);

create table contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  customer_id       uuid references customers(id) on delete cascade,
  vendor_id         uuid references vendors(id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  title             text,
  email             text,
  phone             text,
  mobile            text,
  is_primary        boolean not null default false,
  role              text,
  notes             text,
  status            app.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A contact belongs to a customer or a vendor, never to both and never to neither.
  constraint contacts_owner check (num_nonnulls(customer_id, vendor_id) = 1)
);
create index contacts_customer_idx on contacts(customer_id) where customer_id is not null;
create index contacts_vendor_idx on contacts(vendor_id) where vendor_id is not null;
create unique index contacts_one_primary_customer_idx on contacts(customer_id) where is_primary and customer_id is not null;

-- -----------------------------------------------------------------------------
-- Leads and opportunities
-- -----------------------------------------------------------------------------
create table leads (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  source            text,
  company_name      text not null,
  contact_name      text,
  email             text,
  phone             text,
  project_description text,
  estimated_value   numeric(16,2) check (estimated_value is null or estimated_value >= 0),
  city              text,
  state_province    text,
  stage             text not null default 'new'
                      check (stage in ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  qualification_score int check (qualification_score is null or qualification_score between 0 and 100),
  assigned_to       uuid references auth.users(id) on delete set null,
  converted_customer_id uuid references customers(id) on delete set null,
  converted_at      timestamptz,
  next_follow_up_at timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint leads_converted check (stage <> 'converted' or converted_customer_id is not null)
);
create index leads_company_stage_idx on leads(company_id, stage);
create index leads_follow_up_idx on leads(company_id, next_follow_up_at) where next_follow_up_at is not null;

create table opportunities (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  division_id       uuid references divisions(id) on delete set null,
  customer_id       uuid not null references customers(id) on delete cascade,
  number            text not null,
  name              text not null,
  description       text,
  stage             text not null default 'identified'
                      check (stage in ('identified', 'qualifying', 'estimating', 'proposed', 'negotiating', 'won', 'lost', 'abandoned')),
  estimated_value   numeric(16,2) check (estimated_value is null or estimated_value >= 0),
  probability       numeric(5,4) check (probability is null or (probability >= 0 and probability <= 1)),
  bid_due_at        timestamptz,
  expected_award_at date,
  expected_start_at date,
  site_address      text,
  site_city         text,
  site_state        text,
  latitude          numeric(9,6) check (latitude is null or (latitude between -90 and 90)),
  longitude         numeric(9,6) check (longitude is null or (longitude between -180 and 180)),
  delivery_method   text,
  owner_user_id     uuid references auth.users(id) on delete set null,
  won_at            timestamptz,
  lost_at           timestamptz,
  loss_reason       text,
  winning_competitor text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number),
  constraint opportunities_lost_reason check (stage <> 'lost' or loss_reason is not null)
);
create index opportunities_company_stage_idx on opportunities(company_id, stage);
create index opportunities_customer_idx on opportunities(customer_id);
create index opportunities_bid_due_idx on opportunities(company_id, bid_due_at) where stage not in ('won', 'lost', 'abandoned');

comment on constraint opportunities_lost_reason on opportunities is
  'A lost job must record why. Win/loss analysis is worthless without it, and it is the input to future bid strategy.';

create table crm_activities (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  customer_id       uuid references customers(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete cascade,
  lead_id           uuid references leads(id) on delete cascade,
  activity_type     text not null check (activity_type in ('call', 'email', 'meeting', 'site_visit', 'note', 'task', 'proposal_sent', 'follow_up')),
  subject           text not null,
  body              text,
  due_at            timestamptz,
  completed_at      timestamptz,
  assigned_to       uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint crm_activities_subject check (num_nonnulls(customer_id, opportunity_id, lead_id) >= 1)
);
create index crm_activities_company_due_idx on crm_activities(company_id, due_at) where completed_at is null;
create index crm_activities_opportunity_idx on crm_activities(opportunity_id) where opportunity_id is not null;

-- -----------------------------------------------------------------------------
-- Document control
-- -----------------------------------------------------------------------------
create table documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete set null,
  project_id        uuid,
  estimate_id       uuid,
  name              text not null,
  document_type     text not null default 'other'
                      check (document_type in ('plan_set', 'specification', 'addendum', 'geotechnical', 'survey',
                                               'environmental', 'bid_form', 'quantity_schedule', 'contract',
                                               'proposal', 'photo', 'report', 'correspondence', 'other')),
  discipline        text,
  folder_path       text not null default '/',
  current_version   int not null default 1 check (current_version >= 1),
  -- Superseded documents stay in the register but must not price work.
  is_superseded     boolean not null default false,
  superseded_by_id  uuid references documents(id) on delete set null,
  issue_date        date,
  received_at       timestamptz not null default now(),
  tags              text[] not null default '{}',
  status            app.record_status not null default 'active',
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index documents_company_type_idx on documents(company_id, document_type);
create index documents_opportunity_idx on documents(opportunity_id) where opportunity_id is not null;
create index documents_name_idx on documents using gin (name gin_trgm_ops);

comment on column documents.is_superseded is
  'Section 3 revision control. A superseded document remains readable for the audit trail but is excluded from takeoff.';

create table document_versions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  document_id       uuid not null references documents(id) on delete cascade,
  version_number    int not null check (version_number >= 1),
  -- Only the storage object path lives in the database; the bytes live in Storage.
  storage_path      text not null,
  storage_bucket    text not null default 'project-documents',
  file_name         text not null,
  mime_type         text,
  byte_size         bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256   text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  page_count        int check (page_count is null or page_count >= 0),
  revision_label    text,
  revision_date     date,
  uploaded_by       uuid references auth.users(id) on delete set null,
  -- Ingestion pipeline state (virus scan -> OCR -> classify -> split -> index).
  processing_state  text not null default 'pending'
                      check (processing_state in ('pending', 'scanning', 'extracting', 'indexed', 'failed', 'rejected')),
  processing_error  text,
  created_at        timestamptz not null default now(),
  unique (document_id, version_number)
);
create index document_versions_document_idx on document_versions(document_id, version_number desc);

comment on column document_versions.storage_path is
  'Supabase Storage object path. Large files are never stored in table rows.';

create table document_sheets (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  page_number       int not null check (page_number >= 1),
  sheet_number      text,
  sheet_title       text,
  discipline        text,
  drawing_scale     text,
  revision          text,
  revision_date     date,
  -- Extracted text, used for permission-filtered search across the plan set.
  extracted_text    text,
  thumbnail_path    text,
  created_at        timestamptz not null default now(),
  unique (document_version_id, page_number)
);
create index document_sheets_number_idx on document_sheets(company_id, sheet_number);
create index document_sheets_text_idx on document_sheets using gin (extracted_text gin_trgm_ops);

alter table documents
  add constraint documents_superseded_requires_target
  check (not is_superseded or superseded_by_id is not null);
