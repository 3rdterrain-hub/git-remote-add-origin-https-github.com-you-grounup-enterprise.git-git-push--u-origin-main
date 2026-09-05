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

**Operators hold permissions, not a rank.** Migrations 0068 and 0073 shipped two
kinds of operator, superadmin and sales, which is too blunt for how a business
is actually staffed: support needs billing and no commercial authority, finance
needs billing and nothing else, an account manager needs both and no feature
flags. Migration 0074 gives the platform side the same model the tenant side
has had since 0002 — a role holds a list of permission keys, `'*'` is the
wildcard, and `app.operator_can()` is the one question every function asks.
Migration 0076 adds a catalog of permissions, so a role cannot be granted one
that does not exist, and lets the superadmin edit any role or invent new ones.

Two things stay outside the permission system on purpose, because they are
structural rather than administrative: there is exactly one superadmin, still a
partial unique index; and that seat cannot be given up, narrowed or granted
from a screen, whatever the permissions say.

**The business can be run from the console.** Migration 0076 adds the four jobs
that previously needed a database connection — creating a company for somebody
who signed on a call, giving an account away, discounting one, and deciding what
each kind of operator may do. Every arrangement is a record with a reason, an
author and an end date, and `applies_in_stripe` is derived rather than asserted:
a discount Stripe was never told about is shown as not in effect, because it is
not.

Migration 0078 adds what the business is earning: revenue read from the
subscription items Stripe's own webhooks mirrored, what is being given away
counted beside it, growth by month, and the accounts where Stripe and GrounUp
disagree about the price. Yearly is divided by twelve and the screen says so.

**An operator can look inside a subscription without becoming the customer.**
Migration 0079. Support cannot answer "why was I charged that" from a plan id,
and the obvious build — impersonation — is wrong three times over: it opens
every estimate and contract the customer holds to answer a billing question, it
records whatever the operator does as the customer having done it, and it is
unnecessary, because what support needs is a view rather than an identity.

So an operator opens a *support session* on one company, saying why. It lasts an
hour, it is written into that company's own audit ledger where the customer
reads it, and while it is open one definer view shows that company's billing in
full — subscription, items, seats, invoices, allowances, arrangement, overrides,
and the Stripe events for them that failed. No policy anywhere gained an
`or app.is_platform_admin()`, and the operator still cannot read one estimate.
Seventeen tests, most of them refusals.

**A stuck payment can be fixed from the console.** Migration 0081. The dashboard
has shown Stripe events that arrived and never finished since 0064, under a
banner correctly saying what one means — a customer who paid and cannot use what
they paid for — and offered no way to fix one. The instruction in the webhook
function was "replay it from the Stripe dashboard", which works and requires the
person holding the support ticket to have a Stripe login, which support staff
should not have.

`handleEvent` moved out of the webhook into `_shared/stripe-events.ts` so a
replay runs the same code rather than a second implementation of it; a second
one would diverge, and only on the events that had already failed once. The
replay path can only re-apply a payload already stored — a payload only reaches
`stripe_events` after its signature was verified — and refuses an event that
already finished, because re-applying a processed one writes an old
subscription over a newer one. `webhooks.retry` is its own permission, held by
support and not by account managers: the person closing a renewal should not
also be the one who can re-apply a payment. And the operator who asks for a
replay cannot declare it successful — only service_role may finish one.
17 tests.

**An account can be suspended, and given back.** Migration 0082. Until now the
only lever over a company that stopped paying was revoking its entitlement —
the same control used to end a comp — so "three months in arrears" and "the free
year ran out" left identical records and told the customer nothing.

A suspension is **read-only, never a lockout**: they still sign in, still open,
read, print and export every estimate, project and document they ever made, and
cannot add to it until it is lifted. Holding a contractor's own records over an
unpaid invoice is not leverage; it is the thing that makes them tell every other
contractor never to use you. The same reasoning already governs the free tier.

