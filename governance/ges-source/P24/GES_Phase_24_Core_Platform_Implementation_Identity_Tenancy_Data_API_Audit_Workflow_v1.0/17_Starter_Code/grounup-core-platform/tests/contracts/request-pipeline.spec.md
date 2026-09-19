# Request Pipeline Contract
Correlation -> Authentication -> Tenant Resolution -> Entitlement -> Authorization -> Validation -> Idempotency -> Domain -> Audit/Event -> Observability.
Protected stages may not be bypassed by domain handlers.
