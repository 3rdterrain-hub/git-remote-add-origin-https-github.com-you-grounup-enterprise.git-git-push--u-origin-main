# Estimator Snapshot Reproducibility
1. Publish a rate v1.
2. Create estimator library snapshot S1.
3. Publish rate v2.
4. Resolve live library -> v2.
5. Read S1 -> v1 remains unchanged.
6. Recalculate estimate using S1 -> same historical inputs.
