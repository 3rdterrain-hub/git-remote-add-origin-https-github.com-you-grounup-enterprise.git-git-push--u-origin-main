# Build summary

## What was delivered

| Area | Files | Lines |
|---|---:|---:|
| Estimating engine (source + tests) | 38 | ~11,200 |
| Document rendering (source + tests) | 8 | ~1,800 |
| Database migrations (56 files, 137 tables, 13 views) | 56 | ~12,600 |
| Edge Functions + shared modules | 28 | ~4,500 |
| Database & function tests | 43 | ~11,000 |
| Governance & traceability tests | 6 | ~2,700 |
| Web application (30 routes, 23 app screens) | 82 | ~13,600 |
| Documentation | 13 | ~4,400 |
| Seed & tooling | 7 | ~1,800 |
| **Total hand-written** | **281** | **~63,700** |

Plus 4,905 lines of generated seed SQL carrying 4,671 catalog records, an
OpenAPI specification generated from the gateway's own route table, and the
official brand vectors extracted from the supplied logo files.

## Verification

`npm run verify` — typecheck, OpenAPI drift check, verification and traceability
drift checks, 1,961 tests, production build —
**exits 0 from a clean working tree**.

```
Engine        529 tests   estimating, surfaces, calendars, critical path
PDF            57 tests   parsing the bytes it emits
Database      737 tests   against real PostgreSQL 18 (PGlite)
Functions     229 tests   billing, plan versioning, AI governance, API, observability
Governance    252 tests   the five-category rule, traceability, verification, spelling, pipeline
Web           157 tests   jsdom + Testing Library
            ───────────
            1,961 tests
```

Two things are worth naming about how these run. The database tests execute the
**production migrations, unmodified**, against a real PostgreSQL 18 — not a
mock, and not a separate test schema. And the connector and API suites need no
credentials, no network and no deployment, which is why they run on every
commit rather than only when someone remembers.

## Coverage against the architecture

**44 of the 45 services** in `architecture-v1.0/02_service_catalog.csv` are built
with a working screen, schema and governance tests. See
[`COVERAGE.md`](COVERAGE.md) for the service-by-service map and the honest list of
what is not built.

## Defects found and fixed during the build

Each was found by a test or by looking at the running app, and fixed in the code
rather than worked around:

1. **Stacked markup never stacked.** `standardProfile` emitted a pinned basis, so
   parallel and stacked profiles produced identical prices, and the regional
   factor was excluded from the markup basis entirely.
2. **The audit trigger's no-op short-circuit was unreachable.** `set_updated_at`
   fires first, so every no-op update wrote a ledger entry.
3. **The anonymous role relied on RLS alone.** Explicit `GRANT`s plus a privilege
   gate now give two independent controls.
4. **The demo estimate priced a haul it never included** — $107,000 of trucking
   and disposal sat outside the total because the haul analysis ran parallel to
   the estimate instead of inside it.
5. **The workspace typecheck depended on build order.** A clean checkout failed
   because the web app resolved the engine through its built output.
6. **Dead code in the crew cost function**, surfaced by the app's stricter
   compiler settings; the engine's own config was tightened to catch that class.
7. **Immutability triggers misread generated columns.** PostgreSQL leaves them
   unpopulated in a `BEFORE` trigger, so every certified pay application looked
   changed. Fixed, and the same hardening applied to two other triggers
   pre-emptively.
8. **The wrong logo and the wrong gold.** The build shipped an invented mark and
   `#F5B800`. The supplied `07-Brand-Assets/` had the real logo and a brand
   reference stating the palette is `#000000` and `#F6C101`. Corrected by
   extracting the true vector paths from the logo PDFs, rebuilding the gold scale
   on `#F6C101`, and adding eight tests so it cannot regress.
9. **Calendar dates shifted a day.** A bare `YYYY-MM-DD` parses as UTC midnight
   and rendered as the previous day west of Greenwich — a daily report dated the
   31st displayed as the 30th.
10. **Copy defects**: `titleCase` rendering "RFI" as "Rfi"; "1 estimates in
    progress"; "2 machines past **its** service interval"; "critical-path
    activitys". All fixed with tested helpers.
11. **The prismoidal method was algebraically identical to average end area.**
    With the mid-section taken as the mean of the two ends,
    `(A1 + 4·((A1+A2)/2) + A2)·L/6` reduces exactly to `(A1+A2)·L/2`. The code
    claimed a correction that did not exist. Fixed by accepting a *surveyed*
    mid-section, counting the segments that lack one, and warning about them.
