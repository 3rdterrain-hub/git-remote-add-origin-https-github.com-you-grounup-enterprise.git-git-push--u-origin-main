# Decision log

Material decisions, with the reason, what else was considered, who authorized it,
and what it replaced. Required by `governance/EXECUTION_PROTOCOL.md` §3.

A decision belongs here when reversing it would cost real work, when it
contradicts something previously agreed, or when somebody a year from now would
otherwise ask "why is it like this". Ordinary implementation choices do not.

Newest first.

---

## D-056 · 2026-09-15 · An investigation closes with a cause and an action, or not at all

**Decision.** `app.close_safety_incident` is a separate function from
`update_safety_incident` and requires a root cause and a corrective action of at
least ten characters each. `investigation_state` cannot be set to `closed`
through the ordinary update.

**Reason.** `create_safety_incident` (0162) was the whole write side, so every
incident this platform recorded stayed `open` forever — including every
recordable `notify_recordable_incident` (0035) told the company about, and the
OSHA 300 log is built from these rows.

Given the transitions, the temptation was to expose `investigation_state` as a
dropdown. Rejected: an incident closed without a cause and an action is one
filed rather than fixed, and the next one has the same cause — which is the
entire argument for investigating. Making closure its own act with its own
requirements is the difference between a safety record and a tidy list.

The hint refuses "operator error" by name, because that is the root cause people
write when they have stopped looking.

**Affects.** Migration 0192, `components/safety/incident-investigation.tsx`.

**Status.** Active.

---

## D-057 · 2026-09-15 · A hazard is fixed on the spot or carries an action

**Decision.** `app.record_safety_observation` enforces the schema's own rule —
an unsafe observation must be either corrected on site or carry a corrective
action — and the form states it before the database has to.

**Reason.** `safety_observations` had no writer, so near misses and good catches
could not be recorded at all. Those are the leading indicators: what a company
records here is what it does not have to record as an incident.

The constraint was already in the schema and is worth keeping in words: a hazard
written down and left is a record of somebody walking past it.

**Affects.** Migration 0192, `components/safety/record-observation.tsx`.

**Status.** Active.

---

## D-058 · 2026-09-15 · A test carries what it measured, and a failure stays visible

**Decision.** `app.record_inspection` stores measured values in
`result_values`, refuses a failing test with no explanation, and
`my_inspections` exposes `failed_and_not_retested`.

**Reason.** `inspections` had no writer — no compaction test, concrete break,
pipe test or proof roll could be recorded — while the table carried
`retest_of_id` under the comment that a failed test without a retest leaves the
work unaccepted.

A pass with no numbers behind it is a word; the numbers are what an owner's
engineer asks for when the work is questioned. And a failure nothing has
retested belongs on the list, not discovered at closeout.

**Affects.** Migration 0192, `components/safety/record-inspection.tsx`.

**Status.** Active.

---

## D-053 · 2026-09-15 · A scan is read by eye, not turned away

**Decision.** `ai-analyze-document` uses the text layer where the PDF has one
and sends the pages themselves to the model where it does not. The job records
`read_by: 'text_layer' | 'image'`.

**Reason.** The function refused any set with no text layer — "needs OCR". A
large share of real plan sets are scans, because that is what comes back from a
plan room or a county, so the refusal turned away exactly the drawings that most
need reading. Claude reads a scanned PDF by vision; there was never a technical
reason to decline.

The text layer stays preferred where it exists: it is exact, cheap, and carries
no risk of a misread character. Where there is none, the prompt names the sheets
so findings cite C-101 rather than "page 4", and tells the model to say when
something is not legible rather than guess — a quantity read wrongly off a scan
is worse than one nobody read.

**Alternatives.** Run OCR first and index the text — more moving parts, another
thing to be wrong, and it throws away the drawing itself, which is where most of
the information on a plan sheet actually is.

**Affects.** `supabase/functions/ai-analyze-document/index.ts`,
`components/plans/text-coverage.tsx`.

**Status.** Active. Deployed.

---

## D-054 · 2026-09-15 · A purchase order is worth the sum of its lines

**Decision.** `purchase_orders.committed_amount` and `received_amount` are
recomputed by trigger from `purchase_order_items`, never incremented.
`add_purchase_order_item` is refused once the order is issued, and
`issue_purchase_order` refuses an order with no lines.

**Reason.** Migration 0037 checks the company's signing limit against
`committed_amount` as an order crosses into `issued` — "the commitment a
contractor makes most often, and the one commitment with no signing limit".
Nothing could create a line, so every order was worth $0.00 at that moment and
the limit passed for every order whatever it was really worth. A control that
never refuses is not a control.

Recompute rather than increment is the rule from 0177, 0179 and 0181, and it
matters more here: a drifted committed amount is a signing limit checked against
the wrong number.

**Affects.** Migration 0191, `components/procurement/purchase-order-lines.tsx`.

**Status.** Active.

---

## D-055 · 2026-09-15 · A quote and its leveling are two facts, not one number

**Decision.** `record_rfq_response` stores `quoted_amount` as the vendor gave it
and `leveling_adjustment` separately; `leveled_amount` is generated from the
two. The board ranks on the leveled figure.

**Reason.** One vendor excludes traffic control and another includes it — the
raw numbers are not the same scope, and ranking them is the mistake that awards
the wrong vendor. Folding the adjustment into the quote would lose which number
came from the vendor and which from the estimator, and that distinction is
exactly what somebody asks about when the award is questioned a year later.

`rfq_responses` has carried the generated column since it was written and had no
writer, so nothing was ever leveled.

**Affects.** Migration 0191, `components/procurement/bid-leveling.tsx`.

**Status.** Active.

---

## D-052 · 2026-09-15 · The secret exists once, and the database makes it

**Decision.** `app.create_api_key` generates the key, returns the plaintext in
its one and only result row, and stores nothing but a SHA-256. The screen never
generates a key and there is no way to see one again — not for GrounUp, not for
an administrator, not for the person who issued it.

**Reason.** `api_keys` had carried a hash-only design, a log prefix, scopes, a
rate limit, an expiry, a revocation-with-reason, row level security and a
rewrite guard since migration 0023, and nothing anywhere could create one — so
the authenticated, rate-limited, scoped API this platform sells had never been
usable by anybody, while the page listed five invented keys on a live route.

Generating it in the browser was rejected: a key whose randomness nobody can
account for, which would travel to the server to be hashed anyway. `uuid` is the
entropy source rather than pgcrypto's `gen_random_bytes`, because 0065
established that Supabase installs pgcrypto outside the default search path and
a migration reaching for it unqualified passes locally and fails in production —
the same reason 0166 uses the built-in `sha256()`.

An unknown scope is refused rather than ignored, the rule 0136 and 0139 settled
for jsonb keys. It matters more here: a scope matching nothing would produce a
key somebody believes grants access it does not have, and they would find out at
the worst moment.

**Affects.** Migration 0190, `lib/data/api-keys.ts`,
`components/settings/issue-api-key.tsx`, `pages/app/api-access.tsx`, O-024
(closed).

**Status.** Active. Verified live: a real key issued, listed, and revocable.

---

## D-051 · 2026-09-15 · The catalog is a skeleton, and the company fills it in

**Decision.** The shipped catalog is not seeded with crews, rates or materials.
Instead: `my_service_buildup` says whether a service can produce a cost at all,
the estimate screen says so **before** pricing, and
`app.save_line_buildup_to_library` keeps what an estimator put on a line — on
the service's own assembly, expressed per unit so it scales with the next
takeoff. `app.add_assembly_resource` gives the costed component kinds their
first writer anywhere.

**Reason.** Found by the owner pricing 1,200 tons of aggregate base and getting
$0.00. Every one of the seventeen `assembly_components` inserts in the catalog
is `component_kind = 'task'`, and `app.line_resource_suggestions` (0126) reads
labor, equipment, material and trucking — so all 2,545 shipped services describe
what work happens and carry nothing that costs money. The product's whole
purpose is estimating and out of the box it could price nothing.

Seeding prices was rejected outright. "Never invent a number" is the standing
rule, and a crew and a rate this repository guessed would be a price attached to
2,545 services that nobody could reproduce or defend — wrong in ways nobody
could find, on documents that go to customers.

**What this replaces.** O-002, which recorded the symptom as catalog depth and
left the estimator to discover it from a zero.

**Alternatives.** Seed regional averages — refused, see above. Show a warning
only after pricing — rejected: by then the person has already lost the time.
Block a line whose service cannot price — rejected: an allowance is a legitimate
way to bid, and D-008 already classifies one honestly.

**Affects.** Migration 0189, `components/estimate/no-cost-buildup.tsx`,
`pages/app/estimate-version.tsx`, the library.

**Status.** Active.

---

