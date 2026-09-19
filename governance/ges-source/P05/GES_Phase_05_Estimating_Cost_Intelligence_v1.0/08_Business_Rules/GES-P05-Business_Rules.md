# Business Rules

| rule_id | title | rule | severity | enforcement |
|---|---|---|---|---|
| GES-P05-BR-001 | Immutable approved versions | An approved estimate version shall not be edited; changes require a new version. | Critical | System |
| GES-P05-BR-002 | Calculation trace required | Every sell amount shall retain traceable quantity, rate, formula, factors and markup sources. | Critical | System |
| GES-P05-BR-003 | Tenant isolation | No tenant may access another tenant’s estimates, pricing, actuals or configurations. | Critical | System |
| GES-P05-BR-004 | AI requires disposition | Material AI recommendations shall be accepted, modified or rejected by an authorized user. | Critical | System |
| GES-P05-BR-005 | Unit compatibility | Quantity and resource units shall be dimensionally compatible before calculation. | Critical | System |
| GES-P05-BR-006 | Effective-date pricing | Pricing records shall be selected using estimate date and effective-date rules. | Critical | System |
| GES-P05-BR-007 | Quote precedence | Approved project-specific quotes override regional and library prices for their scope. | Critical | System |
| GES-P05-BR-008 | Markup sequence | Markup profiles shall define whether each component is additive, compounded or margin-targeted. | Critical | System |
| GES-P05-BR-009 | No hidden overrides | Manual overrides shall require reason, author and timestamp. | Critical | System |
| GES-P05-BR-010 | Crew balance | Crew output shall be constrained by the bottleneck resource unless an approved rule states otherwise. | Critical | System |
| GES-P05-BR-011 | Haul cycle completeness | Truck calculations shall include load, travel, unload, return, queue and delay components. | High | System |
| GES-P05-BR-012 | Swell and shrink separation | Bank, loose and compacted volumes shall not be treated as interchangeable. | High | System |
| GES-P05-BR-013 | Confidence propagation | Estimate confidence shall consider source confidence, quantity confidence, rate confidence and risk. | High | System |
| GES-P05-BR-014 | Historical calibration approval | Actual-based calibration shall not update master rates without review and approval. | High | System |
| GES-P05-BR-015 | Role-based visibility | User workspaces shall expose only permitted modules, records and actions. | High | System |
| GES-P05-BR-016 | White-label inheritance | OEM child tenants shall inherit allowed defaults while preserving approved local overrides. | High | System |
| GES-P05-BR-017 | Offline conflict handling | Offline changes shall use deterministic conflict detection and review. | High | System |
| GES-P05-BR-018 | Currency consistency | A single estimate version shall use one base currency with explicit conversion records when needed. | High | System |
| GES-P05-BR-019 | Tax jurisdiction | Tax rules shall be selected from project jurisdiction and effective date. | High | System |
| GES-P05-BR-020 | Estimate lock | Submitted estimates shall be locked from unapproved edits. | High | System |
| GES-P05-BR-021 | Source retention | Referenced plans, quotes and attachments shall be retained according to policy. | High | System |
| GES-P05-BR-022 | Scenario isolation | Scenario changes shall not alter the baseline estimate until promoted. | High | System |
| GES-P05-BR-023 | Rounding policy | Rounding shall occur only at configured stages and retain unrounded calculation values. | High | System |
| GES-P05-BR-024 | Negative cost control | Negative quantities or rates require an approved adjustment type. | High | System |
| GES-P05-BR-025 | Deletion policy | Used master records shall be retired, not deleted. | High | System |
| GES-P05-BR-026 | Regional override priority | Tenant and project overrides shall follow an explicit precedence hierarchy. | High | System |
| GES-P05-BR-027 | Production factor bounds | Condition factors outside configured bounds require approval. | High | System |
| GES-P05-BR-028 | Fuel model selection | Equipment fuel may use measured, manufacturer, historical or formula sources with source type recorded. | High | System |
| GES-P05-BR-029 | Bid audit export | The system shall produce a review package containing assumptions, exceptions and calculation lineage. | High | System |
| GES-P05-BR-030 | Template governance | Published templates require version, owner and approval status. | High | System |