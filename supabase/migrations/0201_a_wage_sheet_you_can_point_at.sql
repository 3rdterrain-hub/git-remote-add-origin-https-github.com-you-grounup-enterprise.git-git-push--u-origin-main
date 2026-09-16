-- =============================================================================
-- 0201 — A wage sheet you can point at
--
-- What a person is paid is not one number in one place. It depends on which
-- hall they belong to and where the job is, and it breaks down further than a
-- `region` column can carry:
--
--   * **Union.** Operating Engineers Local 18 covers all of Ohio and does not
--     pay the same across it — Toledo is not Cleveland. Cross into Michigan and
--     it is Local 324 under a different agreement entirely. And within a local,
--     the class decides the wage: Class 1 through 4, by machine.
--
--   * **Prevailing wage.** A determination is scoped by county *and by
--     construction type* — heavy, highway, building and residential carry
--     different rates for the same trade in the same county. Bidding site work
--     off the building decision is a real and expensive mistake.
--
--   * **Open shop.** Whatever the company pays. This is most contractors, it is
--     what the seed ships, and it stays the default.
--
-- So the unit is the sheet, because the sheet is what a person actually holds:
-- one determination, one agreement zone, one shop scale. It has a date, a
-- scope, and a list of classes with their money.
--
--   IUOE Local 18 · Toledo district · eff. 1 May 2026
--   OH20260012 · Lucas County · Heavy · eff. 15 Mar 2026
--   3rd Terrain open shop · eff. 1 Jan 2026
--
-- **The property this migration is built around: an estimate that names no
-- sheet resolves to exactly the rate its crew already points at.** Not an
-- equivalent rate — the same row, through the same column, with no lookup at
-- all. A company that never opens this feature cannot be priced differently by
-- it, and `app.resolve_labor_rate` is written so that is true by construction
-- rather than by care.
--
-- The second property: **no silent fallback.** A crew whose classification is
-- not on the sheet the estimate names is refused, by name, saying which
-- classification is missing from which sheet. It does not quietly reach for the
-- shop rate. A wage substituted without being noticed is how a number nobody
-- can defend reaches a bid table.
--
-- LIBRARY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The sheet
-- -----------------------------------------------------------------------------

create table if not exists wage_schedules (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  basis                 text not null
                          check (basis in ('open_shop', 'union', 'prevailing_wage')),

  -- Union scope. A local is not a place; it is an agreement that covers places.
  union_name            text,
  local_number          text,
  district              text,

  -- Prevailing wage scope. The determination is the document; the county and
  -- the construction type are what select it.
  determination_number  text,
  county                text,
  state_code            text,
  construction_type     text
                          check (construction_type is null
                                 or construction_type in ('heavy', 'highway', 'building',
                                                          'residential')),

  effective_date        date not null,
  expires_on            date,
  -- The sheet this one replaces. A scheduled increase is the next sheet in the
  -- chain, which is why a raise known three years out can be entered today.
  supersedes_id         uuid references wage_schedules(id) on delete set null,
  source_document_path  text,
  notes                 text,
  status                app.record_status not null default 'draft',
  approved_by           uuid references auth.users(id) on delete set null,
  approved_at           timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (company_id, code),
  constraint wage_schedules_dates check (expires_on is null or expires_on > effective_date),
  -- A sheet knows what kind of sheet it is. A union sheet with no local is a
  -- sheet nobody can check against the agreement it came from.
  constraint wage_schedules_union_scope
    check (basis <> 'union' or (union_name is not null and local_number is not null)),
  constraint wage_schedules_prevailing_scope
    check (basis <> 'prevailing_wage'
           or (determination_number is not null and county is not null
               and state_code is not null and construction_type is not null)),
  constraint wage_schedules_open_shop_scope
    check (basis <> 'open_shop'
           or (union_name is null and local_number is null
               and determination_number is null and construction_type is null)),
  constraint wage_schedules_active_needs_approver
    check (status <> 'active' or approved_by is not null)
);

create index if not exists wage_schedules_company_idx
  on wage_schedules(company_id, basis, effective_date desc);

