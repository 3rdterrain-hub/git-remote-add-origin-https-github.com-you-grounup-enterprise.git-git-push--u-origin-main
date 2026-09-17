# Project memory

The durable ledger for GrounUp Enterprise. `CLAUDE.md` says how to work here;
this file says what is *true* here — what has been decided, what has been built,
what is known to be wrong, and what was learned the expensive way.

It is written to be read cold, by somebody with no memory of the conversation
that produced any of it. Nothing in it may be a plan. If something is listed as
done, it is done and tested; if it is open, it says so.

---

## 1. What this is

A construction estimating and operations platform for an excavation and site-work
contractor, built to be sold to others. One database, one engine, one gateway,
one web application, multi-tenant by `company_id` on every row.

**Definition of success, in the user's own words:** *a working estimator that
calculates labor, equipment, material, production, trucking, overhead, profit and
final selling price; a complete GrounUp Enterprise platform that is functioning
and ready to be tested; then customer ready.*

The estimator is the heart. Everything else is judged by whether it feeds the
estimate or follows from it.

---

## 2. The shape of the thing

| Layer | Where | What it is |
|---|---|---|
| Schema | `supabase/migrations/*.sql` | 149 migrations. Catalog seeds sit at 0900+, which is why `db push` needs `--include-all`. |
| Engine | `packages/engine/` | The only place a price is computed. Pure TypeScript, no database access. |
| Engine (edge copy) | `supabase/functions/_shared/engine/` | **Generated.** `npm run engine:edge` writes it; `engine:edge:check` fingerprints it. Editing it by hand is a defect the gate catches. |
| Functions | `supabase/functions/` | 14 Edge Functions: pricing, billing, Stripe webhook, AI, email, weather, the API gateway. |
| Web | `apps/web/` | React + Vite + Tailwind + shadcn/ui. No custom CSS. |
| Governance | `governance/`, `tests/governance/` | The rules that fail the build rather than being described in a document. |

### The five categories
Everything is an **Engine**, **Library**, **Entity**, **Workflow** or **AI Agent**,
and says which in its header comment. A governance test enforces it.

---

## 3. Decisions that are settled

These are not open for re-litigation. Each cost something to arrive at.

1. **Cost buckets never merge** (RULE-001). Labor, burden, equipment,
   mobilization, fuel, material, trucking, disposal, subcontract, other. Fuel
   folded into an equipment rate is the classic way a contractor loses the
   ability to see where the money went.
2. **Rate precedence** (RULE-003): `project_quote` > `tenant_approved` >
   `regional` > `global_seed`. **The rate a screen shows must be the rate that
   prices.** A screen showing one and pricing another is the defect, not the
   display.
3. **AI proposes, humans accept** (RULE-008). No AI write reaches an approved
   estimate, a library, a contract, a schedule, billing, permissions or
   safety-critical data without the approval workflow.
4. **An issued version is immutable** (RULE-009).
5. **Engine outputs are never hand-written** (migration 0058). A price somebody
   typed is a price nobody can reproduce. `app.record_engine_result` is the only
   writer, and it is granted to `service_role` alone.
6. **Never invent a number.** No national average, no guessed unit, no silently
   converted rate. Refuse the row and say why. `MBF` is refused because it is a
   multiplier, not a unit; `EA` on crushed stone is loaded as stated and flagged.
7. **An unrecognized jsonb field name is refused, never ignored** (0136, 0139).
   This rule exists because `markupOverride` was once sent where the database
   read `markup_override`: the key matched nothing, `coalesce` kept every old
   value, and the call returned success.
8. **A price of nothing is not a price** (0121). An uncosted material reads
   `not_costed`, never `$0.00`.
9. **Subscription access comes from verified Stripe webhook state only.** A
   browser redirect grants nothing. Secrets live in Supabase server-side
   environment only; the bundle scan in `verify` proves none reached the client.
10. **`adjusted` vs `gross`.** `adjusted` is the quantity to be *produced*;
    `gross` is the quantity to be *purchased*. Waste applies to gross. A quoted
    unit rate is not inflated by waste — this was tested wrongly once.

---

## 4. The defect this build produces

**A working feature with no door.** A tested database function, granted to
`authenticated`, that nothing in the application calls.