12. **Precision lost by subtracting rounded yardages.** Progress-to-grade
    computed `4629.6297` where the correct figure is `4629.6296`. Fixed by
    exposing raw cubic feet and doing the arithmetic before rounding.
13. **A `UNIQUE` constraint treated NULL as distinct**, so a company could leave
    unlimited network ratings for a vendor simply by not attaching a project.
    Fixed with `unique nulls not distinct`.
14. **An empty path segment shifted every API parameter left.** The gateway
    resolved `/v1/projects//cost-summary` to "the project named cost-summary"
    instead of returning 404. Fixed by rejecting empty interior segments rather
    than collapsing them.
15. **A PDF content stream was filed under the wrong object number.** Matching
    `N 0 obj … << dict >> … stream` in one pass lets the dictionary pattern
    backtrack across object boundaries until it finds one followed by `stream`.
    Every drawing set with a text layer was therefore reported as a scan. Fixed
    by splitting the file into objects first.
16. **A reporting view is an RLS bypass by default.** A view runs as its owner
    unless `security_invoker` is set. Fixed by setting it, and then by adding a
    migration-time assertion that refuses to apply if any `reporting_%` view
    lacks it — the property is enforced, not remembered.
17. **The API screen's endpoint list was hand-maintained** and had already
    fallen a route behind the gateway. Fixed by generating the OpenAPI spec from
    the gateway's route table and having both the docs and the screen read it,
    with `npm run verify` failing on drift.
18. **British spellings throughout.** `Mobilisation`, `Labour`, `Authorised`,
    `colour`, `utilisation` and 40 other words were corrected to American
    English across 78 files, after checking each occurrence individually so
    correct forms (`analysis`, `emphasis`, `cancellation`) and external API
    field names (`cancellation_details`) were left alone.

    A single session of new writing afterwards put 100 more back, including one
    inside a SQL enum value where the spelling would have reached stored data.
    A correction pass that is not enforced is a correction pass you get to do
    again, so it is now a test: `tests/governance/spelling.test.ts` matches the
    `-ise`/`-isation` family generatively rather than from a list — so a word
    nobody thought of still fails — plus the `-our`, `-re`, `-ence`,
    doubled-consonant and trade-vocabulary forms that rule cannot see
    (`kerb`, `tyre`, `storey`, `levelling`, `mould`, `aluminium`). Words quoted
    in backticks inside Markdown are read as quotations, not spellings, which
    is what lets this paragraph name them.

19. **The platform stored schedule float and computed none of it.**
    `schedule_activities` carried `total_float_days` and `is_critical`,
    `schedule_dependencies` carried all four relationship types with lag, and
    nothing anywhere traversed the graph. A check constraint required that
    `is_critical = (total_float_days <= 0)`, which enforced that two numbers a
    caller typed agreed with each other, and the schedule screen displayed them
    in the same style it displays derived figures. The hand-authored demo dates
    also ran a thirty-day activity straight through Memorial Day. Fixed by
    building the calculation — `calendar.ts` and `schedule.ts` in the engine,
    migration 0029 in the database — and by making float impossible to write
    without naming the calculation that produced it.

20. **Counts in the documentation had drifted from the repository.** The root
    README said 122 tables against a registry holding 131, `governance/README.md`
    said 16 engines against 28, `ARCHITECTURE.md` said twelve migrations against
    29 and listed nine of eighteen engine modules, and the traceability README
    claimed 215 cataloged artifacts and 45 verified requirements against 255 and
    1,140. Every one was written truthfully and overtaken by the next build.
    Fixed, and both READMEs now have tests that recompute their stated numbers
    from `registry.json` and `summary.json`.

21. **The pricing page sold capabilities that do not exist.** Enterprise
    advertised "SSO, advanced security and data residency options", the
    comparison table carried an SSO row marked included, and the seeded plan
    description said the same. There is no SAML, no OIDC and no region
    selection anywhere in the codebase — the settings screen lists single
    sign-on under "Not yet available". The comparison table's booleans were
    also hand-authored with no link to `plans.features`, so moving a feature
    between plans left the page selling the previous arrangement. Fixed by
    removing the claims and by tying every entitlement-backed row to the
    seeded catalog, checked by test.

