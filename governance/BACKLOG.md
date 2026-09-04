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

### 3. Super admin console
Log in and see every company using the platform, turn features on and off per
company, see subscription standing, inspect a failed webhook.

Nothing of this exists. The subscription machinery is complete and entirely
tenant-facing; row level security is built so no company can see another, which
is right for customers and means the operator of GrounUp has no way to see their
own. Needs a platform-admin boundary that is genuinely separate from tenant
roles — not a role inside a company — plus an audited override path, because an
operator changing a customer's entitlement is exactly the action that must never
be untraceable.

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

### 9. On-screen takeoff
Half of takeoff is built and it is the harder half. Earthwork is complete:
`surfaces` holds elevation grids, `compareSurfaces()` computes cut and fill cell
by cell with the coverage it actually achieved, cross-sections and stockpiles
are there, and a `surface_comparison` writes onto an estimate line through
`applied_line_item_id`. Quantity governance is complete too — every line records
whether its number came from an explicit dimension, a verified scale or an
approximate one, and that choice moves the confidence score, the approval gate
and whether the estimate may be issued at all.

What is missing is the thing most estimators mean by the word: a drawing viewer
you measure on. No sheet viewer, no scale calibration against a known dimension,
no polyline for linear feet, no polygon for area, no counts on symbols, and no
table to hold any of it. A sitework contractor can take off earthwork from
survey data today and cannot take off a storm line by clicking along it.

Needs: a sheet viewer over the `document_sheets` already extracted, a
calibration that records what it was calibrated against (because
`measurement_method` already distinguishes verified from approximate scale, and
that distinction has to stay honest), measurement shapes stored with their sheet
and their scale so a number can be re-checked, and the same
`applied_line_item_id` path earthwork already uses so a measurement lands on an
estimate line rather than being retyped.

### 10. Follow-up automation
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

### 11. HRM and payroll
Today this is labor, not HR: `employees`, `crews`, `credentials`,
`time_entries`, `labor_rates`. Missing entirely — no payroll run, no PTO or
leave, no benefits, no performance reviews, no onboarding, no org chart, and no
HR role among the eleven seeded roles.

Payroll is the load-bearing piece and the one with real consequences: it has to
reconcile to approved time entries, post to job cost through the path migration
0044 already built, and never pay from unapproved hours.

### 12. Asset lifecycle accounting
`assets` records `acquisition_cost`, `acquired_on` and `disposed_on`, and
nothing does anything with them. No depreciation schedule, no book value, no
salvage, no disposal proceeds or gain, no transfer between divisions. Recorded
as a gap in the P12 verdict and still open.

### 13. General ledger
No chart of accounts, no journal entries, no trial balance, no bank
reconciliation, no profit and loss, no balance sheet. What exists is
construction job cost and billing that was designed to feed an accounting
system rather than be one — the Finance screen's "Export to accounting" button
is that intent.

Making GrounUp the accounting system is a real change of scope rather than a
gap to fill, and it is last for that reason.
