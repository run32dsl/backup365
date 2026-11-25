import type { PlanComplianceReport } from '@backup365/core';
import { PLANS_HASH, lateNote, runLabel } from '../plans.js';
import { Alert, DataTable, EmptyState, StatusPill, type Column } from '../ui/index.js';
import { COMPLIANCE_ORDER, Counts } from './Counts.js';
import { serviceOf, type Row } from './model.js';

type PlanEntry = PlanComplianceReport['nonCompliant'][number];

/** Une sauvegarde datée existe pour un des services que couvre le plan. */
const hasBackupsOf = (p: PlanEntry, rows: readonly Row[]): boolean =>
  p.lastRun === null &&
  rows.some((r) => r.lastSnapshotAt !== null && (p.dataTypes ?? []).includes(serviceOf(r)));

const planColumns = (rows: readonly Row[]): Column<PlanEntry>[] => [
  { header: 'Plan', cell: (p) => <a href={PLANS_HASH}>{p.name}</a> },
  // Même texte que la liste des plans (hors « Rien copié » sans point de restauration, que ce
  // rapport ne porte pas) : la dernière exécution du plan, jamais une date de service.
  { header: 'Dernière exécution (UTC)', cell: (p) => runLabel(p.lastRun, false) },
  {
    header: 'État',
    cell: (p) => {
      const note = lateNote(p.state, p.lastSuccessAt, hasBackupsOf(p, rows));
      return (
        <div>
          <StatusPill status={p.state === 'failed' ? 'failed' : 'late'} />
          {note && <small className="state-note">{note}</small>}
        </div>
      );
    },
  },
];

/** Conformité des plans de protection : décompte par état, puis les plans non conformes. */
export function PlansCompliance({
  plans,
  rows,
}: {
  plans: PlanComplianceReport | null | undefined;
  rows: readonly Row[];
}) {
  if (plans === undefined) return null;
  if (plans === null) return <Alert tone="error">Conformité des plans indisponible</Alert>;
  const total = COMPLIANCE_ORDER.reduce((sum, state) => sum + plans.counts[state], 0);
  return (
    <section className="status-section" aria-label="Conformité des plans de protection">
      <h2>Plans de protection</h2>
      {total === 0 ? (
        <EmptyState>Aucun plan de protection.</EmptyState>
      ) : (
        <>
          <Counts counts={plans.counts} pending={plans.pending ?? 0} />
          {plans.nonCompliant.length > 0 && (
            <DataTable
              caption="Plans en retard ou en échec"
              columns={planColumns(rows)}
              rows={plans.nonCompliant}
              rowKey={(p) => p.id}
              empty={{ message: 'Aucun plan en retard ou en échec.' }}
            />
          )}
        </>
      )}
    </section>
  );
}
