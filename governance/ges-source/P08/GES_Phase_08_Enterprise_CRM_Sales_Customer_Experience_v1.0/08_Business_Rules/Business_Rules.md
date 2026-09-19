# Phase 08 Business Rules

| ID | Rule | Definition |
|---|---|---|
| GES-P08-BR-001 | Lead Deduplication | Potential duplicate leads must be flagged before creation using configurable identity keys. |
| GES-P08-BR-002 | Source Preservation | Original lead source is immutable; later touches are recorded separately. |
| GES-P08-BR-003 | Consent Enforcement | Marketing communication may occur only under valid channel consent and jurisdiction rules. |
| GES-P08-BR-004 | Ownership | Every active lead and opportunity must have one accountable owner or governed queue. |
| GES-P08-BR-005 | Stage Governance | Opportunity stage changes must follow the configured transition matrix. |
| GES-P08-BR-006 | Lost Opportunity | A lost opportunity requires a standardized lost reason and optional competitor. |
| GES-P08-BR-007 | Estimate Linkage | An opportunity may link to multiple estimate scenarios but only approved revisions may populate proposal pricing. |
| GES-P08-BR-008 | Proposal Versioning | Issued proposals are immutable; revisions create new versions. |
| GES-P08-BR-009 | Approval Thresholds | Discounts, margin exceptions, and nonstandard terms require configured approval. |
| GES-P08-BR-010 | Signature Integrity | Signed proposal and contract artifacts require tamper-evident hashes and complete signature evidence. |
| GES-P08-BR-011 | Handoff Completeness | Awarded work cannot convert to a project until the handoff checklist passes. |
| GES-P08-BR-012 | Activity Capture | Material calls, emails, meetings, and portal events must be associated to a customer or opportunity. |
| GES-P08-BR-013 | Automation Safety | Automation enrollment must be idempotent and respect suppression, consent, and quiet-hour rules. |
| GES-P08-BR-014 | Forecast Governance | Forecast values must identify source, confidence, category, and effective date. |
| GES-P08-BR-015 | AI Approval | AI may not send external communication or commit commercial terms without delegated authorization. |
| GES-P08-BR-016 | Portal Isolation | Portal users may access only explicitly shared records within their account relationship. |
| GES-P08-BR-017 | Review Authenticity | Review records must preserve source and may not be altered to misrepresent customer feedback. |
| GES-P08-BR-018 | Referral Attribution | Referral credit must be assigned through a deterministic attribution rule. |
| GES-P08-BR-019 | Warranty Linkage | Warranty and service requests must link to the originating project and customer where available. |
| GES-P08-BR-020 | Retention | CRM records follow configurable legal, contractual, and tenant retention schedules. |
| GES-P08-BR-021 | White Label | Branding and outbound identity must resolve from tenant and brand profile at send time. |
| GES-P08-BR-022 | Channel Conflict | Partner-sourced opportunities must follow configurable account and territory conflict rules. |
| GES-P08-BR-023 | Customer Merge | Account or contact merges must preserve aliases, relationships, history, and audit references. |
| GES-P08-BR-024 | Data Export | Bulk export requires permission, purpose, watermarking where configured, and audit evidence. |
