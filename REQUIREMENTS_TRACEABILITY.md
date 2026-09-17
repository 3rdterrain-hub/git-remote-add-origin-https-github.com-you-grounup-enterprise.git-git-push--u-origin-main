# Requirements traceability

Every requirement, where it lives, what verifies it, and whether it is done.
Required by `governance/EXECUTION_PROTOCOL.md` §3.

**This file is hand-maintained and covers requirements stated in conversation.**
It is not the same thing as `governance/traceability/`, which is generated from
the 32-phase GES specification by `npm run traceability` and checked by the gate.
The two are complementary: that one traces the written specification, this one
traces what was asked for out loud and would otherwise be remembered by nobody.

Status vocabulary: `pending`, `in progress`, `implemented`, `tested`, `blocked`,
`superseded`, `not applicable`.

---

## Standing requirements

| ID | Requirement | Source | Priority | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|---|
| R-001 | Everything is an Engine, Library, Entity, Workflow or AI Agent, and says which in its header | CLAUDE.md | high | all | header comments | `tests/governance/registry.test.ts` | tested |
| R-002 | American English throughout | CLAUDE.md | medium | all | — | `tests/governance/spelling.test.ts` | tested |
| R-003 | RULE-001: cost buckets never merge | CLAUDE.md | high | engine | `packages/engine/src/estimate.ts` | engine suite | tested |
| R-004 | RULE-003: the rate a screen shows is the rate that prices | CLAUDE.md | high | engine, library | rate precedence resolution | db suite | tested |
| R-005 | RULE-008: AI proposes, humans accept | CLAUDE.md | high | AI agents | `ai_findings` acceptance trigger | db suite | tested |
| R-006 | RULE-009: an issued version is immutable | CLAUDE.md | high | estimating | frozen triggers, 0111 | `tests/db/...frozen...` | tested |
| R-007 | Engine outputs may not be written by hand | CLAUDE.md, migration 0058 | high | estimating | `app.record_engine_result` + guard | db suite | tested |
| R-008 | An unrecognized jsonb field name is refused, never ignored | CLAUDE.md, 0136/0139 | high | estimating | `update_estimate_line`, `record_site_weather` | db suites | tested |
| R-009 | Never invent a number | CLAUDE.md | high | all | refusals with stated reasons | import suites | tested |
| R-010 | One estimate line is one line, all fields visible, no `min-w-[…]` | CLAUDE.md | high | estimate workspace | `estimate-version.tsx` grid | `estimate-version.test.tsx` | tested |
| R-011 | Nothing is read-only without a reason | CLAUDE.md | medium | all screens | — | per-screen tests | in progress |
| R-012 | All cards collapse | CLAUDE.md | medium | all screens | `CollapsibleCard` | `card.test.tsx` | in progress |
| R-013 | Everything can be shown to the client — per-item visibility | CLAUDE.md | medium | proposals | `client_visible` | db suite | tested |
| R-014 | Categories are user-addable; most columns get a select | CLAUDE.md | medium | libraries | `add_library_category` | `categories.test.ts` | tested |
| R-015 | Cost codes are optional, and live in the wrench panel | CLAUDE.md | medium | estimate line | 0137, `line-detail.tsx` | `a-cost-code-you-can-choose.test.ts` | tested |
| R-016 | Work the toolbar in order, saying before a section closes | CLAUDE.md | medium | process | — | — | in progress |
| R-017 | A number on a tile answers the question it raises | CLAUDE.md | medium | all screens | `StatTile` | `every-stat-tile-does-something.test.ts` | tested |
| R-018 | A numeric box selects its contents on focus; zero renders empty | CLAUDE.md | medium | inputs | `select-on-focus.ts`, `input.tsx` | `input.test.tsx` | tested |
| R-019 | A headline count is counted, never remembered | CLAUDE.md | medium | libraries | `loadLibraryCounts` | web suite | tested |
| R-020 | Every door has a reader, or a written reason it does not | this session | high | schema + app | `scripts/build-door-inventory.mjs` | `every-door-has-a-reader.test.ts` | tested |
| R-021 | The zero-drop execution protocol governs every session | user, 2026-09-11 | high | process | `governance/EXECUTION_PROTOCOL.md`, `CLAUDE.md` | read at session start | implemented |
| R-022 | The three memory files are maintained every session | user, 2026-09-11 | high | process | `PROJECT_MEMORY.md`, this file, `DECISION_LOG.md` | — | implemented |
| R-023 | A sheet is called what its title block says, and an agent may fill a blank but never overwrite a person | user, 2026-09-13 ("build the manual path first") | high | `document_sheets` | `app.identify_sheet`, `my_plan_sheets` (0171), `components/takeoff/sheet-identity.tsx` | `a-sheet-that-knows-what-it-is.test.ts`, `sheet-identity.test.tsx` | tested |
| R-024 | Where two documents disagree is recorded from both sides, priced by the confidence engine, and askable as an RFI | this session — the engine has read `document_conflicts` since 0033 with no writer | high | `document_conflicts`, `rfis` | `app.raise_document_conflict`, `app.resolve_document_conflict`, `app.conflict_to_rfi`, `my_document_conflicts` (0170), `components/estimate/document-conflicts.tsx` | `the-drawing-says-one-thing.test.ts`, `document-conflicts.test.tsx` | tested |
| R-025 | A saved measurement applies the quantity it measures, recomputed from its own geometry | this session — the panel applied `multiplier × countPer`, always 1 | high | takeoff | `lib/takeoff-quantity.ts`, `components/takeoff/taken-off.tsx` | `taken-off.test.tsx` | tested |
| R-026 | No callback that runs during a render reads a binding declared later in it | this session — the takeoff page crashed on every company with a saved measurement | high | `apps/web/src` | `pages/app/takeoff.tsx` ordering | `a-value-is-not-read-before-it-exists.test.ts` | tested |
| R-027 | Changing takeoff tool keeps the outline and the openings that belong together | this session — Deduct subtracted nothing | medium | takeoff | `lib/takeoff-tools.ts` | `takeoff-tools.test.ts` | tested |
| R-028 | A plan set's text is read at upload, so the drawings can be searched | this session — the search column had no writer since 0005 | high | `document_sheets`, `document_extractions` | `app.record_plan_set_text` (0172), `readPdf`, `components/plans/text-coverage.tsx` | `the-drawings-nobody-could-search.test.ts`, `read-pdf.test.ts`, `text-coverage.test.tsx` | tested |
| R-029 | A proposal carries the sending company's logo and colors, set once in Company Settings | user, 2026-09-13 ("put the branding in company settings"); the columns existed unread since 0002 | high | `companies` | migration 0173, `components/settings/branding.tsx`, `sign-proposal.tsx` | `branding.test.tsx` | tested |
| R-030 | A proposal can be downloaded as a PDF, by the company and by the customer | user — "the header of the proposal... maybe a download or a upload" | high | proposals | `lib/data/proposal-pdf.ts`, `packages/pdf` `renderProposal` | `proposal-pdf.test.ts` | tested |
| R-031 | The estimator chooses what the customer sees of the estimate, at the moment of issuing | user — "everything can be shown to the client"; both flags were unreachable | high | proposals | `app.issue_proposal` (0174), `estimate-version.tsx` issue dialog | `the-words-the-estimator-chose.test.ts` | tested |
| R-032 | An opportunity moves through its stages, and a loss records why and to whom | user — Customers section; three tables unreachable since 0005 | high | `opportunities`, `contacts`, `crm_activities` | migration 0175, `components/crm/*` | `a-pipeline-that-can-be-worked.test.ts`, `pipeline-board.test.tsx`, `contacts-panel.test.tsx`, `activity-log.test.tsx` | tested |
| R-033 | A card that opens on loaded data is controlled, not `defaultOpen` | this session — found three times | medium | `apps/web/src` | `DECISION_LOG.md` D-033 | `activity-log.test.tsx` | tested |
| R-034 | An estimate line's quantity is the sum of every measurement applied to it | this session — it overwrote, so a sidewalk traced twelve times priced as one | high | takeoff | migration 0177, `quantity-breakdown.tsx` | `a-line-is-the-sum-of-what-fed-it.test.ts` | tested |
| R-035 | The drawing zooms about the cursor and pans by hand | user, 2026-09-14 ("add mouse wheel zoom and pan") | high | takeoff | `lib/canvas-navigation.ts`, `pages/app/takeoff.tsx` | `canvas-navigation.test.ts` | tested |
| R-036 | A takeoff condition is measured in many places and priced once | user, 2026-09-14 ("build stage two too"); industry model from OST/PlanSwift/STACK | high | takeoff | migration 0178, `components/takeoff/condition-list.tsx` | `the-thing-being-measured.test.ts`, `condition-list.test.tsx` | tested |
| R-037 | Progress is reported by the field, and an unreported project says so rather than showing zero | this session — a permanent false margin-fade alarm on every awarded job | high | `project_tasks`, `production_actuals` | migration 0179, `components/project/budgeted-work.tsx` | `work-reported-rather-than-assumed.test.ts` | tested |
| R-038 | The field reports a day's production in quantity and hours, against a budgeted task | this session — 0179's rollup had no source | high | `production_actuals` | migration 0180, `components/project/reported-days.tsx` | `the-field-says-what-it-did.test.ts` | tested |
| R-039 | A change order is priced, and is worth the sum of its lines | this session — every change order was worth $0 forever | high | `change_order_items` | migration 0181, `components/project/change-order-pricing.tsx` | `a-change-order-that-is-worth-something.test.ts` | tested |
| R-040 | A field report records its crews and machines, and is handed in | this session — created, never fillable, never submittable | high | `daily_reports` | migration 0182, `components/project/field-report-detail.tsx` | `a-field-report-you-can-fill-in.test.ts` | tested |
| R-041 | No tab renders without a way to open it | this session — the budgeted work tab had no trigger | medium | `apps/web/src` | `tests/governance/every-tab-can-be-reached.test.ts` | same | tested |

