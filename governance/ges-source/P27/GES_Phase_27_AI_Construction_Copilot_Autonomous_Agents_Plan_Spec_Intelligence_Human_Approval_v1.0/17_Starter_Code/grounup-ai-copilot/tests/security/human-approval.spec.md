# Human Approval Boundary
For a protected write/approve/send/admin tool:
1. agent may prepare proposed arguments and evidence
2. tool policy returns requiresHumanApproval=true
3. execution is blocked until authorized human decision
4. rejection prevents execution
5. approval executes exact approved action/version only
6. decision and execution are audited
