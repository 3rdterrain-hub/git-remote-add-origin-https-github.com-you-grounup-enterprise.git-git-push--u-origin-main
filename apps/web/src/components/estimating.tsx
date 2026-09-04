import type { ApprovalGate, ConfidenceResult, EstimateResult } from '@grounup/engine';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { money, percent } from '@/lib/format';
import { CheckCircle2, Eye, ShieldAlert, HelpCircle } from 'lucide-react';

/**
 * Shared estimating display primitives.
 *
 * Confidence and approval gate appear on almost every screen, so their color
 * language is defined once here: green means a machine may accept it, amber
 * means a person must look, red means it is blocked.
 */

const GATE_META: Record<ApprovalGate, { label: string; variant: 'success' | 'warn' | 'danger'; icon: typeof CheckCircle2 }> = {
  auto_accept: { label: 'Auto-accept', variant: 'success', icon: CheckCircle2 },
  estimator_review: { label: 'Estimator review', variant: 'warn', icon: Eye },
  senior_review: { label: 'Senior review', variant: 'danger', icon: ShieldAlert },
  rfi_required: { label: 'RFI required', variant: 'danger', icon: HelpCircle },
};

export function GateBadge({ gate, className }: { gate: ApprovalGate; className?: string }) {
  const meta = GATE_META[gate];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={cn('whitespace-nowrap', className)}>
      <Icon className="size-3" /> {meta.label}
    </Badge>
  );
}

/** Confidence score, colored by the Section 45 bands. */
export function ConfidencePill({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 95 ? 'bg-success-50 text-success-700 border-success-500/30'
    : score >= 90 ? 'bg-info-50 text-info-700 border-info-600/30'
    : score >= 80 ? 'bg-warn-50 text-warn-700 border-warn-600/30'
    : score >= 70 ? 'bg-warn-100 text-warn-700 border-warn-600/40'
    : 'bg-danger-50 text-danger-700 border-danger-500/30';
  return (
    <span className={cn('tabular inline-flex min-w-11 justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold', tone, className)}>
      {score}
    </span>
  );
}

export function VerificationDots({ confidence }: { confidence: ConfidenceResult }) {
  const checks = [
    { key: 'Primary source', on: confidence.factors.some((f) => f.detail.includes('primary yes')) },
    { key: 'Cross-source', on: confidence.factors.some((f) => f.detail.includes('cross-source yes')) },
    { key: 'Reconciled', on: confidence.factors.some((f) => f.detail.includes('reconciliation yes')) },
  ];
  return (
    <span className="inline-flex items-center gap-1" title={checks.map((c) => `${c.key}: ${c.on ? 'yes' : 'no'}`).join(' · ')}>
      {checks.map((c) => (
        <span key={c.key} className={cn('size-1.5 rounded-full', c.on ? 'bg-success-600' : 'bg-charcoal-300')} />
      ))}
    </span>
  );
}

const DECISION_META: Record<EstimateResult['executiveDecision'], { label: string; variant: 'success' | 'warn' | 'danger' }> = {
  ready_for_estimating: { label: 'Ready for estimating', variant: 'success' },
  ready_with_assumptions: { label: 'Ready with assumptions', variant: 'warn' },
  senior_review_required: { label: 'Senior review required', variant: 'danger' },
  rfi_resolution_required: { label: 'RFI resolution required', variant: 'danger' },
  document_set_incomplete: { label: 'Document set incomplete', variant: 'danger' },
};

export function DecisionBadge({ decision }: { decision: EstimateResult['executiveDecision'] }) {
  const meta = DECISION_META[decision];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/**
 * The cost bucket breakdown, kept separately visible per RULE-001.
 * Zero buckets are hidden so the panel shows what the job actually consists of.
 */
export function CostBreakdown({
  breakdown, total, className,
}: {
  breakdown: EstimateResult['directCost']; total: number; className?: string;
}) {
  const rows: [string, number][] = [
    ['Labor wage', breakdown.laborWage],
    ['Labor burden', breakdown.laborBurden],
    ['Equipment ownership', breakdown.equipmentOwnership],
    ['Equipment mobilization', breakdown.equipmentMobilization],
    ['Fuel & DEF', breakdown.fuel],
    ['Material', breakdown.material],
    ['Trucking', breakdown.trucking],
    ['Disposal', breakdown.disposal],
    ['Subcontract', breakdown.subcontract],
    ['Other', breakdown.other],
  ];
  const visible = rows.filter(([, v]) => v !== 0);
  const max = Math.max(...visible.map(([, v]) => v), 1);

  return (
    <div className={cn('space-y-2', className)}>
      {visible.map(([label, value]) => (
        <div key={label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-charcoal-600">{label}</span>
            <span className="tabular font-medium text-charcoal-900">
              {money(value)} <span className="text-xs text-charcoal-400">{percent(value / total, 1)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-charcoal-100">
            <div className="h-full rounded-full bg-charcoal-700" style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between border-t border-charcoal-200 pt-2 text-sm font-semibold">
        <span className="text-charcoal-900">Total direct cost</span>
        <span className="tabular text-charcoal-900">{money(total)}</span>
      </div>
    </div>
  );
}
