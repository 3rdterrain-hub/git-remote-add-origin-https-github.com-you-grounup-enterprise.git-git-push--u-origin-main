# Tenant Isolation Contract Test
Given tenant A and tenant B records,
when an actor scoped to tenant A requests/updates a tenant B identifier,
then the operation is denied or returns no permitted record,
and no tenant B data appears in response, logs or side effects,
and the security/audit policy records the attempt when required.