comment on table wage_schedules is
  'One dated wage sheet — a union agreement zone, a prevailing wage determination, or a company scale. LIBRARY: the unit is the sheet because the sheet is the document a person holds, and every rate on it carries its date and its scope.';

comment on constraint wage_schedules_prevailing_scope on wage_schedules is
  'A determination is scoped by county and by construction type. Heavy, highway, building and residential pay differently for the same trade in the same county, and a sheet that does not say which is a sheet nobody can check.';

-- -----------------------------------------------------------------------------
-- What a rate on a sheet knows about itself
-- -----------------------------------------------------------------------------

alter table labor_rates
  add column if not exists wage_schedule_id uuid references wage_schedules(id) on delete cascade,
  -- The trade and the class, held apart. The same operator is "Heavy Equipment
  -- Operator II" in a shop, "Operating Engineer, Class 2" in an agreement and
  -- "Power Equipment Operator, Class II" in a determination; three strings that
  -- nothing can connect. The pair is what stays stable across all three.
  add column if not exists trade text,
  add column if not exists class_label text,
  -- Fringe in dollars an hour, as a determination publishes it. Zero on an
  -- open-shop rate, whose fringe is already inside `burden_percent` as a
  -- fraction — which is why adding this column moves no existing number.
  add column if not exists fringe_per_hour numeric(12,4) not null default 0
    check (fringe_per_hour >= 0),
  -- Cash in lieu is wages and carries payroll burden; fringe into a plan does
  -- not. A fact about how the contractor pays, not about the determination.
  add column if not exists fringe_is_taxable boolean not null default false,
  -- An apprentice is a percentage of journeyman, not a wage. Stored as a
  -- percentage so it cannot go stale the day journeyman moves.
  add column if not exists percent_of_journeyman numeric(6,4)
    check (percent_of_journeyman is null
           or (percent_of_journeyman > 0 and percent_of_journeyman <= 1)),
  add column if not exists journeyman_rate_id uuid references labor_rates(id) on delete set null;

alter table labor_rates drop constraint if exists labor_rates_on_a_sheet_is_classified;
alter table labor_rates
  add constraint labor_rates_on_a_sheet_is_classified
  check (wage_schedule_id is null or (trade is not null and class_label is not null));

alter table labor_rates drop constraint if exists labor_rates_apprentice_names_its_journeyman;
alter table labor_rates
  add constraint labor_rates_apprentice_names_its_journeyman
  check (percent_of_journeyman is null or journeyman_rate_id is not null);

create index if not exists labor_rates_sheet_idx
  on labor_rates(wage_schedule_id, trade, class_label) where wage_schedule_id is not null;

comment on column labor_rates.fringe_per_hour is
  'Fringe in dollars per hour, as a union scale or a determination publishes it. Paid on hours worked rather than hours paid, so it takes no overtime multiplier. Zero on an open-shop rate, whose fringe is carried as a fraction inside burden_percent.';

comment on constraint labor_rates_on_a_sheet_is_classified on labor_rates is
  'A rate on a sheet is found by trade and class, because that pair is the only thing stable across a shop scale, an agreement and a determination — the words each one uses are not.';

-- -----------------------------------------------------------------------------
-- An apprentice follows its journeyman
-- -----------------------------------------------------------------------------

/**
 * Recompute an apprentice's wage from the journeyman it is a percentage of.
 *
 * Recomputed, never carried — the same lesson as 0177, 0179, 0181, 0191 and
 * 0196. A second-period apprentice is seventy percent of journeyman, and stored
 * as a flat figure it is wrong the morning journeyman moves, silently, on every
 * bid that uses that crew.
 *
 * The seed ships three of these as flat numbers today ("Carpenter Apprentice,
 * $24.00"). They keep working exactly as they are, because a rate with no
 * percentage on file is left alone.
 */
