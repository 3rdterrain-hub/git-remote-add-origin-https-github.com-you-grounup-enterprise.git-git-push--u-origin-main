# GrounUp Enterprise

An AI-powered construction operating system that connects estimating, plan and
specification intelligence, project operations and business management in one
governed platform.

The organizing idea: **AI decides what to look at; a deterministic engine decides
what it costs; a human approves anything consequential.** Asking a language model
to do estimating arithmetic is how you get a confident wrong number, so GrounUp
splits the work along the line where each side is actually good.

---

## What is here

| Layer | Location | What it does |
|---|---|---|
| **Estimating engine** | `packages/engine` | Every authoritative number, including surface volumes. Pure TypeScript, zero dependencies, 525 tests. |
| **Document rendering** | `packages/pdf` | Proposals, pay applications and reports as real PDFs. Dependency-free and deterministic, so the same document always renders to the same bytes. |
| **Database** | `supabase/migrations` | 44 migrations, 136 tables, 11 reporting views: multi-tenant schema, RLS forced on every table, audit ledger, governance triggers. |
| **Seed library** | `supabase/seed` | 4,671 catalog records generated from the governed GrounUp v2.0 package. |
| **Edge Functions** | `supabase/functions` | Stripe checkout, portal, webhooks, entitlements, the governed AI document analyst, and the public API gateway. |
| **Observability** | `supabase/functions/_shared/observability` | Structured logging with request correlation, metrics, and health/readiness — everything redacted on the way out by field name and by value shape. |
| **Connectors** | `supabase/functions/_shared/connectors` | An adapter framework with injected I/O, and a working NOAA National Weather Service adapter. |
| **Ingestion** | `supabase/functions/_shared/ingestion` | PDF splitting, text-layer detection, sheet classification against the National CAD Standard, with OCR as a pluggable interface. |
| **Web application** | `apps/web` | React 19 + Tailwind 4 + shadcn/ui, the official brand marks. 23 authenticated screens plus the public site. |
| **Tests** | `packages/engine/tests`, `packages/pdf/tests`, `tests/db`, `tests/functions`, `tests/governance`, `apps/web/src` | 1,277 tests across six layers. |
| **Governance** | `governance/` | The five-category rule with 17 enforced invariants, and the Master Traceability Matrix mapping 9,475 GES requirements to what implements them. |
| **Documentation** | `docs/` | Architecture, data model, engine reference, security model, deployment runbook, test report, and a generated OpenAPI spec. |

---

## Running it

Requires Node 20.19+ (developed on Node 24.20).

```bash
npm install
```

```bash
npm run dev
```

The app opens at `http://localhost:5173`. With no Supabase project configured it
runs against a demonstration workspace whose every figure is computed by the real
engine — so the screens show what the engine actually produces, warnings and
approval gates included.

To verify everything:

```bash
npm run verify
```

That runs the typecheck, the OpenAPI, verification and traceability drift checks, all 1,277 tests and a production build. Individual layers:

```bash
npm run test:engine
```

```bash
npm run test:db
```

```bash
npm run test:functions
```

```bash
npm run test:web
```

```bash
npm run test:pdf
```

The database tests execute the production migrations against **real PostgreSQL 18**
(compiled to WebAssembly via PGlite), so tenant isolation, immutability and the
governance triggers are proven rather than asserted. No Docker required.

---

## Connecting a real backend

1. Create a Supabase project.
2. Apply the migrations and the seed:
   ```bash
   supabase db push
   ```
3. Attach the auth trigger (Supabase owns `auth.users`, so it is not in a migration):
   ```sql
   create trigger on_auth_user_created after insert on auth.users
     for each row execute function app.handle_new_user();
   ```
4. Set the frontend environment:
   ```bash
   cp .env.example apps/web/.env.local
   ```
5. Deploy the Edge Functions and set their secrets. Full steps, including the
   Stripe wiring and the webhook that must be deployed with `--no-verify-jwt`,
   are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## The rules the platform enforces

These are not conventions. Each one is enforced by a test, a database constraint,
a trigger or an RLS policy.