## D-049 · 2026-09-15 · A control that cannot act says so, and is disabled

**Decision.** `tests/governance/every-button-does-something.test.ts` fails the
build on a `<Button>` with no handler. Where the thing behind a button is not
built yet, the button is `disabled` with the reason in its `title` rather than
left enabled and inert.

**Reason.** The owner found six dead buttons by using the product, after a
session of green test runs. Every test drove the function under the screen and
none drove the screen's own control, so a button with nothing behind it passed
everything. A disabled control with a reason is honest and tells somebody what
to do instead; an enabled one that does nothing is a lie the user finds at the
worst moment.

**What this replaces.** The habit of reporting a feature done because its
database function is tested.

**Affects.** `CLAUDE.md`, six buttons, the governance suite.

**Status.** Active.

---

## D-050 · 2026-09-15 · A customer code is issued by the database

**Decision.** `create_customer` (0188) issues `CUS-nnnn`. `createCustomer` in
the data layer calls it instead of building a code from the name plus four
random characters.

**Reason.** `customers` is unique on (company_id, code), and the screen was
picking the value — `CUS-TOLEDO-A3F9`. Two people adding the same outfit on the
same morning is exactly when a guess collides, and lead conversion already
numbered CUS-nnnn, so the two paths disagreed about what a customer code looks
like. It is also why a real customer list read as a jumble.

**Affects.** Migration 0188, `lib/data/estimates.ts`, every customer added from
here on. Existing codes are left alone: they are what appears on documents
already sent.

**Status.** Active.

---

## D-047 · 2026-09-15 · A fuel ticket is flagged, never refused

**Decision.** `app.record_fuel` writes the row and sets
`fuel_transactions.exception_flag` to one of the four values the schema has
allowed since 0015 and nothing ever set: no machine on the ticket, a meter that
reads below the machine, a volume far outside that machine's own fill history,
or the same ticket keyed twice. It refuses none of them.

**Reason.** The money was spent whether or not the ticket makes sense. Refusing
the row loses the cost — it reappears on a card statement nobody can reconcile.
Accepting it silently loses the question. Writing it with the exception stated
keeps both. The outlier test is against the machine's own last twenty fills and
only when there are at least five, because a threshold somebody picked would be
a guess dressed as a finding.

**Alternatives.** Refuse an unattributable ticket — rejected above. Flag on a
fixed gallon threshold — rejected: a pickup and a scraper are not comparable.

**Affects.** Migration 0186, `components/fleet/record-fuel.tsx`.

**Status.** Active.

---

## D-048 · 2026-09-15 · A meter may only go backwards when somebody says the unit was replaced

**Decision.** `app.record_meter_reading` carries `p_is_replacement`, stated by
the caller and never inferred. A reading below the current meter without it is
refused by the trigger from 0015. A fuel ticket whose meter reads low is flagged
`meter_regression` and does **not** create a reading at all.

**Reason.** A machine cannot un-run hours, so a low reading is one of two
things: a replaced unit, or the wrong unit number keyed. Guessing between them
writes off a machine's service history — every interval is measured from that
number, so a silently accepted low reading makes every service on it look
freshly done. The fuel path is the dangerous one, because a mis-keyed unit
number is the most common data error in a fleet, and it would have been the
quiet route by which hours went down.

**Affects.** Migration 0186, `components/fleet/asset-detail.tsx`.

**Status.** Active.

---

## D-046 · 2026-09-15 · A baseline may only be taken from a calculated schedule

**Decision.** `app.take_schedule_baseline` refuses a project with no
`schedule_calculations` row, and records which calculation the snapshot came
from. The dates it stores are the engine's early dates where they exist, falling
back to the planned ones.

**Reason.** A baseline is what every variance figure is measured against for the
rest of the job, and what a delay claim is eventually built from. Planned dates
somebody typed are a proposal; freezing them would make each later variance a
comparison against a guess, and the report would look identical either way. The
same reasoning 0029 gave for float — asserted, not computed — applies to the
dates a baseline preserves.

**Alternatives.** Allow it and warn — rejected, because a warning is not read
six months later by the person reading the variance. Require it only for the
first baseline — rejected: a recovery schedule is exactly when the number
matters most.

**Affects.** Migration 0185, `components/schedule/baselines.tsx`, O-019 (closed).

**Status.** Active.

---

## D-044 · 2026-09-15 · An empty list and a broken query look identical, so the selects are checked

**Decision.** `tests/governance/a-select-names-columns-that-exist.test.ts`
parses every embedded relation in `apps/web/src/lib/data/*.ts` and fails the
build when one names a column its table does not have.

**Reason.** `loadResourceAssignments` asked for `assets(code, name)`. The column
is `asset_number`. PostgREST refuses the whole request when one column in it is
unknown, so that reader returned nothing from the day it was written, and the
Resource-loading tab showed an empty list — which is exactly what it shows when
nobody is on the job. `loadMachineFiles` had the same mistake against the same
table. Neither was caught by a test, because a component test mocks the loader,
and neither was caught by eye. Both were found by putting the first real row
into `resource_assignments` and noticing it did not arrive.

**Alternatives.** Generate the data layer from the schema — larger than the
problem. Check top-level column lists too — rejected: they are aliased, renamed
and computed often enough that the parser would produce more noise than
findings, and the embed is where the mistake actually happens, because the table
name is right there to be read and the column list gets copied from whichever
loader was nearest.

**Authorized by.** The standing instruction that the permanent solve is taken
when it is within reach.

**Affects.** `lib/data/schedule.ts`, `lib/data/survey.ts`, the governance suite,
`CLAUDE.md`.

**Status.** Active. Proven against the bug it was written for by reintroducing
it and watching the test fail.

---

## D-045 · 2026-09-15 · A split span is allowed; a double booking is not

**Decision.** `assign_resource` and `update_resource_assignment` refuse a span
that overlaps one the same resource already has on the same activity.
`app.assert_resource_is_free` is the check, in the writer rather than in a
constraint.

**Reason.** Found by using 0183 rather than reading it: assigning the same crew
twice was accepted silently, and two rows each claiming 100% of one crew over
the same days make every loading report count one crew as two. The refusal is
deliberately narrow — a resource genuinely appears more than once on an
activity, because two weeks on, a fortnight away and two weeks back is three
spans. What cannot be true is two spans that overlap.

**Alternatives.** An exclusion constraint — tidier, but it needs `btree_gist`
and a `daterange`, and the table stores two date columns that five readers
already select by name. The check in the writer can also say which resource and
which days rather than naming a constraint.

**Affects.** Migration 0184.

**Status.** Active.

---

## D-043 · 2026-09-15 · A hand edit does not clear the float

**Decision.** `app.update_schedule_activity` writes no engine output. Moving a
bar leaves `total_float_days`, `free_float_days`, `is_critical` and
`calculation_id` exactly as the last calculation left them, and the screen
reports the float as stale by comparing the activity's `updated_at` to the
calculation's `calculated_at`.

**Reason.** The obvious alternative was to blank them on an edit so nothing
stale is ever shown. That is still *writing* an engine output, and migration
0158's trigger refuses it — correctly. A function that talked its way past the
guard would be the hole the guard exists to close. And a blanked float cannot be
judged: "not calculated" and "calculated before you moved this" are different
facts, and only one of them tells a scheduler to press the button.

**Alternatives.** Clear the float inside `app.engine_is_writing()`; add a
`float_is_stale` column; refuse the edit until recalculated.

**Authorized by.** Migration 0158's own reasoning, applied as written.

**Affects.** `update_schedule_activity`, `schedule.tsx`, the activity editor.

**Status.** Active.

---

## D-042 · 2026-09-15 · One activity per task, joined by the key that was always there

**Decision.** `project_tasks` is the cost object — budget, actual hours, percent
complete. `schedule_activities` is the time object — dates, duration, float,
critical path. `app.build_schedule_from_tasks` creates one activity per task and
fills in `schedule_activities.project_task_id`, which has referenced
`project_tasks` since migration 0015 and had never been populated by anything.
`task_dependencies` (0007) is left unused rather than given a second writer.

**Reason.** The two tables had been drifting into duplicates: `project_tasks`
carries `planned_start`, `planned_finish` and `is_critical_path`, and
`task_dependencies` duplicates `schedule_dependencies` field for field. Two
tables answering "when does this happen" is two answers, and the one nobody
calculates wins by accident. Splitting them on cost versus time keeps each
answer in one place, and the FK that joins them already existed.

**Alternatives.** Schedule `project_tasks` directly and retire
`schedule_activities` — rejected: the engine, the baselines, the calculations
and the variance report are all written against `schedule_activities`. Keep both
dependency tables — rejected for the same reason.

**Authorized by.** Stated to the user before building, at "start on schedule".

**Affects.** Migration 0183, the schedule page, O-018.

