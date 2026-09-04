# Test report

**1,277 tests across six layers. All passing.**

Run everything with `npm run verify` (typecheck + OpenAPI and traceability drift
checks + tests + production build) or `npm test` for the tests alone.

| Layer | Suite | Tests | Executes against |
|---|---|---|---|
| Estimating engine | `packages/engine/tests` | 446 | Node |
| Document rendering | `packages/pdf/tests` | 57 | Node, parsing the PDFs it emits |
| Database | `tests/db` | 355 | **Real PostgreSQL 18** (PGlite/WASM) |
| Edge Functions | `tests/functions` | 214 | Node (pure logic, injected I/O) |
| Governance | `tests/governance` | 92 | The live schema, the source tree, and the requirements ledgers |
| Web application | `apps/web/src` | 113 | jsdom + Testing Library |

---

## Engine — 259 tests, 99.7% statements, 93.44% branches

| File | % Stmts | % Branch | % Funcs |
|---|---|---|---|
| `numeric.ts` | 100 | 100 | 100 |
| `units.ts` | 98.64 | 92.59 | 100 |
| `quantity.ts` | 100 | 100 | 100 |
| `production.ts` | 100 | 100 | 100 |
| `resources.ts` | 100 | 93.84 | 100 |
| `trucking.ts` | 100 | 97.36 | 100 |
| `pricing.ts` | 99.09 | 94.64 | 90.9 |
| `confidence.ts` | 100 | 97.93 | 100 |
| `estimate.ts` | 99.48 | 83.09 | 100 |
| `surfaces.ts` | 100 | 91.17 | 100 |

**Every expected value was computed independently**, by hand or by a separate
script, before being written into a test. None was captured from the code — a test
that records what the code already does proves only that it is consistent, not that
it is right.

Representative coverage:

- **Rounding** — the classic float-error cases (`1.005 → 1.01`, `2.675 → 2.68`),
  negative half-cases (`-0.5 → -1`, not `-0`), idempotency, `-0` normalization, and
  rejection of `NaN`/`Infinity` rather than producing `NaN` money.
- **Volume states** — bank/loose/compacted round trips, the loose→compacted path
  through bank (never `1,250 × 0.9`), rejection of a shrink factor of 1.
- **Cut/fill** — the site that "looks balanced" at 40,000 cut against 40,000 fill
  and is actually a 4,000 CCY import job; unsuitable material leaving regardless of
  the mass balance; topsoil tracked separately.
- **Haul** — the five cycle components hand-computed to four decimals, fleet sizing
  from loader production, and both imbalance directions (loader starved, trucks
  queueing) with their cost consequences.
- **Modifiers** — production compounding (0.75 × 0.80 = 0.60) versus cost adding
  (+35% and +12% = +47%, not +51.2%); undeclared targets left untouched; a duplicate
  applied once; a justification required.
- **Markup** — parallel $125,000 versus stacked $126,896 on identical inputs; bond
  applied on the marked-up total in both methods; regional factor and compounded
  escalation moving the cost basis before markup.
- **Confidence** — every band boundary in Section 7.2 (`69/70`, `79/80`, `89/90`);
  penalties measured from a base with headroom so the 100 cap does not compress them.
- **Approval gates** — the most restrictive path winning over a high score; AI-
  generated lines never reaching auto-accept.
- **End to end** — a golden reference line where 800 CY at 100 CY/hr is exactly one
  shift, making every figure hand-verifiable; plus the two documented use cases
  (EX-001 mass excavation, EX-002 storm sewer).

### Bug found and fixed by these tests

`standardProfile` emitted a pinned markup basis, so **stacked profiles never actually
stacked** — parallel and stacked produced identical prices. The same defect excluded
the regional factor from the markup basis. Both were fixed in the engine (a
`profile_default` basis that resolves by method, and a cost-adjustment multiplier
applied to pinned bases), not worked around in the tests.

### Uncovered branches

The uncovered lines are defensive paths: an unreachable `default` in a switch over a
closed union, and guard clauses for states the type system already excludes. They are
left in because a future enum member should fail loudly rather than silently.

---

## Database — 152 tests against real PostgreSQL 18

PGlite is PostgreSQL compiled to WebAssembly: the same planner, the same RLS
implementation, the same constraint and trigger semantics. The **production
migrations run unmodified**, so these are genuine proofs rather than simulations —
and they need no Docker.