Two texts, deliberately: the note for colleagues and the sentence the customer
sees are different, and `my_suspension` carries only the second. The customer
reads it as a banner before they lose a morning's work, not as an error after.

The guard is a trigger on every table carrying a `company_id`, written as a loop
over the catalog rather than a list — a table added next year is covered without
anybody remembering the file exists — and the migration refuses to finish if it
covered fewer than a hundred. Machine writes are never blocked, because the
Stripe webhook recording the payment is what ends a non-payment suspension, and
a guard that refused it would make one impossible to end by paying. 21 tests.

**Why they left is asked at the only moment anybody will answer.** Migration
0083. The platform could count cancellations and could not say why one
happened, and this is the number a subscription business genuinely cannot go
back for: somebody who left in March will not answer in June. The free-text
comment the cancel screen already sent to Stripe was unreadable from GrounUp
and unaggregatable anywhere.

Three things it is careful about. **What they were worth is captured while it
is still true** — a subscription's items are gone once it ends, so
`app.subscription_monthly_cents` correctly returns nothing afterwards, and this
is the one place in the schema where storing a computed number is right; a test
proves the figure would have been lost had it waited. **"Nobody was asked" is a
recorded answer**, not a missing one: a cancellation arriving through a Stripe
webhook has no reason attached, and filing it under "other" would put a number
beside something nobody said — how often that row appears is itself the useful
figure, because it says how often the question is reaching anybody. **A reason
is a library**, because seventy unique sentences is a report nobody reads twice.

The dialog can never prevent a cancellation. One click leaves, whether or not
anything is answered — a form that held somebody in would be the dark pattern
this platform exists not to be, and they would leave anyway, angrier. 15 tests.

**A card being refused is visible and actionable.** Migration 0084. A
subscription in `past_due` has shown as an orange badge since 0064 and nobody
could act on it: the console could not say how much was owed, why the card was
refused, how many times Stripe had tried or when it would stop — and the
customer was told nothing until the day their access went.

This is the most expensive gap on the platform, because a failed payment is
usually an expired card rather than a decision to leave. They still want the
product and do not know anything is wrong.

Two shapes, held apart. **An attempt is an event**: each refusal is recorded
append-only, because "how many times has this card been declined" cannot be
answered by a column that gets overwritten. **Whether they are still failing is
derived** from the invoice, so paying is what makes the problem stop and no code
has to remember to clear a flag — a test proves it by marking an invoice paid
and watching the row disappear while the history stays.

`app.payment_problems()` is a definer function read by both views rather than a
definer view built on an invoker one, which would have silently applied the
operator's own tenant visibility and shown them an empty screen that looked like
good news. That trap has now been hit twice and is written down in both places.

The customer sees it in the application, in words rather than in Stripe decline
codes, before their access is affected. 17 tests.

**Money can go back to a customer.** Migration 0085. The thing support is asked
for most and could not do at all — a month charged after a cancellation, a
double charge after a card retry, a wrong price — every one of which ended with
somebody logging into Stripe, moving money, and leaving no record in GrounUp of
who decided or why.

What lives here is the decision, not the money. Stripe holds the charge and
knows what is refundable; duplicating that would create a second ledger that
disagrees with the first. GrounUp keeps the part Stripe cannot: who asked, why,
who released it, and whether it worked.

The rule is the same segregation the platform already enforces on upsell
proposals and on approving an estimate: **the person who asks is not the person
who releases**. The superadmin is the stated exception, because they are the
business and a rule that made refunds impossible for a company of one is a rule
people work around in Stripe instead — and it starts applying to everybody else
the day anyone is hired. Sending to Stripe is a third act, and only service_role
can record what Stripe did, so approving a refund and declaring it paid stay
separate.

Two kinds, because they differ: a refund puts money back on the card and cannot
be undone; a credit reduces the next invoice, moves nothing, and is usually what
a customer who is staying would rather have. 22 tests, passing on the first run.