**Status.** Active.

---

## D-040 · 2026-09-15 · A field report can be filled in, and handed in

**Decision.** Migration 0182 gives `daily_report_labor` and
`daily_report_equipment` their first writers, and `submit_daily_report`
performs the freeze. A submitted report refuses further change; an empty one
cannot be submitted.

**Reason.** `create_daily_report` made the header and said why it left it open —
"submitting is what freezes it, and a report created already frozen could never
be filled in." Nothing was ever built on that. **No writer for the crews, none
for the machines, and nothing that could set `submitted_at`**, so a
superintendent could create a day and then do nothing else with it.

The cost was larger than the missing form. `reporting_labor_reconciliation`
(0044) compares the hours a field report claims against approved timecards and
**is read by the Workforce screen**. With no writer on the report side it could
only ever answer "no daily report" — for every project, every day — a
reconciliation with one side permanently blank, presented as a finding.

**Details.** A crew line takes a classification rather than a person: a daily
report is what a superintendent writes at the end of the day, and naming every
individual is the timecard's job — asking for it here is how a field report
stops being filled in. Operating, idle and down hours are kept apart because
only one of the three is productive; a machine that idled for six hours cost
money and moved nothing, and folding them together loses the distinction that
makes the number worth recording.

**Considered.** `my_report_labor` and `my_report_equipment` views. Written and
removed before the migration was applied: the crews and machines already come
back embedded on the report `loadDailyReports` reads, and a second way to read
the same rows is how two screens come to disagree about one day.

**Affects.** `daily_reports`, `components/project/field-report-detail.tsx`.

**Status.** Active. Migration 0182, 11 db tests.

---

## D-041 · 2026-09-15 · A form is not reset by a refetch, and a tab is not rendered without a trigger

**Decision.** Two guards, both from defects found by driving the running app
rather than by reading it.

**A tab body with no trigger fails the build.**
`tests/governance/every-tab-can-be-reached.test.ts` walks every `.tsx` file and
refuses a `TabsContent` with no matching `TabsTrigger`, or a trigger opening
onto nothing.

**Reason.** The project page grew a "Budgeted work" tab whose content rendered
into a tab nobody could select — an edit that silently matched nothing. Nothing
failed: the page looked complete, 5,000 tests passed, and the feature was
invisible. That is the door defect in different clothes — a door with no reader
is a function nothing calls; a tab body with no trigger is a screen nothing
opens — so it gets the same treatment as `build-door-inventory.mjs`.

**A form keyed on a query result is keyed on its id, not the object.**
`BrandingSettings` reset its fields whenever the company object's identity
changed, and `refetch()` hands back a new object every time — so a refetch
landing mid-typing wiped what had been typed back to the stored value. It
surfaced as an intermittently failing test, which is the cheap version of the
same bug: in the application it is somebody's edit disappearing under them.

**Status.** Active. 3 governance tests; the branding suite green on three
consecutive runs.

---

## D-039 · 2026-09-15 · A change order is worth the sum of its lines

**Decision.** `app.add_change_order_item` is the only writer of
`change_order_items`, and a trigger recomputes `change_orders.cost_impact` and
`price_impact` as the sum of them. Cost and price are asked separately. Pricing
stops when the change order is approved or executed.

**Reason.** Both header columns have existed since migration 0007 under a
comment reading "Priced by the same deterministic engine as the base estimate",
and `change_order_items` since 0013 with row level security, a tenant trigger
and an index. **Nothing ever wrote an item.** `create_change_order` prices
nothing — correctly, since a change order is raised before anybody knows what it
costs — and nothing was ever built to price it afterwards.

So every change order this platform raised was worth **$0.00, permanently**. A
change order at zero does not look broken: it looks like one nobody has priced
yet, on a screen offering no way to price it, while rolling into the revised
contract value as a real zero.

**Recomputed, never typed** — the rule from 0170, D-034 and D-037. A typed
impact stops agreeing with its own detail the first time a line changes.

**Cost and price are separate questions.** The cost is what the work takes; the
price is what the owner is asked for; the gap is the margin on the change, and
it is exactly the number that disappears when only a total is shown. Leaving the
price out gives a change order done *at cost* — a real decision, and visible —
rather than defaulting to zero, which would make "done for nothing" and "not
priced yet" the same number and reintroduce the defect being fixed.

**A line prices from its rate where it has one.** A line stating both a rate and
a total can disagree with itself, so quantity times unit price wins.

**And it stops when the change order does.** `forbid_executed_change_order_edit`
(0032) freezes the impact of an approved or executed change order because that
figure is the amendment to the contract. Items cannot be added or removed
either, and the recompute leaves a frozen header alone rather than fighting the
trigger protecting it — a trigger arguing with a trigger produces a message
about neither.

**Affects.** `change_order_items`, `change_orders`,
`components/project/change-order-pricing.tsx`.

**Status.** Active. Migration 0181, 11 db tests.

---

## D-038 · 2026-09-14 · The field says what it did, in quantity and hours

**Decision.** `app.report_production` (migration 0180) is the only writer of
`production_actuals`: one crew, one task, one day — quantity installed and the
crew hours it took. The unit comes from the task, never from the caller. One
report per task per day, enforced by a partial unique index; a second amends the
first rather than stacking on it. `withdraw_production_report` takes a day back.

**Reason.** Migration 0179 made progress real — actuals roll up onto the task
and the earned-value view stays silent until something is reported — and left
the loop open at the top. **Nothing anywhere inserted a `production_actuals`
row.** The rollup had no source, so every project would have stayed unreported
forever and 0179 would have fixed the false alarm by making the screen
permanently blank instead.

`record_production_actual` (0115) looks like the writer and is not: despite the
name it records a production *rate into the library* — quantity per hour, sample
size, utilization. That is a different act, by a different person, for a
different purpose. A superintendent closing out a day is not calibrating a
library.

**The hours are required.** A quantity with no hours against it cannot become a
production rate, and the rate is the one thing this platform has never had: what
this company's own crews actually achieve, as opposed to what a catalog says
they should. `actual_per_hour` is generated on the row so it cannot disagree
with its own inputs, and `my_production_reports` sets it beside the budgeted
rate — which is the whole of production reporting. Not "are we done" but "are we
going at the speed the price assumed".

**The unit is taken from the task.** A day reported in feet against a task
budgeted in cubic yards rolls up into a percentage that means nothing, and the
person typing has no reason to be the one who gets that right.

**Considered.** Letting a day stack, so two entries sum. Rejected: somebody
remembering another forty yards at five o'clock is correcting the day, not
having a second one, and a stacking model makes a correction indistinguishable
from a duplicate.

**Affects.** `production_actuals`, `components/project/budgeted-work.tsx`
(reporting), `components/project/reported-days.tsx` (reading back).

**Status.** Active. Migration 0180, 12 db tests. This closes the loop opened by
D-037 and gives the production-learning path its first real input.

---

## D-037 · 2026-09-14 · An index computed from nothing is an accusation, not a measurement

**Decision.** `project_tasks.percent_complete`, `installed_quantity` and
`actual_hours` are recomputed by trigger from `production_actuals` — what the
field reported, summed, never incremented. `reporting_project_earned_value`
returns **null** for earned value, percent complete and both performance indices
until production has been reported against at least one task, and exposes
`tasks_reported` so a screen can say which case it is in.
`my_project_task_progress` lists the budgeted work.

**Reason.** `percent_complete` is `not null default 0` and **nothing had ever
written it** — no migration, trigger, function or screen. The view guarded on
`sum(budgeted_cost) > 0`, which is true of every awarded project from the moment
it is awarded. So on every job the company ever won: earned value $0, progress
0%, and the instant any cost posted — one timesheet, one fuel burn — a cost
performance index of 0.00 and a red banner reading *"spending faster than the
work is earning… that gap is margin fade"*.

**A permanent false alarm on every job**, saying the work was losing money when
it was saying nothing at all. A screen that cries wolf on every project teaches
the people reading it to stop reading it, which costs more than the missing
feature ever did.

Two faults, both fixed: the number had no writer, and silence was being reported
as zero. The path already existed unjoined — `production_actuals` records
quantity installed and crew hours against a task, `record_production_actual`
writes one, and nothing rolled them up.

**Considered.** Silencing the banner alone. Rejected: the banner is right to
exist, and a number with no writer would still have rendered 0% everywhere else.
Also considered letting a person type a percentage. Rejected under "derive,
don't store" — a percentage typed by hand disagrees with the quantities the
field reported the first time anybody corrects a day.

**Details.** Status moves not-started → in-progress → complete from the reports,
but a status set deliberately (`blocked`, `on_hold`) is never overruled: the
field saying "we did 40 feet" is not the field saying "carry on". The percentage
is capped at 1 while the quantity is not, because a task can exceed its budgeted
quantity and a percentage over 100 breaks both the check constraint and every
chart reading it. `tasks_reported` had to be appended to the view rather than
placed where it reads best — `create or replace view` can only add columns at
the end.