### Migration and seed (12 tests)

All 12 migrations apply in order. The seed loads and is verified record by record:
188 services, 2,783 tasks, 1,452 production rates, 188 assemblies, 20 condition
modifiers, 12 labor classes, 17 equipment items, 8 crews, 5 plans, 15 AI agents.
Generated columns are checked (`$40 × 1.35 = $54.00`), foreign keys are confirmed to
have resolved (zero orphaned production rates, zero unlinked assemblies), and the
modifier validation trigger is confirmed to reject an unknown target and a
non-positive factor.

### Tenant isolation (51 tests)

The fixture builds two unrelated companies **plus a third user who legitimately
belongs to both** — that third case is where naive isolation designs break.

| What is proven | |
|---|---|
| RLS enabled and forced on every table | no exceptions |
| A company sees only its own estimates, customers, versions | direct |
| Querying another tenant's row by primary key returns nothing | not an error — no probing |
| Inserting into another company is refused | RLS violation |
| Moving a row between tenants by updating `company_id` fails | USING + WITH CHECK |
| A dual member cannot attach company A's line to company B's estimate | **the structural guard** |
| The same insert succeeds when the parent really does belong | positive control |
| Anonymous requests are denied at the privilege layer | before RLS is consulted |
| Anonymous can still read the public plan catalog | and not the private partner plan |
| A viewer can read but cannot write estimates or libraries | permission enforcement |
| Approval tiers report correctly per role, and 0 for non-members | |
| Every tenant reads the global seed; none can edit it | three-tier scope |
| A company can create and edit its own override, invisible to others | |
| `company_actual` with zero sample size is refused | RULE-010 |
| No tenant role can insert or update a subscription or entitlement | **billing security** |
| A tenant cannot upgrade its own entitlement | direct attempt, verified unchanged |
| Raw Stripe payloads are unreadable by any tenant | |
| A duplicate Stripe event id is rejected | replay safety |
| Entitlement and authorization are separate | `has_entitlement` true, `can_use` false |
| Every governed write is audited with prior and new state | |
| A no-op update writes no audit event | |
| The audit ledger cannot be updated or deleted, even by superuser | |
| Audit is not readable across tenants | |
| A draft version is editable; an issued one is frozen | RULE-009 |
| An issued version can still record its commercial outcome | |
| An issued version cannot walk back to draft | |
| `revise_estimate_version` copies lines and requires a reason | |
| An AI finding cannot be born accepted or lack citations | |
| Acceptance requires the permission and the acting user | |
| A requester cannot approve their own request | |
| Approval below the required tier is refused | |
| A company cannot lose its last owner | update or delete |

### Operations, fleet, finance and safety governance (89 tests)

Added with the later batches, all against the same real PostgreSQL:

- **Operations (25)** — submittal return states, proposal immutability once issued,
  daily reports frozen after submission, notification addressing (company-wide vs
  targeted vs cross-tenant), action paths restricted to in-app routes, and a
  prompt registry that refuses to activate a version with no evaluation result.
- **Fleet and workforce (22)** — meters that refuse to run backwards unless the
  unit was replaced, work orders that cannot close without a resolution,
  credential status recomputed against the calendar, timecards locked by payroll
  export, schedule float and criticality kept consistent, and an exclusion
  constraint that refuses to book one machine to two overlapping jobs.
- **Finance and procurement (25)** — over-billing refused, certified pay
  applications frozen, purchase orders that cannot be invoiced beyond their
  commitment, RFQ awards that must record a reason, three-way match blocking
  payment, and inventory that cannot reserve more than it holds.
- **Safety, quality and connectors (17)** — incidents that cannot close without a
  root cause and corrective action, unsafe observations that cannot be filed
  unresolved, failed tests requiring a note, punch items needing a named
  verifier, connectors that cannot be enabled without a credential, and
  idempotency keys that refuse a duplicate sync.

### The security gate is itself tested

The RLS coverage gate is the safety net for the whole isolation design, so it is
exercised directly rather than trusted: a test creates an unprotected table,
confirms `app.assert_security_gates()` fails naming it, protects it, confirms the
gate passes, grants `anon` access, and confirms the privilege gate fails too.

### Bugs found and fixed by these tests