22. **Commercial terms were resolved against a table that had since moved.**
    `entitlement.features` was copied from whatever `plans.features` said at
    the moment a webhook arrived, so editing a plan re-termed every existing
    subscriber and nothing could answer what a customer had been sold. Fixed
    with `plan_versions`, published by trigger, append-only, pinned onto the
    subscription and the entitlement, with grandfathering in the state machine.

23. **Every plan limit was decorative.** Seats, active estimates, active
    projects, storage and AI credits were stored on the plan, copied to the
    entitlement, sold on the pricing page, and enforced nowhere. The three a
    customer actually meets are now enforced; storage and AI credits are
    deliberately left alone, because nothing meters either and a limit checked
    against a number nobody computes would be the same defect one layer down.

24. **Tables added after migration 0011 arrived unaudited.** That migration
    attached the audit and `updated_at` triggers by looping over the tables
    that existed at the time, and nothing ran the loop again — so everything
    from 0026 onward had neither, including a work calendar whose holidays move
    every date on a project schedule, and `stripe_events`, whose payload could
    be edited after processing with no trace. Fixed, and the general rule is
    now a test: every table is either audited or frozen, with an exemption list
    capped at three entries that each state a reason.

25. **A React key sat on the wrong element in the pricing table.** The
    comparison groups were rendered with `COMPARISON.map(group => <>...</>)`
    and the key placed on a `TableRow` inside the fragment. The element `map`
    returns is the list child, so React had no key for it and warned on every
    render — reconciliation across the group list was by position. Found by
    reading the browser console while checking the SSO removal, not by any
    test. Fixed with a keyed `Fragment`.

26. **No commercial record was protected once it was agreed.** RULE-009 makes
    an issued estimate immutable — an offer. Nothing protected the obligations
    that follow it: an executed contract's value, dates, retainage, liquidated
    damages and notice clauses were editable, an approved change order's price
    and schedule impact were editable, and a settled claim's award and
    reasoning were editable. Fixed by freezing what the parties agreed on all
    three, while leaving the fields that legitimately move afterwards free.

27. **A claim deadline could be typed instead of derived.** The derivation ran
    only when the column was null, so supplying `notice_due_on` bypassed the
    contract clause with no record, and nothing re-derived a deadline when the
    clause changed. Most construction claims are lost on the notice clause
    rather than on their merits. Now always computed, with a disagreeing value
    refused and pointed at the override mechanism — and, after a test caught
    the first attempt, still allowing an event date to be corrected.

28. **A claim's supporting evidence had no integrity.** Three `uuid[]` columns
    that could cite a record which does not exist, was deleted, or belongs to
    another company — while the schema calls them the contemporaneous records
    a claim rests on. Now validated on write, per column, with the missing ids
    named.

29. **Nothing limited how much a person could commit.** Permission gated who
    could touch a change order; a user with write access could execute a
    $900,000 amendment. Fixed with per-company signing limits enforced on the
    crossing into a committing state, naming the tier held and the tier needed.

30. **Contracts, change orders and claims had no tests at all** — while the
    traceability matrix counted them as tested. Every one of the four defects
    above was found by writing the 39-test suite that should have existed.

31. **Job cost had no cutoff.** `project_costs` carried a `cost_date` and
    `ap_invoices` an `invoice_date`, and nothing could close a period — a cost
    dated last March could be posted today, changing a job cost figure already
    reported to an owner, a bank or a bonding company. The same family as the
    schedule float and the claim deadline, but retroactive: the report was
    right when it was produced and wrong afterwards, with nothing saying which.
    Fixed with non-overlapping accounting periods, a close that refuses to run
    over an open pay application, an attributed reopen, and a cutoff that
    refuses a posting into a closed period and equally refuses moving one out
    of it. A company that defines no periods is left alone.

32. **The safety system recorded everything and prevented nothing.**
    `credentials.required_for` had carried "work this credential is a
    prerequisite for, e.g. CDL for a truck driver" since the workforce
    migration and nothing read it; `refresh_credential_status` kept the status
    honest and nothing consumed it. An employee whose CDL expired last month
    could be assigned to drive, with the expiry and the assignment recorded
    side by side and never connected. Fixed with a requirement matrix stated
    from the work's side — a rule written on the credential can only catch a
    lapse, never an absence — and a trigger that refuses the assignment,
    naming the person and what is missing.

