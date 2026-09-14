# Decision log

Material decisions, with the reason, what else was considered, who authorized it,
and what it replaced. Required by `governance/EXECUTION_PROTOCOL.md` §3.

A decision belongs here when reversing it would cost real work, when it
contradicts something previously agreed, or when somebody a year from now would
otherwise ask "why is it like this". Ordinary implementation choices do not.

Newest first.

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
