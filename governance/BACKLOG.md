# Requested build order

Everything asked for, in the order it will be built, with what each one
actually needs. Nothing here is a plan to be re-approved — it is the queue.

Written down because the requests arrived faster than they could be built, and
a request held only in a conversation is a request that gets dropped.

---

## In flight

### 1. SaaS spine — signing up produces a company
**Status: database done, screen in progress.**

`app.provision_company()` existed since migration 0011 and nothing outside the
tests had ever called it. A real sign-up produced an auth user and a profile and
stopped there: no company, no membership, no role, and row level security
correctly showing that person an empty platform forever. There was no way to
become a customer.

- [x] `app.slugify()`, `app.create_my_company()`, `my_companies` view — migration 0059
- [x] 9 database tests: ownership, seeded pricing profile, bounded trial, slug
      collision, double-submit idempotency, tenant isolation
- [ ] Onboarding screen and the shell redirect that reaches it

### 2. Estimating end to end
**Status: the security boundary is done. The pricing path is next.**

- [x] Migration 0058 — engine outputs are writable only by the engine.
      Before it, any holder of estimate write permission could set
      `total_price` by hand and stamp `engine_version = 'made up'` beside it.
      12 tests.
- [x] The engine compiled into the Edge runtime, with a drift check
- [x] Edge Functions typechecked for the first time (found two SDK pins that
      were older than the APIs the code called)
- [x] `price-estimate` Edge Function: loads through the caller's own client so
      row level security decides what may be priced, maps rows into the engine,
      writes through the one permitted door with the service role. 16 mapping
      tests, 9 page tests.
- [ ] Create an estimate, add lines from the library, approve it, issue a
      proposal — the remaining buttons

---

## Queued

### 3. Super admin console — **built**
At `/admin`, outside the customer application.

- [x] Migration 0064 — `platform_admins` (not a role: a role lives inside a
      company and this is the opposite), `entitlement_overrides`, the two admin
      views, and audited grant and revoke functions. 24 tests.
- [x] The console: tenant list with plan and subscription standing, feature
      overrides with the reason required, and Stripe webhook health. 11 tests.

Three decisions worth keeping:

**An operator cannot read customer business data.** Not estimates, projects,
costs or documents — only counts of them. The ten-minute version of this
feature adds `or app.is_platform_admin()` to every policy and hands whoever
holds the flag every bid every customer has priced. Seven tests assert an
operator reading those tables gets nothing.

**A feature grant composes rather than edits.** `entitlements` is unique on
`company_id` and the Stripe webhook upserts the whole row, so a grant written
there would work and be silently reverted by the next invoice. Overrides sit in
their own table; a revoke beats a grant beats the plan.

**Every operator action is audited into the customer's own ledger**, so the
customer can read what was done to them.

Still open: suspending a company, and a second operator approving a change to a
paying customer's entitlement.

### 4. Leads
A public lead capture form, and leads funnelling through the system to an
opportunity and on to an estimate.

`leads`, `opportunities`, `crm_activities` already exist and nothing writes
them. The public form is the interesting part: it takes writes from an
unauthenticated visitor, which is the only place in the platform that does, so
it needs its own narrow path — rate limiting, spam resistance, and a
company-scoped intake key rather than an open endpoint.

### 5. Workers clock in and out, with geofencing
`time_entries` holds hours, not times: `straight_hours`, `overtime_hours`,
`doubletime_hours` against a `work_date`. A punch is a different record — an
instant, a location, and a device — and it rolls up into a time entry rather
than replacing it. Projects already carry `latitude` and `longitude`, so the
fence has something to be drawn around.

Needs: a punch table, a geofence per project, the roll-up into `time_entries`
that keeps the existing approval and job-cost posting intact, and an honest
answer for a punch that arrives outside the fence or with no location at all —
recorded and flagged, never silently discarded or silently accepted.

### 6. Weather on the dashboard, for the company's own area
Projects carry `site_city`, `site_state`, `latitude` and `longitude`, so there
is somewhere to ask about. The call belongs in an Edge Function rather than the
browser: a weather provider key is a secret, and the platform's rule is that no
secret reaches anything the browser downloads.

Worth connecting to `daily_reports`, which already record weather by hand — a
forecast beside the observed conditions on the same job is worth more than a
widget.

### 7. Estimating presets, so a bid takes minutes
Half of this is already in the schema and unreachable from the screen.
`assemblies` and `assembly_components` are exactly a preset — a bundle of
labor, equipment, material and production rate for one unit of work — and
`pricing_profiles` with their markup components are a preset for the markup
side. Neither is usable from the estimate workspace today.