---

## Security requirements

| ID | Requirement | Source | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|
| S-001 | No Stripe secret, service-role key or AI provider secret in frontend code | user | web bundle | server-side only | `scripts/check-bundle.mjs` in `verify` | tested |
| S-002 | No raw card numbers, CVCs or payment credentials stored | user | billing | brand + last four only | `billing-a-page-can-read.test.ts` | tested |
| S-003 | One company cannot query another's records | user | all | row level security | every db suite's isolation tests | tested |
| S-004 | AI may not alter approved estimates, libraries, contracts, schedules, billing, permissions or safety data without the approval workflow | user | all | RULE-008 + gates | db suites | tested |
| S-005 | AI arithmetic is never the authoritative estimating calculation | user | engine | `record_engine_result` only | `tests/db/...engine...` | tested |
| S-006 | No table without `company_id` ownership and permission rules | user | schema | `apply_tenant_rls` | `registry.test.ts` | tested |
| S-007 | Subscription access comes only from verified Stripe webhook state | user | billing | `stripe-webhook` + entitlements | `billing-a-page-can-read.test.ts` | tested |
| S-008 | Tailwind and shadcn/ui only; no custom CSS | user | web | — | — | implemented |
| S-009 | Subscription prices come from a governed plan catalog, never hard-coded | user | billing, marketing | `plan_prices`, `loadPlanPrices` | `plans.test.tsx` | tested |
| S-010 | Every tenant table carries the suspension guard | migration 0082 | schema | `app.guard_suspension` | `suspension.test.ts` | tested |
| S-011 | Visibility is decided under the caller's RLS before any explanatory refusal | this session | takeoff | `apply_takeoff_to_line` | `six-functions-nobody-could-call.test.ts` | tested |

