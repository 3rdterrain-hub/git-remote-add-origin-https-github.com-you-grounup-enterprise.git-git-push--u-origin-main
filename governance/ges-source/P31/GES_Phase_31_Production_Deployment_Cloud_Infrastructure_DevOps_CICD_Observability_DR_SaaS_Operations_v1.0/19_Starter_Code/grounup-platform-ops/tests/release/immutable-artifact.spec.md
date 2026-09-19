# Immutable Artifact Promotion
Build once.
Record artifact digest.
Deploy exact same digest to staging.
Promote exact same digest to production.
A rebuild between staging and production is a failure unless a new release candidate is created and all gates rerun.