**What the staff did is readable.** Migration 0086. Every operator action has
been audited since 0064, and audited into the *customer's* ledger — deliberately,
so a company can read what was done to them. That is the right place for it and
the wrong place to answer the other question: what did the people I hired do
this week. The records were spread across every tenant's history with no way to
read down the operator axis, and the actions belonging to no tenant at all —
publishing a price, editing a role, taking somebody on — sat in rows with a null
company that nothing ever looked at.

This adds no recording. It is three views over rows that already existed, which
is worth saying because the tempting version is a second log that would
immediately disagree with the first.

One thing it found: counting ledger rows reports every action twice. A single
operator action leaves two entries — the function's own, carrying the reason,
and the audit trigger's, carrying the exact before and after. Both belong in the
ledger; a screen saying somebody opened two customer accounts when they opened
one does not. The summary counts by the thing acted on instead. 13 tests.

**Data can be taken out, and it is answerable.** Migration 0087. An export is
the one action that removes a record from every protection this platform has —
row level security, permissions, support sessions: none of them reach a
spreadsheet on somebody's laptop.

The export itself is unremarkable: the rows come from views that already decide
who may see them, and the button exports what is on screen rather than widening
the query to everything, which would be a quiet escalation dressed as a
convenience. What this adds is the part that was missing. `audit_events` has
carried an `export` action since migration 0001 and nothing had ever written
one; now every export lands in the same ledger as everything else, appears on
the staff activity screen, and — when it concerns one customer — in that
customer's own history.

Recorded rather than restricted, deliberately. Somebody who can read the tenant
list on screen can copy it by hand, and a platform that pretends otherwise is
lying to itself about its own boundaries. And the record holds the shape only,
never the rows: a ledger carrying the export would be a second copy of the thing
the export was worth worrying about.

The CSV writer handles the two things that make real exports go wrong — the
customer whose name has a comma in it, and the field a spreadsheet decides is a
formula. 10 database tests, 7 on the writer.

**The platform can tell everybody something.** Migration 0088. Maintenance on
Sunday, a price change next month, a feature worth knowing about — there was no
way to say any of it. The `notifications` table is the wrong shape: one row per
person per notice means writing a row for every user, more for everybody who
signs up afterwards, and cleaning them all up later. An announcement is one
thing that is true for a while, and who has seen it is a separate, much smaller
fact. So: one row for the message, one per person who cleared it, and a view
that works out what somebody should see now.

**Retracting does not unsend.** Somebody read it; a platform that could make
that untrue is one whose history means nothing. Retracting stops it being shown
and records why.

**Dismissal is one person's.** An estimator clearing a banner must not clear it
for the owner who has not read it, which is what per-company dismissal does and
what makes broadcast features quietly useless.

Three audiences rather than a query builder — everyone, the paying customers,
the free ones — because an audience nobody can describe in a sentence is one
somebody eventually gets wrong, and getting it wrong here means telling the
wrong customers something alarming. A maintenance notice must carry an end
date: a banner about last Sunday is worse than no banner. 20 tests, passing on
the first run.

Still open: a second operator approving a change to a paying customer's
entitlement.

### 3b. What the business is earning — **built**
Migration 0078. The console could count companies and could not say what the
platform earns.

- [x] `app.subscription_monthly_cents()` — from the items Stripe's own webhooks
      mirrored, so revenue is what Stripe bills rather than what the catalog
      wishes it billed. Yearly divided by twelve, and the screen says so.
- [x] `admin_revenue_by_company`, `admin_revenue`, `admin_growth`,
      `admin_recent_signups`. 15 tests.

What is given away is counted rather than omitted, and the accounts where
Stripe and GrounUp disagree about the price are counted rather than averaged.

### 3c. Who came, and who tried — **built**
Migration 0080. The console could see customers and nothing of the people who
looked and did not become one, which is most of them.

- [x] `visit_events` and `signup_attempts`, both append-only, both written
      through the only two anon-executable functions besides `submit_lead`.
- [x] `admin_traffic`, `admin_traffic_sources`, `admin_signup_funnel`,
      `admin_failed_signups`, and a Traffic screen. 17 tests.

