-- =============================================================================
-- 0124 — Where a lead came from
--
-- Migration 0065 gave a company a public form: a stranger submits, a lead lands
-- unqualified in the pipeline, rate limited per form and per address. What it
-- filed the lead *as* was free text — `lead_intake_forms.source_label`, copied
-- straight into `leads.source`.
--
-- So "Website", "website" and "web site" are three sources, and the question a
-- company actually wants answered — which of these is bringing work in — has no
-- answer. The same problem `library_categories` was built for in 0113, and this
-- is one more row in that catalog rather than a second mechanism.
--
-- Both columns are governed, not just the one that matters. Guarding only
-- `leads.source` would move the failure to the worst possible moment: a company
-- sets a label on a form, the form looks fine, and it refuses the first real
-- stranger who uses it. Guarding the form's label too means a bad one is
-- refused when somebody is sitting there configuring it.
--
-- Everything already written into either column is adopted before any guard is
-- attached, so a database with forms in it comes through this migration with
-- the sources it already had and nothing to retype.
-- =============================================================================

create or replace function app.categorized_columns()
returns table (kind text, table_name text, column_name text, label text)
language sql
immutable
set search_path = pg_catalog
as $$
  select * from (values
    ('industry',            'services',            'industry',        'Industry'),
    ('service_category',    'services',            'category',        'Service category'),
    ('service_subcategory', 'services',            'subcategory',     'Service subcategory'),
    ('task_category',       'tasks',               'category',        'Task category'),
    ('material_category',   'materials',           'category',        'Material category'),
    ('modifier_category',   'condition_modifiers', 'category',        'Condition modifier category'),
    ('labor_group',         'labor_rates',         'labor_group',     'Labor group'),
    ('crew_discipline',     'crews',               'discipline',      'Crew discipline'),
    ('equipment_class',     'equipment',           'equipment_class', 'Equipment class'),
    ('lead_source',         'leads',               'source',          'Lead source'),
    ('lead_source',         'lead_intake_forms',   'source_label',    'Lead source')
  ) as t(kind, table_name, column_name, label);
$$;

comment on function app.categorized_columns() is
  'Which columns are governed by library_categories, and under which kind. LIBRARY support: the backfill, the guard and the pickers all read this one list so none of them can disagree. Two columns share the lead_source kind, because a form''s label and the lead''s source are the same fact written twice.';

/*
 * The sources this platform ships, so a company that has never opened the
 * settings screen still has a working picker. `Website` is spelled to match
 * what 0065 already writes: `lead_intake_forms.source_label` defaults to
 * 'website', the guard compares case-insensitively, and the value a lead
 * carries is left exactly as it was.
 */
insert into library_categories (company_id, kind, name, description, sort_order)
values
  (null, 'lead_source', 'Website',        'A form on the company''s own website.', 10),
  (null, 'lead_source', 'Phone call',     'Called in.', 20),
  (null, 'lead_source', 'Referral',       'Sent by a past customer or a trade partner.', 30),
  (null, 'lead_source', 'Repeat customer','Somebody who has bought before.', 40),
  (null, 'lead_source', 'Walk-in',        'Came to the office or the yard.', 50),
  (null, 'lead_source', 'Bid board',      'Found on a plan room or bid service.', 60),
  (null, 'lead_source', 'Social media',   null, 70),
  (null, 'lead_source', 'Search',         'Found the company through a search engine.', 80),
  (null, 'lead_source', 'Trade show',     null, 90),
  (null, 'lead_source', 'Advertisement',  'Print, radio, mail or paid online.', 100),
  (null, 'lead_source', 'Sign or vehicle','Saw a job sign or a truck.', 110),
  (null, 'lead_source', 'Other',          'Recorded, but not yet worth its own line.', 900)
on conflict do nothing;

/* Adopt what is already in both columns, before either guard is attached. */
insert into library_categories (company_id, kind, name, sort_order)
select l.company_id, 'lead_source', btrim(l.source), 100
  from leads l
 where l.source is not null and length(btrim(l.source)) > 0
 group by l.company_id, btrim(l.source)
on conflict do nothing;

insert into library_categories (company_id, kind, name, sort_order)
select f.company_id, 'lead_source', btrim(f.source_label), 100
  from lead_intake_forms f
 where length(btrim(f.source_label)) > 0
 group by f.company_id, btrim(f.source_label)
on conflict do nothing;

drop trigger if exists leads_source_category on leads;
create trigger leads_source_category
  before insert or update on leads
  for each row execute function app.enforce_library_category('lead_source', 'source');

drop trigger if exists lead_intake_forms_source_label_category on lead_intake_forms;
create trigger lead_intake_forms_source_label_category
  before insert or update on lead_intake_forms
  for each row execute function app.enforce_library_category('lead_source', 'source_label');

/**
 * What a company can file a lead as, for a picker.
 *
 * Its own categories and the platform's, which is the same three-tier read
 * every library in this schema has. Ordered the way a picker should show them.
 */
create or replace view my_lead_sources as
select
  c.id,
  c.company_id,
  c.name,
  c.description,
  c.sort_order,
  (c.company_id is null) as is_platform,
  (select count(*) from leads l
    where l.company_id is not null
      and lower(btrim(l.source)) = lower(btrim(c.name))
      and (c.company_id is null or l.company_id = c.company_id)) as leads_from_here
from library_categories c
where c.kind = 'lead_source' and c.status = 'active';

revoke all on my_lead_sources from public, anon;
grant select on my_lead_sources to authenticated;
alter view my_lead_sources set (security_invoker = on);
