# Data Dictionary

Canonical fields are tenant-scoped unless explicitly global. Money values retain currency, precision and unrounded calculation values.

| entity | field | data_type | required | description |
|---|---|---|---|---|
| Estimate | id | UUID | Required | Primary identifier |
| Estimate | tenant_id | UUID | Required | Tenant owner |
| Estimate | status | String | Required | Lifecycle status |
| Estimate | version | Integer | Required | Optimistic/version control |
| Estimate | created_at | Timestamp | Required | Created timestamp |
| Estimate | created_by | UUID | Required | Creator |
| Estimate | updated_at | Timestamp | Required | Updated timestamp |
| Estimate | updated_by | UUID | Required | Last updater |
| EstimateVersion | id | UUID | Required | Primary identifier |
| EstimateVersion | tenant_id | UUID | Required | Tenant owner |
| EstimateVersion | status | String | Required | Lifecycle status |
| EstimateVersion | version | Integer | Required | Optimistic/version control |
| EstimateVersion | created_at | Timestamp | Required | Created timestamp |
| EstimateVersion | created_by | UUID | Required | Creator |
| EstimateVersion | updated_at | Timestamp | Required | Updated timestamp |
| EstimateVersion | updated_by | UUID | Required | Last updater |
| EstimateSection | id | UUID | Required | Primary identifier |
| EstimateSection | tenant_id | UUID | Required | Tenant owner |
| EstimateSection | status | String | Required | Lifecycle status |
| EstimateSection | version | Integer | Required | Optimistic/version control |
| EstimateSection | created_at | Timestamp | Required | Created timestamp |
| EstimateSection | created_by | UUID | Required | Creator |
| EstimateSection | updated_at | Timestamp | Required | Updated timestamp |
| EstimateSection | updated_by | UUID | Required | Last updater |
| EstimateLine | id | UUID | Required | Primary identifier |
| EstimateLine | tenant_id | UUID | Required | Tenant owner |
| EstimateLine | status | String | Required | Lifecycle status |
| EstimateLine | version | Integer | Required | Optimistic/version control |
| EstimateLine | created_at | Timestamp | Required | Created timestamp |
| EstimateLine | created_by | UUID | Required | Creator |
| EstimateLine | updated_at | Timestamp | Required | Updated timestamp |
| EstimateLine | updated_by | UUID | Required | Last updater |
| EstimateAlternate | id | UUID | Required | Primary identifier |
| EstimateAlternate | tenant_id | UUID | Required | Tenant owner |
| EstimateAlternate | status | String | Required | Lifecycle status |
| EstimateAlternate | version | Integer | Required | Optimistic/version control |
| EstimateAlternate | created_at | Timestamp | Required | Created timestamp |
| EstimateAlternate | created_by | UUID | Required | Creator |
| EstimateAlternate | updated_at | Timestamp | Required | Updated timestamp |
| EstimateAlternate | updated_by | UUID | Required | Last updater |
| EstimateAssumption | id | UUID | Required | Primary identifier |
| EstimateAssumption | tenant_id | UUID | Required | Tenant owner |
| EstimateAssumption | status | String | Required | Lifecycle status |
| EstimateAssumption | version | Integer | Required | Optimistic/version control |
| EstimateAssumption | created_at | Timestamp | Required | Created timestamp |
| EstimateAssumption | created_by | UUID | Required | Creator |
| EstimateAssumption | updated_at | Timestamp | Required | Updated timestamp |
| EstimateAssumption | updated_by | UUID | Required | Last updater |
| EstimateExclusion | id | UUID | Required | Primary identifier |
| EstimateExclusion | tenant_id | UUID | Required | Tenant owner |
| EstimateExclusion | status | String | Required | Lifecycle status |
| EstimateExclusion | version | Integer | Required | Optimistic/version control |
| EstimateExclusion | created_at | Timestamp | Required | Created timestamp |
| EstimateExclusion | created_by | UUID | Required | Creator |
| EstimateExclusion | updated_at | Timestamp | Required | Updated timestamp |
| EstimateExclusion | updated_by | UUID | Required | Last updater |
| QuantityRecord | id | UUID | Required | Primary identifier |
| QuantityRecord | tenant_id | UUID | Required | Tenant owner |
| QuantityRecord | status | String | Required | Lifecycle status |
| QuantityRecord | version | Integer | Required | Optimistic/version control |
| QuantityRecord | created_at | Timestamp | Required | Created timestamp |
| QuantityRecord | created_by | UUID | Required | Creator |
| QuantityRecord | updated_at | Timestamp | Required | Updated timestamp |
| QuantityRecord | updated_by | UUID | Required | Last updater |
| TakeoffDocument | id | UUID | Required | Primary identifier |
| TakeoffDocument | tenant_id | UUID | Required | Tenant owner |
| TakeoffDocument | status | String | Required | Lifecycle status |
| TakeoffDocument | version | Integer | Required | Optimistic/version control |
| TakeoffDocument | created_at | Timestamp | Required | Created timestamp |
| TakeoffDocument | created_by | UUID | Required | Creator |
| TakeoffDocument | updated_at | Timestamp | Required | Updated timestamp |
| TakeoffDocument | updated_by | UUID | Required | Last updater |
| TakeoffMeasurement | id | UUID | Required | Primary identifier |
| TakeoffMeasurement | tenant_id | UUID | Required | Tenant owner |
| TakeoffMeasurement | status | String | Required | Lifecycle status |
| TakeoffMeasurement | version | Integer | Required | Optimistic/version control |
| TakeoffMeasurement | created_at | Timestamp | Required | Created timestamp |
| TakeoffMeasurement | created_by | UUID | Required | Creator |
| TakeoffMeasurement | updated_at | Timestamp | Required | Updated timestamp |
| TakeoffMeasurement | updated_by | UUID | Required | Last updater |
| TakeoffRevisionComparison | id | UUID | Required | Primary identifier |
| TakeoffRevisionComparison | tenant_id | UUID | Required | Tenant owner |
| TakeoffRevisionComparison | status | String | Required | Lifecycle status |
| TakeoffRevisionComparison | version | Integer | Required | Optimistic/version control |
| TakeoffRevisionComparison | created_at | Timestamp | Required | Created timestamp |
| TakeoffRevisionComparison | created_by | UUID | Required | Creator |
| TakeoffRevisionComparison | updated_at | Timestamp | Required | Updated timestamp |
| TakeoffRevisionComparison | updated_by | UUID | Required | Last updater |
| Assembly | id | UUID | Required | Primary identifier |
| Assembly | tenant_id | UUID | Required | Tenant owner |
| Assembly | status | String | Required | Lifecycle status |
| Assembly | version | Integer | Required | Optimistic/version control |
| Assembly | created_at | Timestamp | Required | Created timestamp |
| Assembly | created_by | UUID | Required | Creator |
| Assembly | updated_at | Timestamp | Required | Updated timestamp |
| Assembly | updated_by | UUID | Required | Last updater |
| AssemblyComponent | id | UUID | Required | Primary identifier |
| AssemblyComponent | tenant_id | UUID | Required | Tenant owner |
| AssemblyComponent | status | String | Required | Lifecycle status |
| AssemblyComponent | version | Integer | Required | Optimistic/version control |
| AssemblyComponent | created_at | Timestamp | Required | Created timestamp |
| AssemblyComponent | created_by | UUID | Required | Creator |
| AssemblyComponent | updated_at | Timestamp | Required | Updated timestamp |
| AssemblyComponent | updated_by | UUID | Required | Last updater |
| ProductionRate | id | UUID | Required | Primary identifier |
| ProductionRate | tenant_id | UUID | Required | Tenant owner |
| ProductionRate | status | String | Required | Lifecycle status |
| ProductionRate | version | Integer | Required | Optimistic/version control |
| ProductionRate | created_at | Timestamp | Required | Created timestamp |
| ProductionRate | created_by | UUID | Required | Creator |
| ProductionRate | updated_at | Timestamp | Required | Updated timestamp |
| ProductionRate | updated_by | UUID | Required | Last updater |
| ProductionConditionFactor | id | UUID | Required | Primary identifier |
| ProductionConditionFactor | tenant_id | UUID | Required | Tenant owner |
| ProductionConditionFactor | status | String | Required | Lifecycle status |
| ProductionConditionFactor | version | Integer | Required | Optimistic/version control |
| ProductionConditionFactor | created_at | Timestamp | Required | Created timestamp |
| ProductionConditionFactor | created_by | UUID | Required | Creator |
| ProductionConditionFactor | updated_at | Timestamp | Required | Updated timestamp |
| ProductionConditionFactor | updated_by | UUID | Required | Last updater |