---

## This session's requirements

| ID | Requirement | Source | Priority | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|---|
| C-001 | Close the four open doors found by the inventory | user | high | CRM, billing, libraries | lead inbox, billing cards, uncosted materials | web + db suites | tested |
| C-002 | Make `project-detail` live | user | high | projects | migration 0142, `lib/data/project.ts`, `project-detail.tsx` | `a-project-you-can-open.test.ts`, `project-detail.test.tsx` | tested |
| C-003 | Add site weather to the project | user | high | projects | migration 0143, `site-weather.tsx`, `refresh-weather` | `weather-at-the-job-site.test.ts`, `site-weather.test.tsx` | tested |
| C-004 | Keep the Starter entitlement; do not modify entitlements to make the gate pass | user | high | billing | — | `awarding-acceptance.test.ts` scenario A | superseded by C-010 for the data fix; the prohibition on modifying entitlements *to pass a gate* stands |
| C-005 | Record the Starter path as PASS — the block is correct behavior | user | high | billing | `awarding-acceptance.test.ts` | 6 tests | tested |
| C-006 | Run award-to-project on a controlled tenant with an entitled plan | user | high | projects | `awarding-acceptance.test.ts` scenario B | 10 tests | tested |
| C-007 | Verify project creation, data transfer, tenant isolation, server-side entitlement recheck, and audit | user | high | projects | `awarding-acceptance.test.ts` | 19 tests | tested |
| C-008 | Both scenarios are required acceptance tests | user | high | db suite | `awarding-acceptance.test.ts` | in `npm run test` | tested |
| C-009 | Work through the six unreachable `app.*` functions | user | high | schema + app | migration 0147, three new screens | `six-functions-nobody-could-call.test.ts` + 3 web suites | tested |
| C-010 | Move the entitlement from `starter` to `grounup` | user | high | billing | `set_company_plan` via admin console | live verification + `audit_events` | implemented |
| C-011 | Add site fields to the new-estimate dialog | user | high | estimating | migration 0148, `estimates.tsx` | `estimates.test.tsx` | tested |
| C-012 | Make the site editable after creation | user | high | estimating | `set_estimate_site`, `where-the-work-is.tsx` | `where-the-work-is.test.tsx`, `where-the-work-is.test.ts` | tested |
| C-013 | Only the project name is mandatory on a new estimate | user question, 2026-09-11 | medium | estimating | `create_estimate` + button guard | `estimates.test.tsx` | tested |
| C-014 | A condition should be selectable by clicking the `1.0x` | user, with an example of conditions | high | estimating | migration 0149, `condition-cell.tsx` | `a-condition-you-can-click.test.ts`, `condition-cell.test.tsx` | tested |
| C-015 | One name for one thing — no duplicate categories | user: "no duplicates please" | high | library catalog | seed `0012_one_name_for_one_thing.sql` | `one-name-for-one-thing.test.ts` | tested |
| C-016 | Be able to rename, remove and open into any category, everywhere | user: "everything should be clickable and changeable with options" | high | libraries | migration 0150, `category-manager.tsx` | `a-category-you-can-manage.test.ts`, `category-manager.test.tsx` | tested |
| C-017 | Removing a category moves its items to a category you pick | user: "move them to a category you pick" | high | libraries | `delete_library_category`, `RemoveBox` | 8 db tests + 3 web tests | tested |
| C-018 | Resource pickers in place of free-text names in the wrench panel | user: "now do the wrench panel resource pickers" | high | estimating | `ResourceName` on all five tabs | `resource-picker.test.tsx` | tested |
| C-019 | Hauling gets the same typed search as every other tab | follows from C-018 | high | estimating | `searchTruckingRates`, `PickKind` gains `trucking` | 2 web tests | tested |
| C-020 | A repointed row moves its library link with its name | defect found building C-018 | high | estimating + schema | migration 0151 | `a-resource-you-can-repoint.test.ts` | tested |
| C-021 | A price entered in the library is used as a preset when building, never re-entered | user, 2026-09-12 | high | estimating + libraries | `line_resource_suggestions` → `save_line_resource`; `ResourcePicker`/`ResourceName` carry rate, unit and cycle | `a-resource-you-can-repoint.test.ts`, `resource-picker.test.tsx` | tested |
| C-022 | Add the material prices to the library | user: "add the material prices to the library" | high | library catalog | seed `0013_material_prices.sql` from `07_F_P_MATERIAL_LIBRARY` | `the-prices-that-were-in-the-file.test.ts` | tested |
| C-023 | A price and the unit it is quoted in arrive together | follows from C-022; 0009 refused to guess a unit | high | library catalog | seed 0013 corrects 133 units with their prices | 2 tests in the same file | tested |
| C-024 | Build the hauling door | user: "build the hauling door" | high | libraries | migration 0156, `haul-profiles.tsx`, `createTruckingRate` brought up to 0067 | `a-haul-rate-you-can-create.test.ts`, `haul-profiles.test.tsx` | tested |
| C-025 | Wire the project-detail buttons | user: "now wire the project detail buttons" | high | projects | migration 0157, `project-actions.tsx` | `three-buttons-on-a-project.test.ts`, `project-actions.test.tsx` | tested |
| C-026 | Make Schedule live | user: "now make schedule, procurement, survey and claims live" | high | scheduling | migration 0158, `recalculate-schedule`, `lib/data/schedule.ts`, `schedule.tsx` | `the-door-onto-the-schedule.test.ts`, `schedule.test.tsx` | tested |
| C-027 | Make Procurement live | same | high | procurement | `lib/data/procurement.ts`, `procurement.tsx` | `procurement.test.tsx` | tested |
| C-028 | Make Survey live | same | high | survey | `lib/data/survey.ts`, `survey.tsx` | `survey.test.tsx` | tested |
| C-029 | Make Claims live | same | high | claims | migration 0197, `lib/data/claims.ts` reads `my_claims`, `claims.tsx` writes through it | `a-notice-you-gave-in-time.test.ts` (23) | tested |
| C-050 | A directory somebody consented to | O-025, working the toolbar in order | high | network | migration 0210, `lib/data/network.ts`, `components/network/*`, `network.tsx` | `a-directory-somebody-consented-to.test.ts` (16), `network.test.tsx` (27) | tested |
| C-049 | A service built up once prices every time after | owner: "fix the shipped services so they price" | critical | libraries | migrations 0208–0209, `app.assembly_for_pricing` | `a-price-you-enter-once.test.ts` (9) | tested |
| C-048 | Scenario comparison has a door | owner: "give scenario comparison a door" | high | estimating | `compare-scenarios`, `_shared/scenario-input.ts`, `components/estimate/what-if.tsx` | `scenario-input.test.ts` (9), engine `scenarios.test.ts` (26) | tested |
| C-047 | A wage sheet you can point at | owner: "a updating union wage for union workers… but some union workers have different class workers" | critical | libraries | migrations 0201–0206, `components/library/wage-sheets.tsx`, `lib/data/wages.ts`, engine fringe, `price-estimate` resolution | `a-wage-sheet-you-can-point-at.test.ts` (20), `resources.test.ts` (35), `estimate-pricing.test.ts` (53) | tested |
| C-046 | Every reporting view has a reader | working the toolbar in order | high | reports | `components/reports/*`, `components/finance/cash-items.tsx`, `components/billing/what-the-boundary-says.tsx`, the door inventory extended to `reporting_*` | `every-door-has-a-reader.test.ts`, `reports.test.tsx` (10), `billing.test.tsx` (19) | tested |
| C-045 | A shipped row you can make your own | O-026 | high | libraries | migrations 0198–0200, `ScopeBadge` in `libraries.tsx`, `lib/data/library.ts` | `a-shipped-row-you-can-make-your-own.test.ts` (11), `libraries.test.tsx` (7) | tested |
| C-044 | A notice you gave in time | user: "now make schedule, procurement, survey and claims live" | critical | claims | migration 0197, `components/claims/{open-a-claim,claim-actions,contracts}.tsx`, `lib/data/claims.ts` | `a-notice-you-gave-in-time.test.ts` (23), `claims.test.tsx` (20) | tested |
| C-043 | A bill you can send, and one you can pay | working the toolbar in order | critical | finance | migration 0196, `components/finance/{schedule-of-values,billing-lines,invoice-actions}.tsx`, `lib/data/finance.ts` | `a-bill-you-can-send.test.ts` (25), `finance.test.tsx` (13) | tested |
| C-042 | A machine can be told the design it holds is stale | resolving what 0193 ran into | high | machine control | migration 0194, `app.enforce_assignment_file_published` narrowed to a send | `a-surface-somebody-shot.test.ts` (35) | tested |
| C-041 | A surface somebody shot | working the toolbar in order | critical | survey | migrations 0193 and 0195, `compare-surfaces`, `components/survey/*`, `lib/data/survey.ts` | `a-surface-somebody-shot.test.ts` (35), `surface-comparison.test.ts` (6), `survey.test.tsx` (26) | tested |
| C-040 | An incident you can close | working the toolbar in order | critical | safety | migration 0192, `incident-investigation.tsx`, `record-observation.tsx`, `record-inspection.tsx` | `an-incident-you-can-close.test.ts` (14) | tested |
| C-039 | A purchase order worth something | working the toolbar in order | high | procurement | migration 0191, `purchase-order-lines.tsx`, `bid-leveling.tsx` | `a-purchase-order-worth-something.test.ts` (12) | tested |
| C-038 | Read a scanned plan set by eye | user: "build the vision fallback for scanned plans" | high | plans | `ai-analyze-document` document blocks, `text-coverage.tsx` | `text-coverage.test.tsx` (7) | tested |
| C-037 | A key you are shown once | owner: "build the system to a top tier level" | high | api | migration 0190, `lib/data/api-keys.ts`, `issue-api-key.tsx`, `api-access.tsx` made live | `a-key-you-are-shown-once.test.ts` (10) | tested |
| C-036 | A price you enter once | owner: pricing a real line and getting $0.00 | critical | libraries | migration 0189, `no-cost-buildup.tsx`, `estimate-version.tsx` | `a-price-you-enter-once.test.ts` (7) | tested |
| C-035 | Every button does something | owner: "why when I check it things are not working for me" | high | governance | `every-button-does-something.test.ts`, six buttons made honest or wired | that test | tested |
| C-034 | The work comes in by phone | same | high | crm | migration 0188, `add-lead.tsx`, `add-opportunity.tsx`, `add-customer.tsx` | `the-work-comes-in-by-phone.test.ts` (10), `add-lead.test.tsx` (5), `add-opportunity.test.tsx` (3) | tested |
| C-033 | Give Fleet its writers | working the toolbar in order after Schedule | high | fleet | migration 0186, `components/fleet/asset-detail.tsx`, `work-order-detail.tsx`, `record-fuel.tsx` | `a-machine-that-reports-its-hours.test.ts` (18), `fleet.test.tsx` (20) | tested |
| C-032 | Take a baseline, and read today against it | closing out Schedule | high | scheduling | migration 0185, `components/schedule/baselines.tsx` | `a-schedule-you-can-build.test.ts` (26), `schedule.test.tsx` (34) | tested |
| C-031 | A reader must ask for columns that exist | found by driving the live page after C-030 | high | governance | `lib/data/schedule.ts`, `lib/data/survey.ts`, migration 0184 | `a-select-names-columns-that-exist.test.ts`, `a-schedule-you-can-build.test.ts` (20) | tested |
| C-030 | Give the scheduling section its writers | user: "start on schedule" | high | scheduling | migration 0183, `components/schedule/*`, the door half of `lib/data/schedule.ts` | `a-schedule-you-can-build.test.ts` (17), `schedule.test.tsx` (30) | tested |

