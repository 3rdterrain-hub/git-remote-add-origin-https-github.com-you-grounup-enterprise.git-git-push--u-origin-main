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

### Recommended next actions

1. Work the toolbar in order, saying before each section closes. Survey & Grade
   and Finance are done; Claims, Master Libraries, Reports, GrounUp Network,
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