33. **The notifications table had no producer anywhere in the codebase.**
    Twelve categories, severities, deep links, a preferences table, and across
    the whole platform nothing inserted into it except tests. A recordable
    injury notified nobody. Given its first two producers: a recordable
    incident and a credential entering its expiry window, both firing on the
    transition rather than on every touch.

34. **A document's current version was a number somebody typed.** Uploading
    version 3 did not advance `documents.current_version`, and setting it to 7
    when two versions existed was accepted — while every screen showing a
    revision read that column. Now counted from the versions that exist, with a
    directly written value refused.

35. **The extracted text of every sheet was indexed and unsearchable.**
    `document_sheets.extracted_text` carried a GIN trigram index and a comment
    saying it was "used for permission-filtered search across the plan set",
    and nothing queried it. Given `app.search_document_text`, returning the
    document, version, page, sheet number and a snippet windowed around the
    match, SECURITY INVOKER so the permission filtering is real.

36. **Supersession could close a loop**, so any walk of a revision chain would
    never terminate. Self-reference refused by constraint, longer cycles by a
    trigger that names the path it followed.

37. **A document version could be attached across a tenant boundary.**
    `document_versions` and `document_sheets` had no tenant-parent guard: row
    level security passed because the row carried the writer's own company_id
    and the foreign key passed because the document existed. The owning company
    could not see the row and would still have felt it, because the new
    current-version trigger counts every version a document has. Found by the
    tests written for the fix above.

38. **The commitment a contractor makes most often had no signing limit.**
    Migration 0033 bounded change orders, contracts and claim settlements by
    approval tier and did not cover purchase orders — while every other
    procurement control (invoice within commitment, payment within invoice,
    three-way match, award reason, discrepancy note, adjustment reason) governs
    what happens *after* the commitment. Fixed by extending the same mechanism
    to purchase orders on the crossing into issued.

39. **Fleet cost never reached the job.** A fuel transaction carried a project,
    gallons, a price and a generated total; `project_costs` carried a fuel cost
    type, a `fuel_card` source, an equipment reference and a `reference` column
    for provenance. Both sides were shaped for the posting and nothing wrote
    it, so a machine could burn $400 of diesel on a job the cost report never
    saw. Now posted and kept in sync with corrections and deletions, and
    subject to the financial period cutoff like any other job cost.

40. **No fleet exception reached anybody** — the notification table did not
    even carry a fleet category. A machine going down is the event most likely
    to move a schedule. Two producers added: a machine entering `down`, and a
    service crossing its meter interval.

41. **The secret boundary was true by construction and enforced by nothing.**
    The Stripe key, the webhook signing secret, the service-role key and the AI
    provider key lived only in Edge Function secrets because the browser code
    never reached for them, and nothing checked. One `VITE_`-prefixed variable
    would have published a credential into every bundle, since Vite inlines
    every `VITE_` variable by design. `npm run bundle:check` now scans the
    emitted files by name and by shape, and runs in both workflows.

    Its own first version was wrong: the service-role check hard-coded one
    base64 encoding of `service_role` and passed a realistic JWT. Base64
    encodes three bytes at a time, so the substring has three encodings
    depending on its offset. Found by planting a real token shape and watching
    the check succeed when it should have failed. All three are now computed.

42. **The AI credit allowance was metered and never checked — and this build's
    own P30 verdict said it could not be.** Every analyst run has always
    written a `usage_events` row with metric `ai.request`, and
    `app.current_usage` has always aggregated it over the paid period. Both
    halves existed and nothing joined them, so the allowance published on every
    plan version bounded nothing. Migration 0039 joins them and the analyst now
    refuses a request past the allowance with a message saying when it resets.

    The P30 verdict has been corrected in place, with the correction recorded
    rather than the original quietly rewritten, and a test asserts it is there.
    A verdict that overstates an obstacle protects the gap it describes — a
    defect in the checking is worse than one in the code.

## Environment note

This machine had no Node toolchain, no Docker and no PostgreSQL. Node 24.20 LTS
was installed locally under `~/.grounup-tools` (no sudo, contained). Rather than
skip database testing for want of Docker, the suite runs the production
migrations against **PGlite** — PostgreSQL 18 compiled to WebAssembly — so RLS,
constraints and triggers are genuinely executed rather than assumed.