**Affects.** `reporting_project_earned_value`, `project_tasks`,
`pages/app/project-detail.tsx`, `components/project/budgeted-work.tsx`.

**Status.** Active. Migration 0179, 10 db tests.

---

## D-036 · 2026-09-14 · The thing being measured is not the shape that measures it

**Decision.** `takeoff_conditions` (migration 0178) is the object between a
traced shape and an estimate line. It owns the name, the style, the unit, the
**color**, and the dimensions a drawing does not supply. Creating one creates
the line it prices on. Many shapes file under one condition; the line is their
sum. `reassign_measurement` moves a shape between conditions and corrects both
lines.

**Reason.** A site plan is not forty estimate lines. It is eight or ten things —
six-inch sidewalk, curb and gutter, light-duty pavement — each traced in several
places. Applying a shape straight to a line made the estimator repeat that
association once per shape and left forty lines to merge.

Research across On-Screen Takeoff, PlanSwift, STACK, eTakeoff and Procore found
all five have this object and all five make you pick it **before** tracing. That
order is forced, not stylistic:

  * the condition owns the **color**, and forty overlapping traces are
    unreadable unless each already knows what color it is — coloring by *kind*,
    as this platform did, makes every area on a sheet the same violet
  * it owns the **depth**, and no traced polygon becomes cubic yards without
    one; asking afterwards means asking once per shape

On-Screen Takeoff's governing rule is the one to keep: **each unique object on a
plan is one condition.** One "6-inch sidewalk", traced twelve times, one
quantity.

**Considered.** Making the condition a master-library record first. The user
chose per-estimate first, then library reuse. `estimate_version_id` is nullable
for exactly that: not null is this estimate's, null is the library's — the same
table, no migration when reuse is built.

**Also considered** trace-then-assign as the main path. Rejected on the evidence:
every product has it only as a *correction* (OST "reassign to a different
Condition", eTakeoff "T to set the trace"). `reassign_measurement` is that, and
is not the door tracing goes through.

**Depends on D-034.** The line is the sum of its measurements. Without that, a
condition traced twelve times would still have priced as one.

**Affects.** `takeoff_measurements.condition_id`, `pages/app/takeoff.tsx`,
`components/takeoff/condition-list.tsx`, `components/takeoff/overlay.tsx` — where
a per-condition color has to come through `style` rather than an SVG attribute,
because a Tailwind `stroke-*` class beats a presentation attribute and would
have silently won.

**Status.** Active. Migration 0178, 13 db tests, 13 web tests. Open: "Continue
With" — one condition carrying sections across several sheets with a running
total — and library reuse.

---

## D-035 · 2026-09-14 · The wheel zooms about the cursor, and the space bar grabs the sheet

**Decision.** `lib/canvas-navigation.ts` owns the arithmetic: `zoomAt` keeps the
point under the cursor still, `fitToWidth` shows the whole sheet, `wheelFactor`
turns a notch into a factor, `panBy` moves the paper with the hand. The wheel
zooms, space or the middle button pans, ⌘+/−/0 work, and a sheet opens fitted.

**Reason.** Zoom was two buttons stepping 25%, and the sheet scrolled in a plain
container. On a 24×36 civil sheet that is unusable: every step pushed what you
were looking at toward the edge, because the container grows from its top-left
corner and the thing under your cursor is nowhere near it. Research across
On-Screen Takeoff, PlanSwift, Bluebeam Revu, eTakeoff and STACK found
zoom-to-cursor to be the one behavior all of them share.

A sheet also opened at 100%, which on a full-size civil drawing is a corner of
the title block with no way to tell which way north points.

**Considered.** Hijacking the wheel entirely. Shift+wheel is left as a sideways
scroll, and a native listener is used because React's `onWheel` is passive and
cannot `preventDefault` — without which the page scrolls under the zoom.

**Affects.** `pages/app/takeoff.tsx`.

**Status.** Active. 16 tests, including that zoom in then out returns to the
same place.

---

## D-034 · 2026-09-14 · A line is the sum of the measurements applied to it

**Decision.** `apply_takeoff_to_line` no longer writes the line's quantity at
all. A trigger on `takeoff_measurements` recomputes
`estimate_line_items.measured_quantity` as the sum of every measurement pointing
at that line. `unapply_takeoff` takes one back off, keeping the tracing.
Measurements in a different unit from the ones already on a line are refused.

**Reason.** It overwrote. Trace the six-inch sidewalk in twelve runs, apply each
to the sidewalk line, and the line held the twelfth — silently. **A number that
looks right and is not.**

The function's own author knew a line takes more than one measurement: the
comment above `source_references` reads "Appended rather than replaced: a line
may be supported by more than one measurement, and dropping the others would
lose the argument." The citations accumulated and the quantity did not.

Measuring one thing in several places is not an edge case, it is what a site
plan is — a sidewalk in twelve runs, curb on four streets, pavement in three
lots. Every takeoff product built for estimators accumulates.

**Recomputed, never incremented** — D-026's rule and 0170's. An increment drifts
the first time anything is deleted, retraced or applied twice, and a trigger
means no writer can go round it. `my_line_measurements` breaks the total down
sheet by sheet, because a quantity nobody can break down is a quantity nobody
can check, and because two identical rows on one sheet is a run traced twice
and no total would ever say so.

**Considered.** Summing in a view rather than storing. Rejected: the engine
prices from `measured_quantity`, and a generated column cannot be written by
`update_estimate_line`, which an estimator still needs for a quantity that did
not come off a drawing.

**Affects.** `apply_takeoff_to_line`, `takeoff_measurements`,
`components/takeoff/taken-off.tsx`, `components/estimate/quantity-breakdown.tsx`.

**Status.** Active. Migration 0177, 9 db tests.

---

## D-033 · 2026-09-13 · A card that opens on a condition is controlled, never `defaultOpen`

**Decision.** Any `CollapsibleCard` whose open state depends on loaded data
holds it in state — `openedByHand ?? (query.status === 'ready' && condition)` —
and passes `open` / `onOpenChange`. `defaultOpen` is for a fixed choice only.

**Reason.** `Card` reads `defaultCollapsed` once, in `useState(!defaultCollapsed)`.
At mount the query has not answered, so the condition is false, so the card
mounts shut **and never opens** — on precisely the record that met the
condition. Found three times in one evening: the document conflicts panel, the
activity log, and the staffing gaps card, where a card meant to open when
somebody is on site uncovered would stay shut on the day it mattered.

**Considered.** Making `Card` react to a changed `defaultCollapsed`. Rejected:
that changes behavior for every card in the application, including ones a person
has deliberately shut, and "default" that keeps re-asserting itself is not a
default.

**Affects.** `components/estimate/document-conflicts.tsx`,
`components/crm/activity-log.tsx`, `components/workforce/staffing-gaps.tsx`.
No other conditional `defaultOpen` remains in the tree.

**Status.** Active.

---

## D-032 · 2026-09-13 · The pipeline is worked, and a loss says why

**Decision.** Migration 0175 gives `opportunities`, `contacts` and
`crm_activities` their writers: `move_opportunity_stage`, `update_opportunity`,
`save_contact`, `retire_contact`, `log_crm_activity`, `complete_crm_activity`,
read through `my_pipeline`, `my_contacts` and `my_crm_activities`. Closing one
as **lost requires a reason**, and the winning competitor is captured beside it.

**Reason.** All three tables date from migration 0005 and were unreachable.
`opportunities` has eight stages in a check constraint and one writer in the
entire system — `convert_lead`, which inserts at `identified` — so every
opportunity sat where it was born, the win-rate tile could only ever read zero,
and the loss-reason line beneath it never rendered for anybody. `contacts` had a
customer-or-vendor constraint, a one-primary partial unique index and two
indexes, and never held a row, while the plan blurb sells "customers, contacts
and the lead intake form". `crm_activities` had an index on
`(company_id, due_at) where completed_at is null` — built to answer "what is due
next" for a list nobody wrote.

A loss with no reason is the only figure in a contractor's CRM that never
improves, because the reason is the sole data that answers whether the number
was wrong or the relationship was. The database refuses it, rather than the form.

**Details worth keeping.** The previous primary contact is stood down **before**
the new one is written — the partial unique index fires on the insert itself, so
doing it afterwards means the database refuses the new primary and the tidy-up
never runs. A contact is archived rather than deleted. `days_in_stage` is
computed in the view, because six weeks in "proposed" is what a pipeline review
hunts for and it is a function of two dates, not a column somebody maintains.

**Affects.** `crm-live.tsx`, `lib/data/crm-pipeline.ts`, three new components.

**Status.** Active. Migration 0175, 19 db tests, 24 web tests.

---

## D-031 · 2026-09-13 · What the customer sees is decided when the proposal is issued

**Decision.** `app.issue_proposal` takes `p_show_line_detail` and
`p_show_unit_prices`, and the issue dialog asks. `open_proposal_by_token` shows
the estimator's client wording — `estimate_line_items.notes` — falling back to
the line's own description.

**Reason.** Two dead controls, found together.

`proposals.show_line_detail` is `not null default false`, `issue_proposal` never
set it, and `enforce_proposal_immutability` permits only status and the
acceptance fields to change afterwards. **So the flag was false on every
proposal ever issued, permanently**, and the branch of `open_proposal_by_token`
that renders lines had never executed for anybody. Every proposal this platform
sent was a lump sum, whether or not that was anybody's intention.

And the estimate line's "Description for client…" box writes `notes`, while
every customer-facing path rendered `description` — so an estimator rewording a
line for a client changed nothing the client would see. The value was in the
database the whole time, read by nobody.

The flags are frozen on issue, correctly, which is exactly why the dialog is
where the question belongs: it is the only moment the answer can be given.

**Considered.** Making the columns editable after issue. Refused — RULE-009, and
the acceptance signature's `document_hash` is a hash of what was on screen.

**A wrong turn, recorded because it cost an hour.** This began as a fix for a
believed immutability hole: `open_proposal_by_token` reads `estimate_line_items`
live, so an issued proposal looked like it could change underneath the customer.
**It cannot.** Migration 0111 froze every child of an approved version,
including against the direct PostgREST write that goes around every function
check — which is the precise route its own header says it was written to close.
A snapshot into `proposal_line_items` was built and then removed. That table
stays empty honestly: it is the right home for proposal alternates and options,
and `app.proposal_base_total` and 0045's integrity check are waiting for it.

The lesson is the repository's own standing one: **search before building.**
0111 and 0045 both existed, and both were found only after the work was done.

**Affects.** `app.issue_proposal` (the four-argument overload is dropped, not
left beside the new one — a silent resolution to the old body is worse than a
missing function), `public.issue_proposal`, `open_proposal_by_token`,
`estimate-version.tsx`.

**Status.** Active. Migration 0174, 7 db tests.

---

## D-030 · 2026-09-13 · The proposal PDF is the renderer that was already written

**Decision.** `lib/data/proposal-pdf.ts` assembles what the Proposals screen
already holds into `renderProposal`'s input and hands the bytes to the browser.
Both the internal screen and the customer's signing page download it. No
arithmetic: the total is the frozen figure the engine wrote.

**Reason.** `renderProposal` has been in `packages/pdf` since the package was
written — letterhead, line table, inclusions, exclusions, terms, and a theme
taken from `Branding.primary` / `Branding.accent`. It is complete and tested,
and **its only callers were its own tests.** The Proposals screen carried a
button labeled "PDF" with no `onClick` on it at all, and `proposals.storage_path`
has existed since 0006 unwritten.

The customer gets the download too, because the share link expires and the page
behind it stops answering. A proposal somebody accepted and can no longer read
is not a record of anything.

**Considered.** Rendering server-side into `proposals.storage_path`. Deferred
rather than rejected — the function is pure and takes a clock, so the same
proposal regenerates byte-identically years later, which is the property that
makes storing it optional rather than urgent. A test pins that property.

**Affects.** `proposals-live.tsx`, `sign-proposal.tsx`, `packages/pdf`.

**Status.** Active. 11 tests.

---

## D-029 · 2026-09-13 · Branding belongs to the company, and the proposal reads it

**Decision.** `logo_path`, `primary_color` and `accent_color` on `companies` are
edited in Company Settings and read by everything that renders the company's
mark. The logo lives in a **public** `company-branding` bucket (migration 0173),
writable only with `company.manage`. `open_proposal_by_token` carries the three
values to the customer inside the payload it already returns.

**Reason.** All three columns have existed since migration 0002, with a hex
check constraint and a comment saying the logo is a storage path and never a
blob. Across the repository they appeared in exactly one file: the migration
that created them. Every proposal this platform sent went out in the platform's
colors, headed with the platform's logo.

Set on the company rather than per proposal, on the user's instruction ("put the
branding in company settings"), and because two proposals sent the same week
must not disagree about what the company looks like.

**The bucket is public deliberately.** `project-documents` is private because a
plan set is a customer's competitive position. A logo is the opposite — it is
the mark on the side of the trucks — and it has to render for somebody with no
account opening an emailed link. A signed URL that expires is a letterhead that
vanishes from a document the customer keeps.

**Considered.** A `my_company_branding` view. Written and then removed before
the migration was applied: the columns are already on the row
`loadCompanyProfile` reads, and an anonymous caller cannot select from a view at
all. A second way to ask one question is how two screens come to show different
colors.

**Superseded.** The Branding tab in Company Settings, which had
`defaultValue="#111827"` in the markup, swatches painted by a fixed CSS class
rather than by the color, and a Save button whose handler set a dirty flag to
false. The page-level "Save changes" button went with it — it existed only for
those boxes.

**Affects.** `companies`, `open_proposal_by_token`, `components/settings/branding.tsx`,
`sign-proposal.tsx`, `proposals-live.tsx`, `lib/data/company.ts`.

**Status.** Active. Migration 0173, 12 tests.

---

## D-028 · 2026-09-13 · A sheet's text is read by the file, not by a model

**Decision.** `document_sheets.extracted_text` is written by
`record_plan_set_text` (migration 0172) from the PDF's own text layer, extracted
in the browser with the `pdfjs-dist` already loaded to count pages.
`document_extractions` records each run — what read the sheet, what it
concluded, what it found — and the two are written in one call so they cannot
drift. A reading that found nothing records the run and **does not** blank text
an earlier run read.

**Reason.** The column has carried a GIN trigram index since migration 0005 and
a snippet-building search function since 0036, and was given a public wrapper
and a screen in 0147. **Nothing has ever written it.** "Search the drawings"
returned nothing for every company, for every term, for the life of the
platform — and a search that finds nothing looks exactly like a job with no silt
fence on it, which is why four green layers never caught it.
`ai-analyze-document` was substituting the literal string "(no text extracted
from this sheet)" for every sheet, so the model was being asked to analyze a
plan set it could not see, and billed for it.

