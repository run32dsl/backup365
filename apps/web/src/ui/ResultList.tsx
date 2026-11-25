import type { ReactNode } from 'react';
import { keepDateTogether } from '../format.js';

/** Récapitulatif libellé (restaurations, plans), comme la fiche d'un mail. */
export function ResultList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="meta-list">
      {rows.map(([label, value]) => (
        <div key={label} className="meta-row">
          <dt>{label}</dt>
          <dd>{typeof value === 'string' ? keepDateTogether(value) : value}</dd>
        </div>
      ))}
    </dl>
  );
}