| Rule | What it means | Where it is enforced |
|---|---|---|
| RULE-001 | Labor, burden, equipment, fuel, material, trucking, disposal and subcontract cost stay separately visible | `pricing.ts`, every cost table in the UI |
| RULE-002 | Duration comes from quantity ÷ effective production, adjusted for shift and calendar | `production.ts` |
| RULE-003 | Equipment rate hierarchy: project quote > company rate > regional > seed | `resources.ts` |
| RULE-004 | Cycle-based hauling is authoritative; a shortcut rate is labeled preliminary | `trucking.ts` |
| RULE-005 | Production is limited by the slowest dependent resource | `production.ts` |
| RULE-006 | Modifiers apply only to their explicitly declared targets | `production.ts`, `condition_modifiers` trigger |
| RULE-007 | Markup shows its basis, sequence and dollar effect | `pricing.ts`, the estimate Pricing tab |
| RULE-008 | AI creates candidates; approved owners activate changes | `ai_findings` trigger, `approval_requests` |
| RULE-009 | Issued estimate versions are immutable; a revision creates a new version | `enforce_version_immutability` trigger |
| RULE-010 | Every non-company-actual rate carries source, confidence and review state | `production_rates` constraints, confidence engine |

---

## Security posture

- **Tenant isolation** is enforced by PostgreSQL row level security, `FORCE`d on
  every one of the 136 tables, with `app.assert_security_gates()` run at the end
  of every migration that adds a table — the gate is itself covered by a test
  that proves it fails when a table is left open.
- **The anonymous role** holds no table privilege except the public plan catalog,
  so a policy mistake cannot expose business data — two independent controls.
- **A structural tenant guard** blocks a user who legitimately belongs to two
  companies from attaching one company's child row to the other's parent, which
  RLS alone does not prevent.
- **The audit ledger is append-only** and cannot be rewritten by anyone, including
  a superuser.
- **Billing state is written only** from signature-verified Stripe webhooks,
  applied exactly once by event id. No tenant role has any INSERT or UPDATE path
  to `subscriptions` or `entitlements`.
- **Entitlement is never a permission.** A company can be entitled to a feature
  while the signed-in user is not permitted to use it; both checks must pass.
- **No secrets in the browser.** Only the Supabase anon key reaches the bundle.
- **Reporting views run `security_invoker`**, so they inherit RLS from the tables
  beneath them instead of running as their owner and reading past it. A
  migration-time assertion refuses to apply if any `reporting_%` view omits it.
- **API keys are stored only as a SHA-256 hash.** A key is displayed once and
  cannot be recovered, so a database read yields nothing replayable. A key's
  scopes decide what kind of record it may reach; its company decides which
  records exist, and no scope widens that.

The full model, including the threat each control addresses, is in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — how the layers fit together and why
- [Data model](docs/DATA-MODEL.md) — every table, and the decisions behind them
- [Estimating engine](docs/ESTIMATING-ENGINE.md) — the formulas, with worked examples
- [Security model](docs/SECURITY.md) — controls, threats, and what is proven by test
- [Deployment runbook](docs/DEPLOYMENT.md) — Supabase, Stripe, hosting, operations
- [Test report](docs/TEST-REPORT.md) — what is covered, what is not, and the gaps
- [Module coverage](docs/COVERAGE.md) — the service-by-service map, and an honest
  list of what is not built
- [Governance](governance/README.md) — the five-category rule, and the tests that
  enforce it
- [Master Traceability Matrix](governance/traceability/README.md) — 9,475 GES
  requirements mapped to what implements them, with tracing and verification
  kept strictly apart
- [OpenAPI specification](docs/openapi.json) — generated from the gateway's own
  route table, so it cannot describe an endpoint that does not exist
- [Requirements traceability](docs/TRACEABILITY.md) — the brief mapped to the code
- [Build summary](docs/BUILD-SUMMARY.md) — what was delivered, and every defect found and fixed
- [Module coverage](docs/COVERAGE.md) — all 45 architecture services, and exactly what exists for each