---

## Known open items

| ID | Item | Why it is open | Next action |
|---|---|---|---|
| O-001 | `E-2026-0001` and `E-2026-0002` are test estimates with a typed rate | A rate-priced line is an allowance and cannot clear the confidence gate (D-008) | Build the lines up, or delete them |
| O-002 | The shipped catalog's assemblies carry only `task` components | Verified: every one of the 17 assembly_components inserts in the catalog is `'task'`; `app.line_resource_suggestions` reads labor/equipment/material/trucking, so all 2,545 seeded services price at $0.00. Not a code defect — the catalog has no costs in it, and inventing them is forbidden. 0189 supplies the missing half: the screen says so before pricing, and a line's build-up can be kept on the service | Companies build up the services they use; catalog depth is a data exercise, not a code one |
| O-006 | Global search indexes fixtures, not records | `lib/search.ts` imports ESTIMATES, PROJECTS, CUSTOMERS, DOCUMENTS, ASSETS, EMPLOYEES and PURCHASE_ORDERS from `@/data/*`, so the search bar finds invented rows on a live workspace | Point each source at its table, the way the pages now are |
| O-005 | No alignment or cross-section model exists | The engine's average-end-area and prismoidal comparison are real and tested; nothing stores a station, a template or a section, so the tab was removed rather than left showing invented road | Build the alignment model, or leave earthwork to surfaces |
| O-007 | Proposals cannot be drafted, so `commercial_terms` and `payment_terms` are unwritable | `issue_proposal` inserts at status `issued`; the immutability trigger's `draft` branch is unreachable | Add a draft state, or drop the two columns |
| O-008 | `proposal_line_items` holds no rows | Not a defect — 0111 freezes the estimate lines, so the live read is safe. It is the home for proposal alternates and options, which are unbuilt | Build alternates/options, or retire the table and `proposal_base_total` |
| O-009 | `proposals.template_key` is referenced nowhere | Defaulted to `'standard'` since 0006 and read by nothing | Build proposal templates, or drop the column |
| O-017 | `project_costs` has no reader | Triggers post job cost into it from labor, fleet and commitments; nothing displays it | Show job cost against budget |
| O-012 | A condition cannot yet carry sections across several sheets | PlanSwift's "Continue With": one thing traced on C-101 and C-102 with a running total. The pieces exist — a condition already spans sheets — but nothing names it or totals it per sheet | Build "Continue With" |
| O-013 | Conditions are per estimate, not reusable from the library | `takeoff_conditions.estimate_version_id` is nullable for this; nothing writes or reads a null one yet | Build library reuse, as agreed |
| O-011 | `loadSignatures` and `noteOnLead` are exported and never imported | A signature the customer gave is never shown back; a lead's notes and follow-up date cannot be written | Give each a door |
| O-018 | `task_dependencies` (0007) is unused | It duplicates `schedule_dependencies` field for field. 0183 gave the latter its writer and deliberately left the former alone, so there is one dependency table and not two | Drop `task_dependencies`, or state what it is for |
| O-021 | `work_calendar_exceptions` has no writer | The engine reads holidays and shutdowns out of it; the working-week editor sets the weekly pattern only | Add holidays to the working-week tab |
| O-028 | A surface cannot be built from a survey file | `create_surface` takes a grid or a storage path; LandXML, TIN and points files are not parsed, so a real deliverable has to be gridded elsewhere first | Parse LandXML, TIN and CSV points into a grid |
| O-004 | R-011, R-012, R-016 are partially applied | Standing instructions applied per screen as screens are worked | Continue the toolbar in order |
