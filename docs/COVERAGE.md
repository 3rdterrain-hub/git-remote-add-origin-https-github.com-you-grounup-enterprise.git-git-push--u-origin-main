# Module coverage

Every service in the GrounUp architecture (`architecture-v1.0/02_service_catalog.csv`),
mapped to what actually exists.

**44 of 45 built · 1 not built.**

"Built" means a working screen, the schema behind it, and governance tests. Not
"the table exists."

---

## Built (44)

### Core platform
| Service | What exists |
|---|---|
| Tenant & Organization | Enterprise groups, companies, divisions, configurable estimating defaults, terminology, branding |
| Identity & Access | 11 system roles, approval tiers 0–4, project scoping, segregation of duties |
| Contacts & Relationships | Customers, contacts, vendor contacts |
| Approval Service | `approval_requests` with tier enforcement and self-approval refusal |
| Audit Ledger | Append-only, trigger-protected, full prior/new state |

### Estimating
| Service | What exists |
|---|---|
| Catalog | 4,671 seeded records across three scopes (global, group, company) |
| Takeoff | Quantity chain with measurement method, adjustments, waste basis, bid reconciliation |
| Production Engine | Theoretical/practical/recommended, modifiers by target, controlling resource, duration |
| Pricing Engine | Ten cost buckets, parallel and stacked markup, regional factor, escalation |
| Estimate | Versions with RULE-009 immutability, line detail, confidence, approval gates |
| Proposal | Generated from a priced version, frozen once issued, branded document preview |

### AI
| Service | What exists |
|---|---|
| AI Orchestrator | Agent registry capped at draft authority, findings channel, acceptance trigger |
| Model & Prompt Registry | Model catalog, prompt versions with mandatory evaluation before promotion |
| Document Ingestion | Full pipeline schema, stage tracking, and a **deployable Edge Function that calls Claude** with a governed prompt, structured output and enforced citations |
| Enterprise Search | `app.search`, SECURITY INVOKER so results are permission-filtered by construction |
| Company Knowledge | Versioned articles; only an approved article may be cited |

### Project & field
| Service | What exists |
|---|---|
| Project | Projects, tasks, WBS, budget baseline traced to its estimate line |
| Estimate-to-Project | `app.award_estimate_version()` carries priced lines across |
| Project Budget | Budget, committed, actual, variance, CPI |
| Field Operations | Daily reports with labor, equipment, installed quantity; frozen once submitted |
| Production & Progress | Actual rate against the catalog rate that priced it, feeding calibration |
| Change Management | Change orders with line detail, margin, schedule impact |
| RFI & Submittal | RFIs and submittals with ball-in-court and lead-time-adjusted submit-by dates |
| Scheduling | Critical path computed from durations and logic on a working calendar: early and late dates, total and free float, baselines and variance |
| Resource Planning | Assignments with an exclusion constraint that refuses double-booked machines |
| Document Control | Documents, versions, sheets, supersession retained for audit |
| Notification | Company-wide and targeted, per-category preferences, working bell |

### Workforce & fleet
| Service | What exists |
|---|---|
| Human Resources | Employees gated behind `hr.read` so a foreman cannot see wages |
| Time & Attendance | Timecards locked once exported to payroll |
| Training & Credential | Status recomputed against the calendar by the database |
| Fleet & Equipment | Assets tied to their catalog rate, utilization against cost per hour |
| Maintenance | Meter-driven schedules, work orders that cannot close without a resolution |
| Fuel & Telematics | Transactions with exception flags for unmatched and outlier volumes |

### Commercial
| Service | What exists |
|---|---|
| Financial Integration | AP invoices with three-way match blocking payment |
| Billing & Pay Application | Schedule of values, AIA G702 arithmetic, certified applications frozen |
| Cash & WIP Forecast | Over/under billing, retainage, monthly cash in and out |
| Procurement | RFQs with leveling, award reasons required, POs with committed cost |
| Inventory | On hand less reserved, transaction ledger, adjustments requiring a reason |
| Vendor & Subcontractor | Vendors, qualification, insurance expiry, performance |
| CRM | Pipeline by stage, opportunities, customers, win/loss with required reasons |
| Analytics | Discipline rollup, equipment utilization, CPI, confidence distribution |

### Safety, quality, integration
| Service | What exists |
|---|---|
| Safety | Incidents that cannot close without a root cause, observations that cannot be filed unresolved, toolbox talks, OSHA recordability |
| Quality | Tests with required-vs-achieved, failures requiring a note, punch items needing a named verifier |
| Connector Runtime | Connector registry, credential *handles* only, run history driving health, idempotency keys, an adapter framework, and a working NOAA/NWS weather adapter |
| GrounUp Network | Published vendor directory across companies, performance ratings written only by a company that held a contract, one rating per company per project |

### Survey, claims and the platform surface
| Service | What exists |
|---|---|
| Survey & Reality Capture | Surveys, surfaces, surface comparisons refused across mismatched datums; cut/fill, cross sections and progress-to-grade computed by the engine |
| Machine Control | Versioned design files by vendor and format, machine assignment, superseded versions retained and named |
| Contract & Claims | Contracts with notice and claim clauses, claims whose deadlines the database derives from the event date |
| Semantic Layer | 16 governed metric definitions with company overrides, four RLS-safe reporting views |
| Public API | Nine versioned endpoints behind scoped, rate-limited, hashed API keys; an OpenAPI spec generated from the gateway's own route table |
| Document Rendering | Proposals, pay applications and reports rendered to PDF by a dependency-free deterministic writer |

---

## Not built (1)

| Service | Why |
|---|---|
| **Connector implementations** | The connector *runtime* and the adapter framework are built, and the NOAA National Weather Service adapter is written, tested and deployable — it was chosen precisely because it needs no credentials, so the whole path is verifiable on every commit. The remaining provider adapters (Sage Intacct, ADP, Trimble VisionLink, WEX) each implement the same `ConnectorAdapter` interface and each needs that vendor's account and API contract. An adapter written against a guess at an API is worse than none, because it looks finished. |

---

## Deliberate limits

Named so nothing is implied that does not exist.

- **OCR is an interface, not an implementation.** The ingestion pipeline splits a
  PDF, detects a text layer, classifies every sheet by its number and builds a
  drawing index — and routes only the pages that genuinely need it to an
  injected `OcrProvider`. No OCR vendor is bundled, for the same reason no
  accounting adapter is: each needs an account. A set with a text layer never
  reaches OCR at all, which is both cheaper and more accurate than sending it.
- **The GrounUp Network is a subcontractor and supplier directory**, which is the
  scope that was chosen. It is not a marketplace: there is no bidding, no
  payments and no moderation queue, because those carry a trust and payments
  model that is a separate product decision.
- **Compressed PDF content streams are not decoded by the inspector.** It reports
  those pages as having no readable text layer and says so in a warning; the
  extraction stage decompresses them.
- **The PDF writer supports the Adobe Core-14 fonts and ASCII.** Text outside that
  range is transliterated through an explicit, tested table rather than rendered
  with approximate widths, because "close but wrong" in a column of money is a
  document that has to be reissued.
- **The reporting views are the semantic layer.** There is no separate warehouse:
  the views run `security_invoker`, so they inherit RLS from the tables beneath
  them, and a migration-time assertion refuses any `reporting_%` view that does
  not.