create or replace function app.recompute_apprentice_wages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update labor_rates a
     set base_wage_per_hour = round(new.base_wage_per_hour * a.percent_of_journeyman, 4),
         fringe_per_hour    = case
           /*
            * Fringe usually does not step with the percentage — most agreements
            * pay an apprentice full fringe from the first period, and a
            * determination says so explicitly. So it is carried across rather
            * than scaled, and an agreement that does scale it is recorded on
            * the apprentice row directly.
            */
           when a.fringe_per_hour = 0 then 0 else a.fringe_per_hour end,
         updated_at = now()
   where a.journeyman_rate_id = new.id
     and a.percent_of_journeyman is not null;
  return new;
end;
$$;

drop trigger if exists labor_rates_recompute_apprentices on labor_rates;
create trigger labor_rates_recompute_apprentices
  after update of base_wage_per_hour on labor_rates
  for each row execute function app.recompute_apprentice_wages();

-- -----------------------------------------------------------------------------
-- Which sheet an estimate prices from
-- -----------------------------------------------------------------------------

alter table estimate_versions
  add column if not exists wage_schedule_id uuid references wage_schedules(id) on delete set null;

comment on column estimate_versions.wage_schedule_id is
  'The wage sheet this version prices from, or null for the rates its crews already name. Null is the default and the overwhelming case: an open-shop company never sets it, and app.resolve_labor_rate then returns the crew member''s own rate unchanged.';

/**
 * Which labor rate prices a crew member on a given estimate version.
 *
 * **The identity property.** A version that names no sheet returns the crew
 * member's own `labor_rate_id` — the same row, through the same column, with no
 * lookup performed at all. Every company that never touches wage sheets is
 * priced by exactly the code path it was priced by before this migration
 * existed, and that is a property of the first three lines rather than
 * something the rest of the function is careful about.
 *
 * **No silent fallback.** When a sheet *is* named and the classification is not
 * on it, this refuses and says which classification is missing from which
 * sheet. It does not reach for the shop rate. The failure a person can see is
 * always better than the number they cannot check — and on a public job a
 * quietly substituted wage is the difference between a compliant bid and a
 * finding.
 */
create or replace function app.resolve_labor_rate(
  p_crew_member uuid,
  p_version uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_own      uuid;
  v_sheet    uuid;
  v_trade    text;
  v_class    text;
  v_class_of text;
  v_resolved uuid;
  v_sheetname text;
begin
  select labor_rate_id into v_own from crew_members where id = p_crew_member;
  if v_own is null then
    return null;
  end if;

  select wage_schedule_id into v_sheet from estimate_versions where id = p_version;
  if v_sheet is null then
    return v_own;                                   -- the identity. Nothing else runs.
  end if;

  select trade, class_label, classification
    into v_trade, v_class, v_class_of
    from labor_rates where id = v_own;

  select name into v_sheetname from wage_schedules where id = v_sheet;

  if v_trade is null or v_class is null then
    raise exception
      'The crew has "%" on it, which does not say what trade and class it is, so it cannot be found on %',
      coalesce(v_class_of, 'a labor rate'), coalesce(v_sheetname, 'that wage sheet')
      using errcode = 'no_data_found',
            hint = 'Set the trade and class on that labor rate, then point the estimate at the sheet again.';
  end if;

  select id into v_resolved
    from labor_rates
   where wage_schedule_id = v_sheet
     and trade = v_trade
     and class_label = v_class
     and status <> 'retired'
   order by effective_date desc
   limit 1;

  if v_resolved is null then
    raise exception
      '% (%) is not on the wage sheet "%"', v_trade, v_class, coalesce(v_sheetname, '?')
      using errcode = 'no_data_found',
            hint = 'Add that class to the sheet, or point the estimate at a sheet that carries it. Nothing is substituted, because a wage nobody chose is a wage nobody can defend.';
  end if;

  return v_resolved;
end;
$$;

comment on function app.resolve_labor_rate(uuid, uuid) is
  'The labor rate that prices a crew member on one estimate version. LIBRARY: a version naming no sheet returns the crew member''s own rate unchanged, which is what makes this safe for every company that never uses wage sheets; a version naming a sheet refuses rather than substituting when a class is missing from it.';
