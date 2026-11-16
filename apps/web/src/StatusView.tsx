import type {
  BackupState,
  ComplianceState,
  PlanComplianceReport,
  SourceKind,
  StatusReport,
} from '@backup365/core';
import {
  Alert,
  DataTable,
  EmptyState,
  StatusPill,
  type Column,
  type PillStatus,
} from './ui/index.js';

type Row = StatusReport['rows'][number];

const COLUMNS: Column<Row>[] = [
  { header: 'Source', cell: (r) => r.displayName },
  { header: 'Type', cell: (r) => KIND_LABELS[r.kind] },
  { header: 'Charge', cell: (r) => r.workload },
  { header: 'Dernier instantané (UTC)', cell: (r) => r.lastSnapshotAt ?? '—' },
  { header: 'Âge (h)', cell: (r) => r.ageHours ?? '—' },
  { header: 'État', cell: (r) => <StateBadge state={r.state} /> },
];

/** État du chargement du tableau de bord. */
export type StatusState = StatusReport | 'loading' | 'error' | 'empty';

/** Pastille d'état : icône et texte, jamais la couleur seule. */
const STATE_BADGES: Record<BackupState, { status: PillStatus; label: string }> = {
  ok: { status: 'compliant', label: 'À jour' },
  stale: { status: 'late', label: 'Avertissement' },
  missing: { status: 'failed', label: 'Échec' },
};

function StateBadge({ state }: { state: BackupState }) {
  return <StatusPill {...STATE_BADGES[state]} />;
}

const KIND_LABELS: Record<SourceKind, string> = { mailbox: 'boîte', site: 'site SharePoint' };

type PlanEntry = PlanComplianceReport['nonCompliant'][number];

const PLAN_COLUMNS: Column<PlanEntry>[] = [
  { header: 'Plan', cell: (p) => p.name },
  { header: 'Objectif (h)', cell: (p) => p.rpoHours },
  { header: 'Dernière réussite (UTC)', cell: (p) => p.lastSuccessAt ?? '—' },
  { header: 'État', cell: (p) => <StatusPill status={p.state === 'failed' ? 'failed' : 'late'} /> },
];

const COMPLIANCE_ORDER: ComplianceState[] = ['compliant', 'late', 'failed'];

/** Conformité des plans de protection : décompte par état, puis les plans non conformes. */
function PlansCompliance({ plans }: { plans: PlanComplianceReport | null | undefined }) {
  if (plans === undefined) return null;
  if (plans === null) return <Alert tone="error">Conformité des plans indisponible</Alert>;
  const total = COMPLIANCE_ORDER.reduce((sum, state) => sum + plans.counts[state], 0);
  return (
    <section aria-label="Conformité des plans de protection">
      <h2>Plans de protection</h2>
      {total === 0 ? (
        <EmptyState>Aucun plan de protection.</EmptyState>
      ) : (
        <>
          <ul className="plan-counts">
            {COMPLIANCE_ORDER.map((state) => (
              <li key={state}>
                <StatusPill status={state} /> <strong>{plans.counts[state]}</strong>
              </li>
            ))}
          </ul>
          {plans.nonCompliant.length > 0 && (
            <DataTable
              caption="Plans non conformes"
              columns={PLAN_COLUMNS}
              rows={plans.nonCompliant}
              rowKey={(p) => p.id}
              empty={{ message: 'Aucun plan non conforme.' }}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Synthèse puis tableau par boîte ou site et par charge ; l'état est écrit en toutes lettres (pas la couleur seule). */
export function StatusView({ state }: { state: StatusState }) {
  if (state === 'loading') return <p role="status">Chargement de l’état des sauvegardes…</p>;
  if (state === 'empty')
    return (
      <EmptyState>Aucune sauvegarde trouvée : lancez une première sauvegarde Atlas.</EmptyState>
    );
  if (state === 'error') return <Alert tone="error">État des sauvegardes indisponible</Alert>;
  return (
    <>
      <PlansCompliance plans={state.plans} />
      <section aria-label="État des sauvegardes">
        <p role="status">
          {state.alertCount === 0 ? 'Aucune alerte' : `${state.alertCount} élément(s) en alerte`}{' '}
          (seuil : {state.maxAgeHours} h)
        </p>
        <DataTable
          caption="État par boîte, site et charge"
          hideCaption
          columns={COLUMNS}
          rows={state.rows}
          rowKey={(r) => `${r.kind}/${r.sourceId}/${r.workload}`}
          empty={{ message: 'Aucune boîte ni site sauvegardé.' }}
        />
      </section>
    </>
  );
}