Found **thirteen times**: lead intake (0065), assemblies, unit cost, resource
suggestions, the equipment-rate importer, `document_sheets`, the parametric
rate, the line-price write-back, Plans & Specs, `line_unit_note`, services with
no breakdown, the title-block fields on a sheet (0005 → 0171), and
`document_conflicts` (0006 → 0170).

The last is the most expensive one found so far, because it was not a missing
screen but a systematically wrong number: the confidence engine has taken
twenty-two points off a line for every unresolved conflict since 0033, and
nothing could record a conflict — so every bid this platform ever priced was
priced as though the plans, the specifications, the geotechnical report and the
addenda all agreed with each other.

Not one was caught by a test, and every layer was green each time: the migration
was tested, the function was tested, the payload was tested, the component was
tested. **Nothing tested the joint.**

**The countermeasure:** `scripts/build-door-inventory.mjs` enumerates every
`public.*` function and `my_*` view from the migrations, matches each against
its readers in `apps/web/src` and `supabase/functions`, and writes
`governance/DOORS.md`. `npm run doors:check` runs in `verify` and fails when a
door has no reader and no stated reason. A door now arrives with a caller, or
with a written reason it is server-side, **on the commit that adds it**.

The variant one layer in: **a control that takes a value and changes nothing.**
When adding a function, ask who calls it. When adding a field, ask what reads
it. When a screen shows a number, ask whether that is the number that prices.

---

## 5. Traps in this repository

Each of these cost at least an hour.

- **Compiled `.js` beside a source file silently wins.** Vite resolves `.js`
  before `.tsx`. 262 emitted files once shadowed the sources; a deliberate
  syntax error in a `.tsx` did not break the build, which is how it was proved.
  `apps/web`'s own typecheck script was emitting them. Governance test:
  `no-compiled-output-beside-the-source.test.ts`.
- **Typecheck from the repo root.** `apps/web/tsconfig.json` is a solution file
  with `files: []` and checks nothing. The gate uses `tsconfig.app.json`.
- **`npm run docs` before `npm run test`** when a migration is added, or stale
  counts fail the gate after a green test run.
- **Do not edit files while the gate runs.** The docs counts and the test results
  end up describing different trees.
- **`npm run functions:deploy` carries `--import-map`.** Without it all fourteen
  functions fail to bundle and the deploy silently does nothing.
- **A tenant UPDATE with no UPDATE policy affects 0 rows and does not raise.**
  Tests must assert on the row, never on the absence of an error.
- **Migration 0028:** a company-owned library row that is `active` must name an
  approver. Tests that insert one directly will fail on the constraint.
- **`userEvent.type` after a click appends.** The second click is an edit, not a
  replacement — use `click` then `keyboard`.
- **American English.** `tests/governance/spelling.test.ts` carries the list and
  fails the build on any of it. The words cannot be quoted here as examples —
  writing one down in this file is itself a failure, which is how this line came
  to be worded this way.
- **Node** lives at `/Users/tradertree/.grounup-tools/node-v24.20.0-darwin-x64/bin`
  and must be on `PATH` in every shell.

---

## 6. The estimate line

One line item is **one line**: every field visible, no horizontal scroll,
columns aligned down the whole estimate, description widest because it is the
field being typed into.

- One CSS grid template on every row. **No `min-w-[…]` anywhere on the row** —
  one minimum width in one child forces its column wider and pushes every number
  right. That is what "everything gets out of line" meant.
- Editors open **under** the row, never inside a cell.
- Column order: `+ ⠿ № 👁 | SERVICE | 🔧 | QTY | UNIT | COND. | UNIT COST | MARKUP | +MARKUP | TOTAL | ⧉ 🗑`
- **A box shows what was typed, not `0` first.** An empty quantity is empty.
- No permanent explanatory text under a quantity. The calculation echo appears
  only while the field has focus.

---

## 7. Standing instructions from the user

Said once; they should not have to be said again.

- **Nothing is read-only without a reason.** If a person can see it, they can
  edit it there, unless a stated rule forbids it.
- **All cards collapse.**
- **Everything can be shown to the client** — per-item visibility on bids and
  proposals.
