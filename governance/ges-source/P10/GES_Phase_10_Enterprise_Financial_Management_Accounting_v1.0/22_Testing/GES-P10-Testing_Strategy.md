# Phase 10 Testing Strategy

Testing must include unit, integration, workflow, security, segregation-of-duties, performance, financial reconciliation, migration, mobile approval, AI governance, and user acceptance testing. Every controlled requirement maps to a test case. Critical financial balances require parallel reconciliation against approved source records before production cutover.

## Release gates
1. Debits equal credits for every posted journal and ledger batch.
2. AP, AR, payroll, banking, fixed assets, tax, job cost, and subledgers reconcile to the general ledger.
3. Closed periods reject unauthorized transactions.
4. Tenant isolation and segregation-of-duties tests pass.
5. AI outputs remain recommendations until governed approval.
6. No unresolved Severity 1 or Severity 2 defect remains.