The text layer is deterministic, exact, needs no key, and costs nothing on a
pass the upload already makes. A set plotted out of CAD carries its annotation
as real text. A model may supersede that later with a better reading of a scan;
`document_extractions` keeps both and says which produced which — which is what
its own header asked for in 0019 and never got.

**Considered.** Having the model do the extraction. Rejected as the first
writer: it needs a key that is not set, it costs money per page, and it would
make the searchability of a drawing depend on a judgment. Also considered
pulling sheet numbers out of the extracted text with a pattern — rejected under
"never invent a number"; naming a sheet stays the manual path of D-023.

**Affects.** `lib/data/plans.ts` (`readPdf` replaces `countPdfPages`, one pass
instead of two), `components/plans/text-coverage.tsx`, `ai-analyze-document`
(now refuses a set nothing has read rather than spending a credit to read
nothing).

**Status.** Active. Migration 0172, 11 db tests, 11 web tests.

---

## D-027 · 2026-09-13 · A tool change keeps the work the next tool needs

**Decision.** `afterToolChange` in `lib/takeoff-tools.ts` owns what survives a
change of takeoff tool: stepping into Deduct parks the outline and starts a
fresh ring, stepping back to an area or a volume restores the outline and keeps
what was banked, and stepping anywhere else drops all three.

**Reason.** The page cleared `points` going into Deduct — losing the outline the
opening was being cut out of — and cleared `deductions` coming back. Between the
two, an opening could never reach `measure`, so the Deduct tool subtracted
nothing and the "2 opening(s) will be subtracted" line under it was never true.

**Considered.** Fixing it in place in the event handler. Rejected: a rule inside
a handler is a rule with no test, and this one has three cases.

**Affects.** `pages/app/takeoff.tsx`.

**Status.** Active. 7 tests.

---

## D-026 · 2026-09-13 · A callback that runs now may not read a binding from later

**Decision.** `tests/governance/a-value-is-not-read-before-it-exists.test.ts`
walks the syntax tree of every file under `apps/web/src` and fails the build
when a callback passed to an immediately-invoking array method reads a
block-scoped binding declared further down the same function body.

**Reason.** `takeoff.tsx` derived the sheet's measurements eight lines above the
`const [sheetId]` it filtered on. `Array.filter` runs its callback during the
component body, so every render in which the query had answered threw
`ReferenceError: Cannot access 'sheetId' before initialization`. **The takeoff
screen crashed for every company that had ever saved a measurement and worked
perfectly for every company that had not** — which is why it survived a green
gate.