- **Categories are user-addable**; most columns get a select rather than free text.
- **Cost codes are optional.** Nothing refuses a line without one. They live in
  the wrench panel, not on the row.
- **Work the toolbar in order**, one nav section at a time, and say before a
  section closes.
- **A finished product, not a plan.** Time, fatigue and complexity are not
  excuses. Never a workaround when the real fix exists. Never leave a dangling
  thread when tying it off takes five minutes.

---

## 8. Verifying and shipping

```bash
npm run test     # every suite
npm run docs     # regenerate counts — needs a green test run first
npm run verify   # typecheck, edge fingerprint, openapi, schema, counts,
                 # traceability, doors, all suites, build, bundle secret scan
```

- `npx supabase db push --include-all`
- `npm run functions:deploy`
- Push only on a green gate.

---

## 9. Technology, structure and conventions

**Stack.** PostgreSQL 18 (Supabase) · Deno Edge Functions · TypeScript
everywhere · React 19 + Vite + Tailwind + shadcn/ui · Vitest + Testing Library ·
PGlite for database tests.

**Naming.** Migrations are `NNNN_what_it_does.sql`, named for the thing rather
than the table. Database identifiers are `snake_case`; TypeScript is `camelCase`;
the data layer translates at the boundary and nowhere else. A `my_*` view is
caller-scoped by row level security. A `public.*` function is the browser-facing
wrapper over an `app.*` implementation.

**Data.** 168 tables, 88 views (20 reporting), 156 migrations. Catalog seeds sit
at 0900+ — which is why `db push` needs `--include-all`.

**Integrations.** Stripe (checkout, portal, webhook), Open-Meteo (no key, by
design), an AI provider behind the Edge Functions, Resend for email.

**Security.** Row level security on every tenant table; entitlement gates on
module heads; the suspension guard on every `company_id` table; engine outputs
writable only through `record_engine_result`; secrets server-side only, proven
by the bundle scan in `verify`.

---

## 10. State of the build

**Green.** The gate passes from a clean tree. The estimator prices labor,
burden, equipment, mobilization, fuel, material, trucking, disposal, subcontract
and parametric lines, applies condition modifiers and markup, clears the
confidence gate, and can be approved, issued and awarded into a project that
carries the bid, the budget, the site and every priced line as a budgeted task.

**Door inventory: 207 doors, 0 with no reader, 0 granted but unreachable.**

### Deployment

The live workspace is `3RD Terrain`, on the `grounup` plan (manual grant, no
expiry — see `DECISION_LOG.md` D-012). All migrations through 0158 are applied,
and `supabase migration list` shows local and remote agreeing on every one;
all fifteen Edge Functions are deployed. `E-2026-0003` is awarded to
`PRJ-2026-0003`.

### Known limitations

- The shipped catalog's assemblies reference tasks that carry no crew, equipment
  or material, so a *service* brings no build-up preset and its line prices at
  $0 until it is built up. A company's own assemblies work correctly today.
  Labor (56/56) and equipment (516/517) rates are costed; **materials are now
  178/333** (seed 0013, `DECISION_LOG.md` D-017). The 155 still uncosted have no
  row in the price library and are mostly near-duplicates of one that does —
  "#57 Stone", "#57 Stone (import)", "411" — which is a naming problem and not
  one to paper over with a number.
- Three retired plans (`starter`, `professional`, `business`, `enterprise`) and
  `partner_white_label` remain in `plans` because plans are versioned commercial
  terms.

### Categories, as of migration 0150

The nine category lists are records (0113), the shipped vocabulary was
consolidated to one name per thing (seed 0012 — 42 material categories to 25, 31
service to 5, 71 equipment classes to 18), and a person can now count, open,
rename and remove one from the **Categories** tab on Libraries. Removing one
names where its items go, which is also how two categories are merged
(`DECISION_LOG.md` D-014). `app.categorized_columns()` carries what names a row
in each table, so the drill-in is generic (D-015).

A kind may govern more than one table — `lead_source` governs `leads.source` and
`lead_intake_forms.source_label` — and every one of these functions loops over
the columns of a kind rather than picking one.

### The wrench panel, as of migration 0151

