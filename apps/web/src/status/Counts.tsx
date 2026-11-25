import type { ComplianceState } from '@backup365/core';
import { StatusPill } from '../ui/index.js';
import { STATE_LABELS } from './model.js';

export const COMPLIANCE_ORDER: ComplianceState[] = ['compliant', 'late', 'failed'];

/** `pending` : plans « à jour » sans point de restauration, comptés à part pour que la somme tienne. */
export function Counts({
  counts,
  pending = 0,
}: {
  counts: Record<ComplianceState, number>;
  pending?: number;
}) {
  return (
    <ul className="plan-counts">
      {COMPLIANCE_ORDER.map((state) => (
        <li key={state}>
          <StatusPill status={state} label={STATE_LABELS[state]} />{' '}
          <strong>
            {state === 'compliant' ? Math.max(0, counts[state] - pending) : counts[state]}
          </strong>
        </li>
      ))}
      {pending > 0 && (
        <li>
          <StatusPill status="pending" /> <strong>{pending}</strong>
        </li>
      )}
    </ul>
  );
}