TypeScript cannot catch this: it refuses a direct read before a declaration
(TS2448) and deliberately permits one inside a closure, because in general a
closure runs later. The listed array methods are the case where it does not.

**Considered.** A one-off test rendering the takeoff page. Rejected as the
smaller half of the fix — it would prove this instance and nothing about the
next one. There is no ESLint in this repository; governance tests are how rules
are enforced here.

**Affects.** Every file under `apps/web/src`. Found one further candidate on the
first run (`import-panel.tsx:141`), which proved to be a local shadowing a later
outer name — the check now stops at nested function boundaries.

**Status.** Active. 3 tests, including one that fails on the original shape.

---

## D-025 · 2026-09-13 · A saved measurement's quantity is recomputed, never remembered

**Decision.** `lib/takeoff-quantity.ts` resolves what a kept measurement comes
to by calling the same `measure` / `measureBasin` that produced it, from the
geometry, deductions, pitch, depth, width, count and repeats on the row plus the
calibration it was traced against. `TakenOff` shows that number and applies that
number. `loadCalibrations` — written since the takeoff screen was built and
called by nothing — is what makes it possible.

**Reason.** The panel applied `appliedQuantity ?? multiplier × countPer`, and
nothing writes `applied_quantity` until a measurement is *already* applied. So
every apply from that panel sent `1`. **A traced 1,240 SF pad went onto the
estimate as one square foot**, and the Quantity column read "not applied" on
every kept shape — the one thing a takeoff list must never say about something
already traced.

This is D-013's rule again ("derive, don't store"): the answer is not a column,
it is a function of the inputs, and the inputs are all on the row.

**Considered.** Writing the resolved quantity to the row at save time. Rejected:
a shape can be retraced, and a stored quantity then disagrees with its own
geometry with nothing to say which is right. Where a line *has* been given a
quantity and the shape has since moved, the column now shows both and says so.

**Affects.** `components/takeoff/taken-off.tsx`, `lib/data/takeoff.ts`
(`lifts` and `freeboard_feet` now carried, because a basin is prismoidal and
cannot be recovered from its outline), `pages/app/takeoff.tsx` — which now
shares the basin unit mapping rather than keeping a second copy.

**Status.** Active. 16 tests.

---

## D-024 · 2026-09-13 · A conflict is stated from both sides or not at all

**Decision.** `app.raise_document_conflict` refuses a conflict unless all four
of `source_a`, `source_a_says`, `source_b`, `source_b_says` are given, and
`app.resolve_document_conflict` refuses to close one with no resolution text.
`app.conflict_to_rfi` writes the question from both sides and sets
`rfis.conflict_id`, which has pointed at `document_conflicts` since 0006 and was
never written.

**Reason.** The confidence engine has deducted twenty-two points per unresolved
conflict on a line since migration 0033, and nothing in the platform could
record one — so **every bid ever priced here was priced as though the plans, the
specifications, the geotechnical report and the addenda all agreed.** That is
the door defect at its most expensive: not a missing screen, a systematically
optimistic number.

Both sides, because a conflict stated from one side is an opinion and nobody but
its author can settle it. A resolution, because a conflict closed with no answer
is one somebody finds again on the next revision and settles differently.

**Considered.** Letting a conflict be raised free-text on the estimate as a
whole. Rejected: only a conflict naming a line moves that line's confidence, so
an unplaced one records the worry and changes no number. The form says this.

**Affects.** `document_conflicts`, `rfis`, the confidence engine's inputs,
`components/estimate/document-conflicts.tsx`.

**Status.** Active. Migration 0170, 8 db tests, 12 web tests.

---

## D-023 · 2026-09-13 · The sheet name is typed by the person looking at the title block

**Decision.** `app.identify_sheet` writes `sheet_number`, `sheet_title`,
`discipline`, `drawing_scale`, `revision` and `revision_date`. Null leaves a
field alone. `p_source = 'ai_agent'` may fill a blank and may **never** overwrite
what a person put there. `my_plan_sheets` builds the display label once, in the
view, so the picker, the search and anything printed call a sheet the same
thing.

**Reason.** Those six columns have been on `document_sheets` since migration
0005, with an index on `(company_id, sheet_number)` for finding a sheet by the
number printed on it. Nothing ever wrote one. A fourteen-sheet civil set listed
as "p.1" through "p.14", so the estimator had to remember which page was the
site plan — and one omission had four consequences: no name, no printed scale to
start from, nothing to compare across revisions, and nothing to search.

**Considered.** Waiting for the model to read title blocks. Rejected as the
*first* build: it needs a key the user has not set, and typing what is on the
drawing in front of you takes ten seconds a sheet. Authorized by the user —
"build the manual path first". The agent path is the same function with
`p_source = 'ai_agent'`, and RULE-008 is enforced inside it rather than trusted.

**Affects.** `document_sheets`, the takeoff sheet picker, `lib/data/sheets.ts`.
`takeoff.ts` no longer has its own sheet reader — `loadSheets` was deleted and
the picker reads `my_plan_sheets`, so one label is built in one place.

**Status.** Active. Migration 0171, 7 db tests, 7 web tests.

---

## D-022 · 2026-09-12 · The unsuitable fraction is not assumed, and the cross-sections tab is removed

**Decision.** The Survey page reads the stored volumes from
`surface_comparisons`, takes swell and shrink from the company, and passes **no**
unsuitable fraction to `analyzeCutFill`. The Cross sections tab is deleted.

**Reason.** The fixture assumed six percent unsuitable. No column records one —
it is a judgment about a particular site — and on a real job that assumption
moves thousands of yards of import on a number nobody chose. The page says it
assumes none rather than letting a reader think it was considered.

The volumes are read rather than recomputed from the grids, because a browser
recomputing them would eventually disagree with the record the company kept.
Behind that record stands `enforce_surface_datum_match`, which refuses to
compare surfaces on different vertical datums — the volume between them would be
wrong by exactly the datum offset.

**The cross-sections tab had nothing behind it.** It ran the engine's
average-end-area and prismoidal comparison over invented road sections, and no
alignment, station or cross-section table exists anywhere in the schema. The
engine capability is real and tested; the storage does not exist. Removed and
recorded as O-005 rather than left as a picture of a calculation.

**Affects.** `lib/data/survey.ts`, the Survey page.

**Status.** Active. 16 web tests. O-005 open.

---

## D-021 · 2026-09-12 · A generated column is read, and silence is not a low bid

**Decision.** The Procurement page reads `rfq_responses.leveled_amount` and
`inventory_items.quantity_available` rather than recomputing either, measures
the reorder point against *available* stock, and takes the low leveled bid only
across responses that actually arrived.

**Reason.** All three are places where a browser doing its own arithmetic
diverges from the record.

`leveled_amount` is generated as quoted plus adjustment; a page adding those
itself is how a page and a database come to hold different opinions about which
bid was low. `quantity_available` is generated as on hand less reserved, and the
reorder test has to run against it — stock already spoken for will not be there
for the next job, so measuring on-hand hides a shortage until somebody walks to
the yard. And a vendor invited but not yet answering carries a leveled amount of
zero from that same generated column: taking a plain minimum awards the package
to silence.

**Also decided.** The New RFQ and Purchase order buttons ship **disabled**.
Those tables have no writer, and a test pins the buttons as disabled so nobody
enables them before the writers exist — an enabled control that silently does
nothing is the defect this build keeps producing.

**Affects.** `lib/data/procurement.ts`, the Procurement page.

**Status.** Active. 15 web tests.

---

## D-020 · 2026-09-12 · Float is an engine output, and null float is not zero float

**Decision.** Migration 0158 extends 0058's boundary to the schedule: the early
and late dates, total and free float, the critical flag and the calculation link
on `schedule_activities` are writable only inside
`app.record_schedule_calculation`, granted to `service_role` alone. The planned
dates, durations, logic and calendars stay a person's to write. The
`recalculate-schedule` Edge Function carries the same compiled engine as
`price-estimate`.

**Reason.** 0058 said pricing "is not a privilege some roles have and others do
not: it is an operation only one piece of code may perform, however senior the
person asking." Every word is true of a critical path. 0029 had already required
float to name the calculation that produced it, but nothing stopped a caller
writing a calculation row of their own invention and pointing float at it.

**No second CPM.** `packages/engine/src/schedule.ts` implements calendars, all
four dependency types, lag, constraints and cycle detection. A SQL
reimplementation would be two passes that eventually disagree about a job
somebody has already bid, so the Edge Function pattern was chosen over a
plpgsql one.

**On screen: null float is shown as "not calculated", never as 0.** Zero float
means an activity is on the critical path. Rendering an uncalculated schedule as
zeros would state the opposite of the truth on every row, and the critical-path
tile reads an em dash rather than 0 for the same reason.