All five tabs name their rows through the library. What a row *is* is a picker,
not a text box, on Crew, Equipment, Materials, Hauling and Subs — and hauling
has the typed search the other four got in 0108. Picking moves the library link
with the name; typing a name of your own removes the link, because the row is no
longer that record.

That last half was impossible until 0151: `save_line_resource` wrote the six
library links on insert, listed them as accepted fields, and never mentioned
them in the UPDATE branch, so sending one returned success and changed nothing
(`DECISION_LOG.md` D-016).

### Hauling, as of migration 0156

`trucking_rates` held no rows and could not: `company_id` is `not null`, so the
platform cannot ship a haul rate, and nothing on any screen could create one
either — six readers, no writer. The Hauling tab now adds and edits haul
profiles, and the typed picker on a line finds what a company puts there
(`DECISION_LOG.md` D-018).

### Plans, sheets and conflicts, as of migrations 0170–0171

A sheet now knows what it is. `app.identify_sheet` writes the six title-block
fields that have been on `document_sheets` since 0005 and that nothing ever
wrote, and `my_plan_sheets` builds the display label once so the picker, the
search and anything printed call a sheet the same thing. An agent may fill a
blank field and never overwrite a person's (`DECISION_LOG.md` D-023). The
takeoff picker reads that view — `takeoff.ts`'s own `loadSheets` was deleted, so
there is one sheet reader rather than two.

Where the documents disagree is recordable, from both sides, on the line it
lands on, and turns into an RFI carrying both sides across (D-024).

### Takeoff, as of this session

Three defects, all of the same family as the doorless function — a screen that
looked right over machinery that was not doing what the screen said.

- **The page crashed** for any company that had saved a measurement: a derived
  value read `sheetId` above its own `const`, and `Array.filter` runs during the
  render. A governance test now walks the tree for that shape (D-026).
- **Applying a kept measurement sent `1`.** The panel read
  `appliedQuantity ?? multiplier × countPer` and nothing writes
  `applied_quantity` until a measurement is already applied. The quantity is now
  recomputed through the same engine call that drew it (D-025), which also gives
  `loadCalibrations` its first reader.
- **Deduct subtracted nothing** — the outline was cleared going in and the
  openings coming back (D-027).

The engine's refusals are also shown now. `measure` refuses a volume with no
depth rather than guessing; the screen used to swallow that and render nothing,
which reads as a dead button rather than as an answer.

### Plans & Specs, as of migration 0172

**"Search the drawings" could only ever return nothing.** The column it reads
has carried a trigram index since 0005 and a search function since 0036, and
nothing in the repository wrote it — four layers, each tested, each green.
`document_extractions` had never held a row either, despite RLS, a tenant
trigger, a supersede trigger and two indexes.

Both now have a writer, and it is the PDF's own text layer rather than a model:
deterministic, exact, no key, and free on a pass the upload already makes
(`DECISION_LOG.md` D-028). `my_sheet_text_coverage` says which sets are readable
and which are scans that need OCR, and reads the ones already in storage.
`ai-analyze-document` now refuses a set nothing has read instead of spending a
credit to be told nothing.

### Proposals and branding, as of migration 0173

Three columns on `companies` — `logo_path`, `primary_color`, `accent_color` —
have existed since migration 0002 with a hex constraint and a comment, and
appeared in exactly one file: the migration that created them. Every proposal
went out in the platform's colors under the platform's logo. They are now edited
in Company Settings, carried to the customer inside `open_proposal_by_token`,
and rendered on both the internal preview and the signing page
(`DECISION_LOG.md` D-029). The logo bucket is public on purpose: the customer
opening an emailed link has no session.

`renderProposal` in `packages/pdf` was complete, tested, and called only by its
own tests, while the screen's "PDF" button had no handler. Both the company and
the customer can now download it (D-030).

The Branding tab that stood there was the clearest example of the second defect
this build produces: hard-coded `defaultValue` colors, swatches painted by a CSS
class rather than by the value, and a Save button that set a flag to false.

### Takeoff, as of migrations 0177–0178

Two defects and one missing object, found by researching how estimators
actually work rather than by reading the code.

