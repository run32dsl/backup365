import type { PlanComplianceReport, StatusReport } from '@backup365/core';
import { PLANS_HASH, lateNote, lateSourcesNote, runLabel } from '../plans.js';
import { Alert, DataTable, EmptyState, StatusPill, type Column } from '../ui/index.js';
import { COMPLIANCE_ORDER, Counts } from './Counts.js';
import { cardLine, serviceOf, type Row } from './model.js';

type PlanEntry = PlanComplianceReport['nonCompliant'][number];

/** Une sauvegarde datée existe pour un des services que couvre le plan. */
const hasBackupsOf = (p: PlanEntry, rows: readonly Row[]): boolean =>
  p.lastRun === null &&
  rows.some((r) => r.lastSnapshotAt !== null && (p.dataTypes ?? []).includes(serviceOf(r)));

const planColumns = (report: StatusReport): Column<PlanEntry>[] => [
  { header: 'Plan', className: 'card-title', cell: (p) => <a href={PLANS_HASH}>{p.name}</a> },
  // Même texte que la liste des plans (hors « Rien copié » sans point de restauration, que ce
  // rapport ne porte pas) : la dernière exécution du plan, jamais une date de service.
  {
    header: 'Dernière exécution (UTC)',
    className: 'card-hidden',
    cell: (p) => runLabel(p.lastRun, false),
  },
  {
    header: 'État',
    className: 'card-nolabel',
    cell: (p) => {
      // Un plan en retard dont la réussite est récente : la note nomme les sources en retard.
      const fromSources = p.state === 'late' ? lateSourcesNote(p, report) : undefined;
      const note =
        fromSources?.text ?? lateNote(p.state, p.lastSuccessAt, hasBackupsOf(p, report.rows));
      return (
        <div>
          <StatusPill status={p.state === 'failed' ? 'failed' : 'late'} />
          {note && <small className="state-note">{note}</small>}
        </div>
      );
    },
  },
  // Sous 900 px seulement : la dernière exécution sur une ligne secondaire.
  {
    header: 'Détail',
    className: 'card-only',
    cell: (p) =>
      cardLine([
        `Dernière exécution : ${p.lastRun ? `${runLabel(p.lastRun, false)} UTC` : 'aucune'}`,
      ]),
  },
];

/** Conformité des plans de protection : décompte par état, puis les plans non conformes. */
export function PlansCompliance({ report }: { report: StatusReport }) {
  const plans = report.plans;
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
              columns={planColumns(report)}
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