What is genuinely missing is the level above: an estimate template. A starter
estimate for a job type — a residential subdivision, a parking lot, a sanitary
extension — carrying its usual scope lines, indirects, assumptions and
exclusions, so a new bid begins as a real estimate to edit down rather than an
empty page.

Needs: assembly insertion from the workspace, a template entity that produces a
draft estimate version, and per-company presets for shift hours, fuel price and
crew makeup so the estimator is not retyping the same six numbers on every bid.

### 8. Everything customizable
Partly true already, and unevenly. Per-company today: roles and their
permissions, cost codes, every library (services, assemblies, labor, equipment,
materials, trucking, disposal, production rates, condition modifiers, regional
factors), pricing profiles and markup components, work calendars, notification
preferences, approval tiers and signing limits.

Not customizable, and each is a separate piece of work:

  * **Custom fields** on any entity — no mechanism at all. The one with the
    widest reach and the one that most needs doing carefully, because a custom
    field has to survive row level security, the audit ledger, the public API
    and the export without becoming an untyped bag.
  * **Custom statuses and workflows** — every status is a database `check`
    constraint. Deliberate, and it means a company cannot add a stage.
  * **Branding** — no logo, colors or company identity on proposals, pay
    applications or the application itself.
  * **Terminology** — no way to rename a "project" to a "job".
  * **Report and document layouts** — the PDF package composes fixed layouts.
  * **Dashboards** — fixed tiles, no arrangement or choice of metric, even
    though `metric_definitions` is already a per-company governed catalog.

### 9. On-screen takeoff — **built**
Half of takeoff is built and it is the harder half. Earthwork is complete:
`surfaces` holds elevation grids, `compareSurfaces()` computes cut and fill cell
by cell with the coverage it actually achieved, cross-sections and stockpiles
are there, and a `surface_comparison` writes onto an estimate line through
`applied_line_item_id`. Quantity governance is complete too — every line records
whether its number came from an explicit dimension, a verified scale or an
approximate one, and that choice moves the confidence score, the approval gate
and whether the estimate may be issued at all.

What was missing is now built, for every trade rather than for earthwork:

- [x] `packages/engine/src/takeoff.ts` — scale calibration, traced lengths,
      enclosed areas with deductions, roof pitch correction, depth to volume,
      counts. 38 tests.
- [x] Migration 0061 — `takeoff_calibrations` and `takeoff_measurements`, with
      `measurement_method` a **generated** column so a calibration cannot claim
      to be verified without naming the dimension it was verified against.
      22 tests.
- [x] The viewer: a PDF sheet rendered at its natural size, an overlay that
      records clicks in sheet space rather than screen pixels so zooming to
      click accurately cannot change a quantity, and a panel showing the live
      number with its derivation and the standing of the scale it was taken at.
      16 tests.
- [x] Applying a measurement to an estimate line — migration 0063.
      `measurement_method` is read from the calibration and never accepted from
      the caller, because that value decides the line confidence and the
      approval gate. 9 more database tests, 10 panel tests.
- [x] Choosing a sheet from an uploaded plan set, opened through a short-lived
      signed URL because a plan set is a customer's competitive position before
      it is a drawing.

Known limit, stated rather than hidden: **choosing a line from the dropdown is
not covered by an automated test.** Radix opens its listbox into a portal that
jsdom gives no pointer geometry to, so the interaction cannot be driven in this
environment. The panel's contract is tested with the line preselected — which
is also how it behaves when an estimator arrives from an estimate line — and
the dropdown itself was checked by hand.

The governance decision worth recording: a measurement row stores **geometry and
no quantity**. The number follows from the shape and the scale by arithmetic the
engine owns, so a stored copy could disagree with the shape it came from. That
also means there is no engine output here to forge, which is why the guard
migration 0058 needed for estimates is unnecessary rather than absent.

### 10. Every trade in the service library
The library is heavy civil and only heavy civil. Counting what is actually
seeded: Earthwork 52, Utilities 44, Demolition 36, Asphalt 30, Concrete 28,
plus generic task rollups. There is no electrical, mechanical, plumbing,
roofing, masonry, structural steel, carpentry, drywall, painting, finishes,
fire protection or landscaping — so an estimator outside sitework opens the
library and finds nothing to build a bid from.

The structure is right and already carries what a full library needs: services
with categories, assemblies bundling labor, equipment and material per unit of
work, production rates with source type and confidence, and per-company
overrides on all of it. What is missing is content, and content at this scale
is the work: every service needs its related tasks, a unit that suits it, and a
production rate that is defensible rather than invented — a seeded rate nobody
can source is the same defect as a typed price.