**A line overwrote instead of summing.** `apply_takeoff_to_line` wrote
`measured_quantity = p_quantity`, so a sidewalk traced in twelve runs priced as
the twelfth — silently. The line is now the sum of the measurements applied to
it, recomputed by trigger (D-034), and `my_line_measurements` breaks any total
down sheet by sheet.

**There was no object between a shape and a line.** Every takeoff product has
one and all of them make you pick it before tracing, because it owns the color
that keeps forty traces legible and the depth a drawing cannot supply (D-036).
`takeoff_conditions` is that object, per estimate now and reusable from the
library next.

**The drawing could not be navigated.** Zoom was two buttons stepping 25% about
the container's corner. The wheel now zooms about the cursor, space or the
middle button pans, and a sheet opens fitted (D-035).

### Survey and grade, as of migrations 0193–0195

The last whole section of the platform with no writer of any kind. Five governed
tables — `surveys`, `surfaces`, `surface_comparisons`, `machine_control_files`,
`machine_assignments` — with row level security, tenant guards, a georeference
check from 0047 and four integrity guards from 0048, and nothing anywhere that
could put a row into any of them. Two of those guards had never fired in their
lives, because nothing could reach the state they refuse.

**The volume is an engine output now** (D-059). Cut, fill, net, the areas, the
depths, the cell counts and coverage are guarded by 0058's guard, written only by
`app.record_surface_comparison`, which is granted to `service_role` alone and
called by the `compare-surfaces` Edge Function running `compareSurfaces` out of
`@grounup/engine`. The earthwork quantity is what a heavy civil bid is won or
lost on, and before this it could only have been typed.

**A surface arrives as a grid, and the grid is checked against its shape.** An
elevation array of the wrong length is the one mistake in this area that produces
a plausible answer instead of a failure — every cell shifts and every depth with
it — so it is refused in the browser and again in the database. A surface may
carry only a storage path instead; the comparison then refuses to measure it
rather than reporting the zero it would otherwise compute, which reads exactly
like flat ground. Parsing LandXML, TIN and points files is its own piece of work
and is deliberately not faked with a form.

**Machine control has its doors** (O-022, closed). Record a design, publish it
with the digest of what was published, send it to a machine, supersede it,
withdraw it, acknowledge it. Publishing freezes the surface it was cut from —
0048's guard, firing for the first time on real data — and one machine carries
one current design, because an operator holding two has no way to know which one
the office meant.

**0048's assignment guard was stating a wider rule than it meant** (D-060), which
only became visible once anything could reach those states: a withdrawn design
could not be taken off a single machine, and an operator could not confirm a
design the office had since replaced. Migration 0194 narrows it to a send.

Verified on live data against PRJ-2026-0003: a capture recorded, two surfaces
built with their extents computed, 347.2222 BCY of cut and 347.2222 CCY of fill
over a 5 × 5 grid at 25 ft with net zero, a design published with a real SHA-256
and superseded by its own next version, and the frozen-surface guard refusing to
move the ground underneath it.

### Finance, as of migration 0196

Finance had exactly one writer — `create_pay_application` (0162) opens a header —
and the consequences ran right through the section. `schedule_of_values` had no
writer at all (O-020), so every application was a header measured against
nothing. `pay_application_lines` had no writer, so an application could be opened
and submitted and never filled in; `submit_pay_application` would happily certify
a bill for zero dollars. `ap_invoices` had no writer, so
`ap_invoices_pay_requires_match` — the control that stops a company paying for
materials it never received — had stood since 0017 without ever being reached.

**The figures are computed, never typed** (D-061). Completed to date, stored
materials, retainage, approved changes and the amount due all follow from the
lines; a line's previous column is read off the previous application; and
`previous_payments` is what earlier applications were *paid*, not what they were
billed. Taken from what was billed, it quietly forgives an owner who short-paid
the month before — on the live workspace the two differ by $7,722.29 on
application 1 alone.

**The schedule of values comes off the estimate.** `source_line_item_id` has been
on that table since 0017 and had never been written. Retyping the bid into a
billing schedule is how the bill stops agreeing with the bid.

**A line is billed by amount or by percent, in the same cell**, because
estimators work both ways and a screen that insists on one gets the other typed
into it wrong. The percent is converted on the way in and only the dollar figure
is stored, so there is one number on file rather than two that can disagree.