**What this superseded.** `data/fleet.ts` held a schedule fixture that ran the
real engine at module load, and `schedule.check.test.ts` asserted the screen
showed a calculation rather than typed numbers. Both are deleted: the page reads
the database, and the property that test asserted about a fixture is now
enforced by a trigger and proven by `the-door-onto-the-schedule.test.ts`.

**Affects.** Migration 0158, the `recalculate-schedule` function, the Schedule
page.

**Status.** Active. 16 db tests, 19 web tests.

---

## D-019 · 2026-09-12 · A project record starts in the state before its workflow, not after

**Decision.** `create_daily_report` leaves the report unsubmitted,
`create_change_order` leaves it `potential` and priced at zero, and `create_rfi`
leaves it `draft`. None of the three dialogs asks for a cost.

**Reason.** Each of those states is what makes the next step meaningful.
Submitting a daily report is what freezes its date (0013), so a report created
submitted could never be filled in. A change nobody has priced is not yet a
claim on anybody. Issuing an RFI starts a clock somebody answers against, and
that is a decision separate from writing the question down. Creating a record in
the state that ends its own workflow is the workflow having no steps.

The cost is the sharpest case: a change order's impact comes from pricing the
change through the same deterministic engine as the base estimate, so a number
typed into a dialog would be a price nobody can reproduce — the same rule as
`record_engine_result` and RULE-008.

**Also decided.** The company is read off the project rather than taken as an
argument, because a caller who can name the company on a write can name one that
is not theirs; and "no such project" is the answer both for a project that does
not exist and one the caller is not a member of, because distinguishing them
tells a stranger whether an id is real.

**Affects.** Migration 0157, the three buttons on `project-detail`.

**Status.** Active. 18 db tests, 12 web tests. Closes O-003.

---

## D-018 · 2026-09-12 · A haul rate is entered, never shipped

**Decision.** The platform ships no haul rates and never will. The company
enters its own, through the Hauling tab, and migration 0156 supplies only the
code generator.

**Reason.** It is not a policy, it is the schema: `trucking_rates.company_id` is
`not null`, so a catalog row cannot exist. That was right — a haul rate is a
position negotiated with a specific trucker, and there is no national default
for one — but it left the table with six readers and no writer. The Hauling tab,
`app.haul_cost`, the haul-profile dialog, `WhatAHaulCosts`, the fleet view and
0151's typed picker all read a table nothing could fill.

**What the screen has to know.** 0067 gave the table three pricing bases and a
constraint that each carries its own figure. The form shows only the figure the
chosen basis prices from — offering all three would invite somebody to fill in
two and wonder which one the bid used — and it says what is missing before the
save, because being told by a CHECK constraint after the fact is worse.

**Why a migration at all.** Only for `app.next_company_haul_code`. Two people
adding a profile at the same moment would read the same highest code and collide
on the unique index. Same shape as `next_company_material_code` in 0127.

**Retire, not delete.** An estimate priced from a rate keeps its library
snapshot, and a profile that vanished would leave those rows pointing at
something nobody could look up.

**Affects.** Migration 0156, the Hauling tab, the trucking picker on every line.

**Status.** Active. 14 db tests, 18 web tests.

---

## D-017 · 2026-09-12 · Catalog prices are shipped as `estimated`, with the unit they are quoted in

**Decision.** The 173 material prices in the company price library
(`07_F_P_MATERIAL_LIBRARY`) ship on the platform catalog as `cost_state =
'estimated'`, and each one carries the unit its own source row states — 133 unit
corrections, applied in the same statement as the price.

**Reason.** Seed 0009 shipped the catalog uncosted and said why: a price list
belongs to the company that negotiated it, and a national average is worse than
nothing. That reasoning was right and its premise was wrong — a second sheet in
the same workbook had a price on every row. Nothing here is invented, averaged
or converted.

`estimated` rather than `quoted` because a quote is a number a supplier stands
behind on a date (0121), and `quoted` would overstate what this is. A company
that wants its own number clicks the cost and 0133 copies the material into
their library, which is the point of the three-tier shape.

**The unit is not separable from the price.** 0009 refused to turn `EA` into
`TON` on a guess — "a per-ton price on a per-each material" makes every estimate
built on it wrong by a factor nobody spots. The guess was what it refused; the
price library states the unit beside the price, so the two move together or not
at all.

**What was deliberately not loaded.** Density except where the source states
lb/CF (×27, the definition of a cubic yard): the sheet states most densities as
lb per unit *sold*, which is a different fact, and loading one into the other
would be the same mistake in another column. 12 of 173 qualify. The 160 catalog
materials with no row in the price library stay `not_costed`.

**Affects.** Migrations 0152 (`CF` as a unit) and 0153 (`CF`, `SET` synonyms),
seed 0013, the material library, every estimate that uses one.

**Status.** Active. 14 tests. 155 catalog materials remain uncosted, down from 328.

---

## D-016 · 2026-09-12 · A library link is cleared by sending it, not by omitting it

**Decision.** In `save_line_resource`, the six library links — `labor_rate_id`,
`equipment_id`, `material_id`, `trucking_rate_id`, `disposal_site_id`,
`vendor_id` — are applied on update by *key presence* rather than through
`coalesce`. Sending `material_id: null` removes the link. Every other field
keeps `coalesce`.

**Reason.** `coalesce(new, old)` cannot express "set this to nothing": null
means "I did not send this", which is right for a number somebody left alone and
wrong for a link somebody is removing. A row renamed by hand is no longer the
library row it came from, and `capture_library_snapshot` reads that link to
record what priced the version — so a stale link is not untidiness, it is an
audit trail that names the wrong material as the thing that priced the bid.

**Alternative rejected.** A separate `unlink_line_resource` function. It would
have made renaming a row two calls that must both succeed, and the second one
failing would leave exactly the state this is meant to prevent.

**What it superseded.** Migration 0139 listed all six as accepted fields and the
UPDATE branch mentioned none of them — so sending one returned success and
changed nothing. That is the same shape as the `markupOverride` defect 0139 was
written to stop: the guard asks whether a key is *known*, not whether it is
*applied*.

**Affects.** Migration 0151, `ResourceName`, every wrench-panel tab.

**Status.** Active. 9 db tests, 11 web tests.

---

## D-015 · 2026-09-11 · What names a row lives on the categorized-columns list

**Decision.** `app.categorized_columns()` gains a fifth column, `label_column`:
the column that names a row in the table a category files things in — `name` for
a material, `classification` for a labor rate, `company_name` for a lead.

**Reason.** Opening a category has to show the rows behind the count, and naming
a row differs by table. The alternative was a table-to-label map written in
TypeScript, which is a second list to forget when a tenth categorized column is
added — the exact failure `categorized_columns` exists to prevent. The return
type changes, so the function is dropped and recreated and the view over it goes
and comes back with it.

**Affects.** `library_category_columns`, `app.library_category_members`, the
category manager.

**Status.** Active. Eleven rows, nine kinds.

---

## D-014 · 2026-09-11 · Removing a category names where its items go

**Decision.** `delete_library_category(kind, name, move_to)` takes the
destination as a required argument. There is no form of the call that removes a
category and leaves its rows behind.

**Reason.** Removing a category is a tidying decision; losing how three hundred
materials were grouped is not, and the two must not be the same keystroke. A
removal that stranded rows would also break them: the 0113 guard refuses a
category that is not on the list, so the next edit to any of those rows would
fail with a message about a category the person never touched. Where the
category is empty the argument costs nothing.

The same call is the merge tool — moving everything out of `Compaction` into
`Compactors` and dropping the emptied name is how two categories become one,
which is what the shipped catalog needed and had no screen for.

**Authorized by.** The user, asked what should happen to the items in a category
being deleted: "move them to a category you pick."

**Affects.** Migration 0150, the category manager, every category list.

**Status.** Active. 28 db tests, 15 web tests.

---

## D-013 · 2026-09-11 · The execution protocol is a repository document

**Decision.** The zero-drop protocol is stored verbatim at
`governance/EXECUTION_PROTOCOL.md`, and `CLAUDE.md` points at it as a standing
instruction rather than containing it.

**Reason.** `CLAUDE.md` is read at the start of every session and earns its
weight by being short and high-signal. Three hundred lines pasted into it would
dilute the rules already there — the five categories, RULE-001 and RULE-003, the
estimate line — which are the ones most often broken. A pointer keeps both: the
protocol is authoritative and loaded, and the file that has to be skimmed stays
skimmable.

**Alternatives.** Paste it whole into `CLAUDE.md` (dilutes it); keep it only in
the conversation (lost on the next session); store it outside the repository
(invisible to anyone else working here).

**Authorized by.** The user, 11 September 2026: "you know the task. save this in
your setting."