Needs a decision on organization too. The current categories are informal
names; CSI MasterFormat divisions are what the rest of the industry indexes on,
and the estimate line already carries `bid_item_number` and `discipline` that
would map to it.

### 11. Survey and design surface import
The civil equivalent of model-based takeoff, and much smaller than BIM.

`surfaces`, `surface_comparisons` and `machine_control_files` already do the
hard part: grids compared cell by cell, cut and fill with the coverage actually
achieved, a machine control file published with a digest. What is missing is
the front door — a contractor receives a design surface as LandXML or a DWG and
has no way to get it in.

LandXML first: it is text, it is an open standard, and it is what an engineer
sends. It carries the TIN directly, so the import is a parse and a resample onto
the grid `surfaces` already stores.

This is deliberately ahead of BIM in the queue. A sitework contractor receives
civil surfaces routinely and an IFC model almost never.

### 12. Drones
Aerial survey and progress. Photogrammetry from a flight produces a point cloud
and then a surface, which is exactly what `surfaces` already holds and
`compareSurfaces()` already compares — so drone-flown existing ground would
flow into the earthwork takeoff that is already built, and a flight every few
weeks turns `progressAgainstDesign()` into real progress measurement rather
than a reported percentage.

That is the valuable half and it reuses what exists. The rest is new: flight
records, pilot and aircraft currency (which belongs with `credentials`, where
an expired remote pilot certificate should refuse an assignment the same way
every other credential does), imagery against a project and date, and the
processing step that turns photographs into a grid.

### 13. BIM
Model-based quantities from IFC. **Recommended last, and only if customers ask
for it by name.**

The reasoning against doing it sooner: IFC and Revit models describe vertical
construction — architecture, structure, MEP — and the library GrounUp prices is
heavy civil. A sitework contractor rarely receives a model, and when they do it
is the building rather than the site. Reading models for scopes the platform
cannot price is effort with no output.

The cost is also badly shaped. IFC parsing is a large specification, and the
part that never finishes is not the parsing but the mapping from model elements
onto services that can be priced — which is per-trade and open-ended.

If it is built, the shape is clear and the existing architecture takes it
without strain: a model element carries its own dimensions, so a quantity from
one is `explicit_dimension` — the strongest reliability the measurement scale
allows — and it reaches an estimate through the same `applied_line_item_id`
path surfaces and on-screen measurements already use.

### 14. Follow-up automation
Nothing in the platform acts on a schedule. Every notification is produced by a
database trigger reacting to a change — a machine going down, a service coming
due, a credential expiring — which means the platform can tell you something
happened and cannot tell you that nothing has.

Follow-up is the second kind. A lead nobody has called in five days, a proposal
sent and not answered, an RFI past its response date, a submittal sitting in
review, an invoice past due, a change order unsigned while the work proceeds.
Each is an absence, and an absence has no trigger to fire on.

Needs: a scheduled runner (`pg_cron` or a scheduled Edge Function), rules that
are data rather than code so a company can set its own intervals, and an
outbound path — email at minimum. The rules belong beside `notifications`,
which already has categories, severity, receipts and immutability.

The hard part is not the timer. It is making a follow-up stop: acting on the
thing has to cancel the chase, or the platform becomes noise inside a week.

### 15. HRM and payroll
Today this is labor, not HR: `employees`, `crews`, `credentials`,
`time_entries`, `labor_rates`. Missing entirely — no payroll run, no PTO or
leave, no benefits, no performance reviews, no onboarding, no org chart, and no
HR role among the eleven seeded roles.

Payroll is the load-bearing piece and the one with real consequences: it has to
reconcile to approved time entries, post to job cost through the path migration
0044 already built, and never pay from unapproved hours.

### 16. Asset lifecycle accounting
`assets` records `acquisition_cost`, `acquired_on` and `disposed_on`, and
nothing does anything with them. No depreciation schedule, no book value, no
salvage, no disposal proceeds or gain, no transfer between divisions. Recorded
as a gap in the P12 verdict and still open.

### 17. General ledger
No chart of accounts, no journal entries, no trial balance, no bank
reconciliation, no profit and loss, no balance sheet. What exists is
construction job cost and billing that was designed to feed an accounting
system rather than be one — the Finance screen's "Export to accounting" button
is that intent.

Making GrounUp the accounting system is a real change of scope rather than a
gap to fill, and it is last for that reason.