**The three-way match is computed, not chosen.** A browser that could declare an
invoice matched could declare its way straight past the control, so
`app.match_ap_invoice` compares the invoice with what has actually been received
and the payables list says *why* an invoice cannot be paid rather than only
showing a state.

Verified live on PRJ-2026-0003: the schedule built itself from the awarded
estimate at $56,805.72, application 1 billed 40% ($22,722.29), was submitted,
approved and short-paid at $15,000, and application 2 opened carrying
$22,722.29 completed and $15,000 previously paid.

### Claims and entitlement, as of migration 0197

`contracts` and `claims` had existed since migration 0023 — fully governed, four
constraints and a deadline trigger between them — with no writer of any kind. A
company could read the claims it was running and could not open one.
`app.derive_claim_deadlines` had never fired in its life.

**The deadlines come from the contract** (D-063). `notice_days` and `claim_days`
are stored as numbers of days precisely so a deadline can be computed, and 0197
is the first thing that ever used them. A contract with no clause on file
produces no deadline rather than an invented one, and both the contract list and
the claim form say so: nothing will warn you, which is different from there
being no clause.

**A late notice is recorded, not refused** (D-062). Most construction claims are
lost on the notice clause rather than on their merits, so refusing a late notice
to keep the record clean would hide the most expensive fact a company can know
about its own claim. This also corrected a defect already on the screen: the card
said "Entitlement preserved" for any served notice, because nothing could compute
whether it was in time.

**The supporting arrays finally have a writer.** `supporting_daily_reports`,
`supporting_rfis` and `supporting_documents` are what a claim actually rests on —
records made at the time by people who did not yet know there would be a claim —
and evidence from another job is refused, because the other side finds that
rather than the person who attached it.

**Noticing, submitting, negotiating and resolving are four separate acts**, not
one dropdown. Each records something different, and a control that did all four
would record none of them. A resolution needs what was decided and why; a
settlement that awards nothing is a denial, and the two are argued differently
next time.

Verified live on PRJ-2026-0003: a contract recorded with a 7-day notice clause,
a claim opened on an event of 1 September, deadlines dated by the trigger to
8 and 22 September with nobody typing either, and a notice given 16 September
recorded and reported as **8 days late**. The verification claim was then
withdrawn; it is on file as CL-2026-0001, "Test claim — delete me", withdrawn,
along with contract CT-2026-0001 for that job.

### Master Libraries, as of migrations 0198–0200

O-026, open since the libraries screen was built: "Copy to company scope" was a
disabled button with the reason written on it. Honest, and it left the platform
shipping 2,819 services, 8,532 tasks, 700 machines, 56 labor classifications, 42
crews and 2,143 production rates that no company could take a single one of.

**The gesture moved onto the row.** A header button cannot know which row
somebody means. The badge that already says "GrounUp seed" on every tab is
exactly where a person looks when they want to change a row and cannot, so that
badge is now the door: click it and the company gets its own copy.

**A copy arrives as a draft unless the person can approve** (D-064). That is the
schema's own rule — `*_active_needs_approver` refuses an active company row with
nobody named — and the wrong fix is to stamp the copier as the approver.

**What is deliberately not copied.** A machine arrives without an hourly rate:
RULE-003 decides which rate prices, and a copied rate would insert somebody
else's number into this company's own precedence. A production rate keeps the
`source_type` it had, because every confidence figure downstream reads it and a
shipped industry rate is still an industry rate until somebody measures their
own. A crew brings its members, pointed at the company's own classification
where it has one.

**Assemblies and materials route to what already did it** — `customize_assembly`
(0129) and `set_material_cost` (0133) — rather than to a second implementation
beside them, which is how this repository ended up with two lead intakes and two
`set_material_cost`s before anybody noticed.

**One door, not seven** (D-065), and the door inventory now honors a `drop` in a
later migration rather than reporting six functions 0200 removed as doors with
no reader.

Verified live: `SVC-0003` "Clearing and grubbing" copied into 3RD Terrain as
`SVC-0003-a845b8`, active and approved because the owner can approve, and a
second call returned the same copy rather than making another.

### Reports and the semantic layer, as of this session