1. **The audit trigger's no-op short-circuit was unreachable.** `set_updated_at`
   fires first and stamps `updated_at`, so `to_jsonb(old) = to_jsonb(new)` was never
   true and every no-op update wrote a ledger entry. Fixed by excluding `updated_at`
   from the comparison.
2. **The anonymous role relied on RLS alone.** Adding explicit `GRANT`s (migration
   `0012`) plus a privilege gate gives two independent controls instead of one.
3. **Immutability triggers misread generated columns.** PostgreSQL does not
   populate a generated column in a `BEFORE` trigger, so `OLD` carried the stored
   value while `NEW` carried `NULL` — every certified pay application looked
   changed. Fixed by skipping generated columns (they cannot move unless a source
   column moves, and those are checked), and the same hardening was applied to the
   estimate-version and proposal triggers before they could hit it.

---

## Edge Functions — 58 tests

The billing state machine is written as a pure function with no Deno imports, which
is what makes it testable without a Stripe account or a live database. This is the
one place where a silent bug means either granting access nobody paid for or
revoking access someone did.

- Plan resolution from the charged price; metadata fallback **reported as a warning**;
  refusal to guess when neither is available; multi-plan subscriptions flagged.
- Entitlement granted on `active`, `trialing` and `past_due` (the dunning window);
  revoked on `canceled`, `incomplete`, `incomplete_expired`, `unpaid` and `paused`,
  with every limit zeroed.
- Nothing granted when the price maps to no known plan, **even if the subscription is
  active** — the strongest case, since an unknown price is exactly how a mis-wired
  Stripe account would over-grant.
- The three-day grace window past period end; period dates read from either the
  subscription or its items across Stripe API versions.
- Seat quantity summed across items; a null quantity defaulting to one, not zero;
  unlimited plan limits carried through as `null` rather than `0`.
- Plan request validation: unknown, retired and non-public plans rejected; an
  unrecognized interval falling back to monthly rather than failing open;
  non-string plan ids rejected.

### AI governance contract (28 tests)

The plan-analysis prompt and validator are pure and Deno-free, so the governance
is testable without an API key:

- The system prompt is asserted to forbid the model from computing cost, price,
  production, duration, crew size or markup; to forbid resolving a conflict by
  picking a side; to forbid inventing dimensions; and to require evidence.
- The validator **rejects a factual finding with no citation** — for every
  factual type, and for a citation whose reference is blank. A prompt asks; a
  validator guarantees.
- A quantity candidate with no quantity or no stated measurement method is
  rejected, because an unscored quantity must never reach an estimate.
- A non-factual finding (a risk, an observation) is allowed without a citation,
  since it is a judgment rather than a claim about the documents.
- Good findings survive when bad ones are rejected — one malformed item does not
  discard the run.
- `toFindingRow` always writes `state: 'proposed'` **whatever the model said**,
  and a property test across every finding type and confidence level confirms
  nothing an agent produces can ever be routed to `auto_accept`.

### Not covered

The Deno HTTP handlers themselves — signature verification, the idempotency upsert,
the Supabase writes — are **not** unit tested, because Deno is not available in this
environment. Their logic is straightforward orchestration over the tested state
machine, but the deployment runbook includes a manual verification procedure
(`stripe listen`, trigger, replay) that must be run before going live.

---

## Web application — 44 tests

- **Formatting** (14) — money, compact money, unit rates, quantities, percentages;
  missing values rendered as an em dash rather than `$0.00`; acronym preservation
  (`rfi_required` → `RFI Required`, not `Rfi Required`); pluralization
  (`1 estimate`, not `1 estimates`); relative bid deadlines; invalid dates.
- **Landing page** (9) — every element the brief specifies: the navigation, both
  calls to action, the exact headline, the three benefit cards, all eleven
  construction sectors, the four security commitments, the pricing route, and the
  footer link groups. One test asserts the hero preview renders **real engine
  output**, so a change in the engine surfaces on the marketing page instead of
  drifting away from it.
- **AI governance** (5) — every proposed finding shows its citations; accept and
  reject appear only on undecided findings; accepting records the reviewer and
  removes the controls; superseded documents stay in the register.
- **Estimate workspace** (10) — the engine result rather than a re-typed number;
  issue disabled while a line requires an RFI; the full derivation revealed on
  expand; the three Section 25 production numbers; every markup component with its
  basis and dollar effect; every cost bucket separately visible; cut/fill in correct
  volume states; the bid reconciliation never adopting the owner quantity; engine
  notices surfaced rather than suppressed.