**Affects.** `CLAUDE.md`, `governance/EXECUTION_PROTOCOL.md`, and every session
that reads them.

**Status.** Active.

---

## D-012 · 2026-09-11 · The entitlement moved from `starter` to `grounup`

**Decision.** `3RD Terrain`'s entitlement was moved to the `grounup` plan through
`public.set_company_plan`, via the admin console, with the reason "Trial was
provisioned onto starter, which migration 0901 retired; moving to the plan
actually sold."

**Reason.** The workspace was on `starter`, which migration 0901 retired
(`is_active = false`), with `entitlement_source = trial` expiring 19 September.
That is why `my_plan.plan_name` was null and why project management was refused.
Every current provisioning path defaults to `grounup`; the workspace predated
that change.

**Alternatives.** Leave it and let the trial lapse to `free` (also excludes
projects); write the entitlement row directly (refused by policy, and the wrong
path); start a Stripe subscription (a commercial decision, not a data fix).

**Authorized by.** The user, explicitly: "fix the starter entitlement to
grounup." This supersedes the earlier instruction in the same session to "keep
the Starter entitlement exactly as configured", which was scoped to not
modifying entitlements *in order to make the gate pass* — a different thing.

**Affects.** `entitlements` for one company. Reversible from the same screen.

**Status.** Active. Recorded in `audit_events` with the actor and reason.

---

## D-011 · 2026-09-11 · Site is asked for at creation *and* settable afterwards

**Decision.** Migration 0148 gives `estimates.site_address/city/state` two
writers: `create_estimate` takes them, and `set_estimate_site` changes them
until the estimate goes out.

**Reason.** An address arrives at two different moments. A bid invitation
usually carries one; often it does not, or it changes once somebody drives out
to look. One writer would have left the other case with no door — which is the
state the whole platform was in.

**Alternatives.** Creation only (an estimate created before the address was
known could never be told); setter only (the common case would need two steps).

**Authorized by.** The user: "add site fields to the new estimate dialog", then
"finish the editable site".

**Affects.** `create_estimate` signature (replaced, not overloaded, per D-004's
rule), `set_estimate_site`, the new-estimate dialog, the estimate version page,
`award_estimate_version`'s output, and the site forecast.

**Status.** Active.

---

## D-010 · 2026-09-11 · The unreachable-grant list is pinned, not tolerated

**Decision.** `scripts/build-door-inventory.mjs` carries `UNREACHABLE_GRANTS` as
a pinned set. A new `app.*` function granted to `authenticated` and called by
nothing fails the build; a name that leaves the set has been wired or revoked.
The set is currently empty.

**Reason.** Six such functions existed. Reporting them without pinning would let
a seventh arrive unnoticed; failing the build on all six immediately would have
blocked unrelated work. Pinning made the queue visible and finite, and migration
0147 emptied it.

**Alternatives.** Fail immediately on all six (blocks everything); report
without failing (grows quietly); exempt them (writes the defect down as a rule).

**Authorized by.** Standing instruction — the defect this codebase keeps
producing.

**Affects.** The door inventory, `verify`, and the governance suite.

**Status.** Active, set empty.

---

## D-009 · 2026-09-11 · Confidence checks are attestations, not derivations

**Decision.** `check_primary_source`, `check_cross_source` and
`check_reconciliation` are set by a person in the wrench panel, never derived.

**Reason.** The platform cannot observe whether somebody checked a dimension
against the governing drawing. A derived value would be a guess wearing the
authority of a measurement, and it feeds the gate that decides whether a bid can
be issued.

**Alternatives.** Infer from the quantity's provenance (unknowable); default
them true (makes the gate meaningless); leave them unwritable (the state that
made every hand-entered estimate permanently unbiddable).

**Authorized by.** Migration 0144's own reasoning, confirmed by the user electing
to tick them on a test estimate.

**Affects.** `update_estimate_line`, the wrench panel, the confidence score, the
approval gate.

**Status.** Active.

---

## D-008 · 2026-09-11 · A rate-priced line is locked to `estimator_allowance`

**Decision.** The measurement-basis select is disabled when
`parametric_cost_per_unit` is set, with the reason and the remedy stated.

**Reason.** Migration 0066 constrains it in the database —
`eli_parametric_is_an_allowance` — so a conceptual line cannot be relabeled into
the approval gate the label decides. Offering the choice would be a control that
takes a value and changes nothing.

**Alternatives.** Leave the select enabled and let the write fail (the defect);
hide the field entirely (the reason disappears with it).

**Affects.** `apps/web/src/components/estimate/how-sure.tsx`.

**Status.** Active.

---

## D-007 · 2026-09-11 · CPI is earned value over actual cost

**Decision.** `reporting_project_earned_value` computes the cost performance
index from each task's own budget weighted by that task's own progress. The
fixture's `(budget × percent complete) / actual cost` was not restored.

**Reason.** The live percent complete in `reporting_wip` is cost-to-cost —
actual cost over budget — so the old formula reduces to actual cost over actual
cost and prints 1.00 on every project forever while looking like a measurement.

**Alternatives.** Keep the old formula (prints a constant); omit CPI (loses the
figure a project manager asks for first).

**Affects.** `reporting_project_earned_value`, the project detail page.

**Status.** Active. Asserted by a test that it is not 1 by construction.

---

## D-006 · 2026-09-11 · Null, never zero, where a denominator is missing

**Decision.** Percent complete, CPI, hours performance and earned value are null
when no task carries a budget. Weather efficiency is null when no forecast has
been fetched.

**Reason.** A project nobody has broken down has not earned nothing — it has
earned an amount nobody can compute. Rendering that as 0% puts an unstarted job
and an unplanned job in the same place. Migration 0057 set this rule for work in
progress; it is applied consistently.

**Affects.** `reporting_project_earned_value`, `workable_days_at`, the project
page, the site weather card.

**Status.** Active.

---

## D-005 · 2026-09-11 · Sheet-text search is its own screen, not the global bar

**Decision.** `search_document_text` is wired to a "Search the drawings" tab on
Plans & Specs rather than folded into the global search dropdown.

**Reason.** The global bar matches a sheet by number and title and exists to jump
to a record. *Which sheet mentions the cathodic protection* is a question you
read an answer to — it needs snippets and page numbers. Folding them together
would also produce duplicate hits for a sheet matching both ways.

**Alternatives.** Union it into `app.search` (duplicates, and the wrong shape).

**Affects.** `apps/web/src/components/plans/search-the-drawings.tsx`,
`lib/data/plans.ts`.

**Status.** Active.

---

## D-004 · 2026-09-11 · A restated function is rebased on its latest definition

**Decision.** When restating a function in full, find the newest definition with
`grep -l "function app.<name>"` across the migrations and rebase on that.

**Reason.** Migration 0144 was rebased on 0136 when 0137 was the latest, silently
dropping `cost_code_id`. Seven tests caught it — after 0144 had been pushed, and
a migration that has run cannot be edited into having run differently. 0146
restates it.

**Affects.** Every future migration that restates an existing function.

**Status.** Active. The lesson is written into 0146's header.

---

## D-003 · 2026-09-11 · Visibility is decided before anything is explained

**Decision.** In `apply_takeoff_to_line`, the existence and tenancy checks run
under the caller's own row level security *before* `app.assert_line_open`.

**Reason.** `assert_line_open` is `security definer` and can see another
company's line. Using it as the existence check answered a stranger's probe with
"that estimate is issued" — confirming the row exists and naming its state.

**Alternatives.** Use the helper as the existence check (the disclosure);
duplicate its message inline (two definitions).

**Affects.** `app.apply_takeoff_to_line`. Asserted by a test on the ordering.

**Status.** Active.

---

## D-002 · 2026-09-11 · Every door is inventoried and checked by the gate

**Decision.** `scripts/build-door-inventory.mjs` enumerates every `public.*`
function and `my_*` view, matches each against its readers, writes
`governance/DOORS.md`, and `doors:check` runs in `verify`.

**Reason.** The most expensive defect this build produces is a complete, tested,
governed feature no screen reaches — found at least thirteen times. Every layer
passes on its own; nothing tested the joint.

**Affects.** `verify`, the governance suite, every future migration.

**Status.** Active. 161 doors, 0 with no reader.

---

## D-001 · 2026-09-11 · Both award scenarios are required acceptance tests

**Decision.** `tests/db/awarding-acceptance.test.ts` holds the Starter refusal
and the entitled success as equally required.

**Reason.** The Starter block is correct behavior, not a limitation to work
around. A build where either changes has moved something it should not have.

**Authorized by.** The user: "Treat both the blocked Starter scenario and the
successful entitled-plan scenario as required acceptance tests."

**Affects.** The db suite.

**Status.** Active. 19 tests.