Twenty `reporting_*` views, and **five had no reader anywhere** (D-066). The
door inventory was not looking at them, because they are read rather than
written — which is exactly the same defect as a function nobody calls, one layer
up. A view nobody reads cannot disagree with anything, and that is not the same
as being right.

Two were sitting beside screens that said out loud they needed them:

  * **`reporting_cash_flow_items`.** The Finance cash tab's own comment read
    "bucketing by month is as fine as the view goes; a tighter window would need
    the item grain". The item grain existed, with the reason a payable is
    blocked carried on the row — so a hatched bar now has a list behind it
    saying which invoice and why.
  * **`reporting_takeoff_status`.** It carries `stale_on_line`: a measurement
    edited after it was carried onto an estimate line. That line is then priced
    on a quantity no longer on the drawing, and it looks perfectly normal,
    because a quantity is a number and every number looks fine. Nothing else on
    any screen computed it. The report opens on the stale ones.

The other three: `reporting_estimate_structure` (own-cost separated from
rollup, which is what makes a nested estimate addable without counting the same
money twice), `reporting_usage_allowance` (the verdict the enforcement path
evaluates, shown beside the bars that assemble their own answer, so the two
disagreeing is visible rather than discovered at the boundary), and
`reporting_payment_problems` (every failed charge, and whether Stripe has given
up — the difference between a retry on Tuesday and a subscription ending).

The inventory now counts `reporting_*`, so this cannot recur quietly.

### Prevailing and union wages, as of migrations 0201–0206

Asked for by the owner, who is an operator: *"my pay isn't 44 or $40, but it
probably depends on the area you're in and the union hall that you belong to…
Ohio got a certain type of pay, Cleveland got a certain type of pay… it breaks
down like that."* And the condition on building it: **"I can't have any
mistakes."**

**The unit is the sheet** (D-067) — one dated document: a union agreement zone,
a prevailing wage determination, a company scale. A rate on it is found by
**trade + class**, because the same operator is "Heavy Equipment Operator II" to
a shop, "Class 2" to an agreement and "Class II" to a determination, and the
pair is the only thing stable across all three. A determination must name its
county **and construction type**; heavy, highway, building and residential pay
differently for the same trade in the same county.

**Open shop is the default and was made safe by construction** (D-068). An
estimate naming no sheet resolves to the crew member's own `labor_rate_id` —
the same row, same column, no lookup — in the first three lines of
`app.resolve_labor_rate`. Proved at three layers: the engine's pinned figures
(54.00, 59.40, 40.00/hr) unchanged across 708 tests; the pricing function reads
no fringe as zero; the resolver has its own identity test.

**Nothing is ever substituted** (D-069). A class missing from the named sheet is
a refusal carrying the class and the sheet. A silently substituted wage is the
worst thing this platform could produce — the bid looks entirely normal, because
a wage is a number and every number looks fine.

**Fringe is dollars an hour, on hours worked** (D-070), separate from
`burden_percent`, taking no overtime multiplier — that is how Davis-Bacon
computes it, and multiplying it overstates every overtime hour by about twenty
dollars an operator a shift. Cash in lieu carries burden; plan fringe does not.

**A raise is entered once.** `app.schedule_wage_increase` copies a sheet forward
with the step applied and dates it, so a raise three years out can be entered
this afternoon and every bid after that date prices at the stepped rate. Every
class comes forward, and apprentices — held as a **percentage of journeyman**
rather than a figure — recompute off the new journeyman rather than being raised
twice.

**What was deliberately not built:** automatic matching of a determination's
classification names to yours. A decision says "Power Equipment Operator, Class
II" and you say "Operator II"; connecting those is a judgment, not a derivation,
and code that guessed would be silently wrong about a wage. The mapping is a
person's, made once per determination.

Three guards caught mistakes during the build, all correctly: the category guard
refused the trade being written into the user-addable `labor_group` (0203); the
apprentice constraint refused a percentage with no journeyman named (0204); and
`suspension.test.ts` found the new table missing the read-only guard (0205).
`every-door-has-a-reader` then found the resolver had no caller, which is what
0206 fixed.

### Scenario comparison, as of this session

`priceScenarios` and `analyzeSensitivity` had been in the engine — written,
tested by 26 of their own tests, and **called by nothing**. The defect this
repository keeps producing, in the layer that is hardest to notice it in,
because the tests were all green.