- **Demo integrity** (6) — line costs summing exactly to the estimate total, price
  above cost, bid rounded up to a $500 increment, the RFI line blocking issue, and
  the haul tracing to the cut/fill export.

### Bug found and fixed by these tests

The demo estimate computed a cut/fill balance and a haul analysis but **never
attached the haul to a line**, so $107,000 of trucking and disposal sat outside the
estimate total. Fixed by attaching the haul to the mass excavation line that
generates the export, and deriving `HAUL` from the priced line rather than
recomputing it in parallel — so the earthwork tab and the estimate total cannot
disagree.

---

## Manual verification performed

- Production build: **no chunk over 500 KB**; the landing page loads 423 KB raw
  (≈138 KB gzipped) and correctly excludes the Supabase client.
- All 15 routes render with **zero console errors**.
- The estimate workspace line expansion was driven in a real browser and confirmed to
  render the crew breakdown, equipment with rate sources, the quantity chain with its
  adjustment reasons, the three production numbers, the applied modifiers with their
  justifications, the confidence factor breakdown and the full derivation.

---

## Gaps, stated plainly

| Area | Status |
|---|---|
| Deno HTTP handlers | Logic tested; the handlers themselves need manual verification per the runbook |
| Storage bucket policies | Specified in the runbook, created outside migrations, **not covered by tests** |
| AI document pipeline | Governance complete and tested; **no model is wired** to ingestion or inference |
| Proposal PDF rendering | Data model and preview action exist; the renderer is not implemented |
| Procurement, fleet, scheduling, HSE, GIS, machine control | Entitlement flags and architectural place only; no screens |
| End-to-end browser automation | Not set up; component tests plus manual browser verification cover the paths |
| Load and performance testing | Not performed |
| Penetration testing | Not performed |
| Accessibility audit | Semantic HTML, ARIA labels, focus-visible styling and keyboard-operable components throughout; **no formal WCAG audit** |


---

## Document rendering — 57 tests, 98.43% statements

The PDF writer is dependency-free, so these tests parse the bytes it emits
rather than trusting that a library did the right thing. `tests/helpers.ts`
implements enough of a PDF reader to check structure and placement.

- **Structure** — every document starts with a PDF header, ends with `%%EOF`,
  declares a page count matching its page objects, and declares honest stream
  lengths. `file(1)` independently identifies the output as *PDF document,
  version 1.7*.
- **Cross-reference table** — every xref entry is checked to point at the byte
  offset of the object it claims. A wrong offset produces a file some readers
  open and others reject, which is invisible until it reaches an owner.
- **Determinism** — the same input renders to identical bytes. The clock is
  injected, not read, which is what lets a pay application be hashed.
- **Font metrics** — Helvetica and Helvetica-Bold widths spot-checked against
  the published Adobe AFM. Every digit is the same width, or right-aligned money
  columns do not line up.
- **Text outside ASCII** — an explicit transliteration table, with a test
  asserting every mapping it claims. A character with no mapping is *reported*,
  not silently replaced.
- **Pay application arithmetic** — completed-to-date, retainage, previous
  certificates and payment due, each computed from the lines and cross-checked
  for internal reconciliation. A document cannot state a total its own lines do
  not support.
- **Pagination** — a 120-line application runs to further pages with the table
  header repeated on each, and every page numbered.
- **Placement** — no string is drawn below the bottom margin or past the right
  margin, and the acceptance block never splits across pages. This test was
  verified to fail when the block's reserved height is deliberately understated.
- **Escaping** — a company name containing parentheses does not corrupt the
  file. An unescaped `)` ends a PDF string early and breaks every object after it.

## Connectors — NOAA weather adapter and the runtime

Every case runs against recorded `api.weather.gov` payloads through an injected
`HttpFetch`, so the suite needs no network, no credentials and no vendor
account. That is why NOAA was chosen as the reference adapter.

- **Unit conversion** — freezing and boiling points exactly; millimeters to
  inches against the definition; meters per second to miles per hour.
- **Quality control** — an observation NWS itself flagged as failed is discarded
  rather than recorded. A missing reading stays null: "no precipitation reading"
  and "no precipitation" are different facts, and only one supports a rain-day
  claim.