Three lines held on purpose. **No address and no user agent** — what is kept
about a device is one of three words, and the identifier that groups a browser's
page views is a random value that browser generated for itself and can lose. **A
referrer is reduced to its site**, because a search URL carries somebody's search
terms. **The console and the application are never recorded**, both because they
are not traffic and because a function anybody can call should not confirm which
internal paths exist.

The list worth having is the last one: people who typed their email into the
signup form, got an error, and never came back — with the message they saw.
"Already registered" and "password too short" are opposite problems, and before
this both looked identical from the operator's side, which is to say invisible.

### 3a. Free forever — **built**
Migration 0077. The app is free to install and use; a subscription is what
turns on the half of it that runs a construction company.

- [x] A permanent `free` plan: estimating, takeoff, the master library, leads,
      proposals and documents, two seats, five active estimates, 1 GB, 25 AI
      credits a month.
- [x] `app.effective_plan()` — derived, so a trial that ends lands on free
      rather than on nothing, with no scheduled job to be late.
- [x] Feature gates that refuse the write, on twenty-seven tables, INSERT only.

Two findings this turned up, both fixed:

**`has_entitlement` was called from exactly one place in the platform.** Every
other feature boundary was a claim the database did nothing about, which meant
a paid module was one API call away for anybody with an anon key.

**A lapsed entitlement meant unlimited.** `app.plan_limit` returned NULL when no
entitlement was live, and NULL means unlimited — so letting a subscription lapse
removed every cap it existed to impose. Two tests asserted this as intended
behavior under the heading "a billing gap must not become an outage". The first
half was right; a gap now lands on the free tier instead.

The gates are INSERT-only on purpose. A company whose subscription ends can
still open, read, edit and export every project it ever ran. Holding a
customer's own records hostage to a renewal is not a business model.

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

### 13. Deleting a customer
A tenant cannot currently be deleted. `protect_last_owner` used to block the
cascade and no longer does — migration 0072 tells "the last administrator is
being removed" from "the company is going" — but ten append-only ledgers refuse
a DELETE at any privilege level and several reference `companies`.

That refusal is correct and must stay: an audit trail somebody can erase is not
an audit trail. What is missing is the workflow around it, which is a real piece
of work rather than a foreign key:

  * export what the customer is owed, in a form they can actually use;
  * remove their business data — estimates, projects, documents, costs;
  * reduce the ledgers to something that answers a legal question without
    holding personal data. `audit_events.actor_email` names people, and
    migration 0072 deliberately did not touch it.

Until this exists, a customer asking to be deleted is a manual job, and the
platform has a compliance gap rather than a housekeeping one. Worth saying
plainly: it is the kind of thing that only becomes urgent once somebody asks.

### 14. BIM
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

### 15. Follow-up automation
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

### 16. HRM and payroll
Today this is labor, not HR: `employees`, `crews`, `credentials`,
`time_entries`, `labor_rates`. Missing entirely — no payroll run, no PTO or
leave, no benefits, no performance reviews, no onboarding, no org chart, and no
HR role among the eleven seeded roles.

Payroll is the load-bearing piece and the one with real consequences: it has to
reconcile to approved time entries, post to job cost through the path migration
0044 already built, and never pay from unapproved hours.

### 17. Asset lifecycle accounting
`assets` records `acquisition_cost`, `acquired_on` and `disposed_on`, and
nothing does anything with them. No depreciation schedule, no book value, no
salvage, no disposal proceeds or gain, no transfer between divisions. Recorded
as a gap in the P12 verdict and still open.

### 18. General ledger
No chart of accounts, no journal entries, no trial balance, no bank
reconciliation, no profit and loss, no balance sheet. What exists is
construction job cost and billing that was designed to feed an accounting
system rather than be one — the Finance screen's "Export to accounting" button
is that intent.

Making GrounUp the accounting system is a real change of scope rather than a
gap to fill, and it is last for that reason.