**It is a read, and the shape of the code says so** (D-071). `compare-scenarios`
is its own Edge Function, needs only `estimates.read`, and writes nothing at
all. A price is an engine output that exactly one function may write; a scenario
is a *question* about a price. Had it been a mode of `price-estimate`, an
estimator would have had to wonder whether asking moved the bid.

**Sensitivity runs always, because it assumes nothing** — each driver moved on
its own by one stated factor, ranked by what it did. It answers the question an
estimator actually has: not "what could go wrong" but *which lever is worth
pulling*, and the answer is usually not the one they expected.

**Scenarios are the estimator's.** The platform offers no stock "high case". An
assumption nobody chose is one nobody can defend to an owner, and the boundary
refuses an adjustment that will not say why — "high is base plus twenty percent"
is the first thing asked about when a bid is opened.

**One statement of how an estimate is read** (D-072). The selects and the load
moved to `_shared/estimate-snapshot.ts`, proved byte-identical before rewiring.
`price-estimate` went from 260 lines to 152. The risk was not theoretical:
adding `fringe_per_hour` had just meant editing two selects by hand in one file,
and a comparison priced against a differently-loaded estimate is a comparison of
two different jobs.

### The shipped catalog and why it prices at nothing, as of migrations 0208–0209

Asked directly: *"fix the shipped services so they price."* Checked before
touching anything, and the honest answer is in two halves.

**The catalog carries no cost content, and that cannot be fixed by code**
(D-073). All 8,604 catalog assembly components are of kind `task`. Every one of
the 2,143 seeded production rates says `source_type = 'seed_benchmark'` at an
average confidence of 0.403, none names a crew, and 1,452 carry the literal
placeholder "Task-dependent approved spread". The numbers were never there.
Seeding them would mean inventing thousands of figures for every tenant — the
largest opportunity in this repository to break the one rule it is built on. A
$0.00 is visibly wrong and gets caught at the desk; a plausible invented price
goes out on a bid.

*(One thing suspected and wrong: the 850 rates reading `1 HR/hr` sit on
`HR`-unit tasks, so they are internally consistent rather than broken.)*

**The loop that lets a company fix it for itself did not close** (D-074), and
that was a real bug. `save_line_buildup_to_library` copies a catalog assembly
into the company's library and puts their crew on it correctly — but the
suggestions were read through `services.default_assembly_id`, which for a
catalog service still points at the catalog assembly and its task-only rows. So
an estimator built a service up, saved it for next time, came back, and was
shown nothing. Again.

`app.assembly_for_pricing` now resolves it with RULE-003's precedence: the
company's own build-up where they have one, the shipped template otherwise. A
company that has never built anything up is unaffected.

**And a mistake worth keeping** (D-075): rewriting that pricing function by hand
dropped its tenancy filter, which would have let another company's equipment
rate price your machine. Caught by diffing against the original. 0209 rebuilds
it programmatically from 0126's text with two substitutions and asserts the
projection byte-identical. **A function that prices is not retyped.**

So the catalog is still 2,545 services that cost nothing on day one — but each
one becomes permanently the company's the first time they build it up, which is
the only honest version of making them price.

### Recommended next actions

1. Work the toolbar in order, saying before each section closes. Survey & Grade,
   Finance, Claims, Master Libraries and Reports are done; GrounUp Network,
   Company Settings and Billing remain.
2. Parse LandXML, TIN and points files into a surface, which is what stands
   between `create_surface` and a real survey deliverable.
3. Compose task resources in the catalog, or document that pricing is by hand.

---

## 11. Where the records are

| Record | File |
|---|---|
| Current state | `PROJECT_MEMORY.md` — this file |
| Requirements | `REQUIREMENTS_TRACEABILITY.md` |
| Decisions | `DECISION_LOG.md` |
| The protocol | `governance/EXECUTION_PROTOCOL.md` |
| Doors | `governance/DOORS.md` (generated) |
| Specification tracing | `governance/traceability/` (generated) |

---

*Kept current by hand, every session that changes what it describes. A statement
here that stops being true is worse than no statement at all — delete it or fix
it on the commit that makes it false.*