- **Local-day rollup** — an 03:00 UTC observation files under the previous local
  day at UTC-4. A UTC rollup puts an evening storm on the wrong day, which is
  the day a delay claim turns on.
- **Thresholds** — precipitation, wind, freeze and heat exceedances, with
  per-project overrides. The record says a threshold was crossed; it never says
  the delay is compensable, because that is a contract question.
- **Idempotency** — the external id is qualified by station and date, so
  re-pulling a window updates in place and switching station produces a visibly
  different record.
- **Runtime** — retries a 503 and not a 404; refuses a misconfigured connector
  without touching the network; reports `partial` when a write fails or records
  were skipped; never throws, because a failed run is a row.

## Public API gateway

The authorization decision is pure, so it is tested without a deployment — a
security check that can only be exercised against a running system is a check
nobody runs.

- **Order of checks** — the key is validated before the route is matched, so an
  unauthenticated caller cannot enumerate which endpoints exist.
- **No key-existence oracle** — an unknown key returns exactly the same code,
  status and message as a malformed one.
- **Scope** — every write route is asserted to require a write scope; a read
  scope cannot reach a write endpoint; an unrecognized scope on a key is inert.
- **Tenancy** — every authorization names the company the request must be
  filtered to. The scope decides what kind of record may be read; the company
  decides which records exist.
- **Routing** — no prefix matching, and an empty path segment is rejected rather
  than collapsed. Collapsing it shifted every parameter left, so
  `/projects//cost-summary` resolved to "the project named cost-summary". That
  was a real defect, found by these tests.
- **Rate limiting** — boundary at the limit, a fresh window after sixty seconds,
  and a `Retry-After` header carrying the real remainder.

## Document ingestion

Fixtures are real PDFs built with the platform's own writer, so the inspector
parses genuine PDF structure.

- **Text-layer detection** — a vector drawing set is read directly; a scan with a
  digital stamp applied afterwards is correctly *not* treated as having a text
  layer.
- **Both text operators** — `(x) Tj` and `[(x) -250 (y)] TJ`. Missing the array
  form is the classic reason a fully digital set is reported as a scan.
- **Object splitting** — the file is split into objects before streams are read.
  Matching `obj … << dict >> … stream` in one pass backtracks across object
  boundaries and files a content stream under the catalog's object number. That
  was a real defect, found by these tests.
- **Sheet identification** — the National CAD Standard prefix table, with `FP`
  matched before `F`; the last plausible sheet number preferred, because the
  title block sits after the callouts; content cues when there is no number.
- **Duplicate sheet numbers are surfaced, never deduplicated** — a revised sheet
  bound alongside the original is a real condition and someone must decide which
  governs.
- **OCR routing** — a digital set never calls OCR at all; a scan sends only the
  pages that need it; OCR text is never promoted to high confidence; a failed
  OCR keeps the pages that read cleanly.
- **Refusals** — an encrypted document fails with "upload a copy without a
  password" rather than billing OCR for every page.

## Semantic layer

- **`security_invoker` is asserted on every `reporting_%` view**, both by a
  migration-time check that refuses to apply otherwise and by a test. Without
  it a view runs as its owner and reads past RLS on every table beneath it.
- **`anon` holds no grant on any reporting view.**
- **Cross-tenant reads return only the caller's own rows**, checked from two
  companies.
- **The arithmetic matches the comments** — executed change orders count and
  merely approved ones do not; billed-to-date is the latest application and
  never a sum of cumulative ones; burden sits with labor and fuel with
  equipment; margin is measured against the revised contract.
- **Metric governance** — 16 seeded global definitions, every one carrying a
  description; the OSHA 200,000-hour basis stated inside the TRIR and DART
  definitions; a company override that does not disturb the global row; a
  refused duplicate global key; a refused key that is not a stable identifier.

## White-label theming

- **WCAG reference values** — black on white is exactly 21:1; the luminance of
  pure black and pure white are 0 and 1.
- **Text color is measured, not assumed** — dark text on the brand gold, white
  on the charcoal, and in every case the higher-contrast of the two.
- **Generated scales run monotonically** from light to dark and keep hue at both
  ends rather than washing out to gray.
- **Problems are reported, not silently corrected** — a brand color that fails
  AA produces a warning and is still used. Darkening a company's brand behind
  its back is not the fix.
- **Semantic colors are never themed.** Overdue is red in every tenant.
