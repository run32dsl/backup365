import { useState } from 'react';
import type {
  BackupState,
  ComplianceState,
  PlanComplianceReport,
  StatusReport,
} from '@backup365/core';
import { Alert, Button, DataTable, EmptyState, StatusPill, type Column } from './ui/index.js';
import { PLANS_HASH } from './plans.js';
import { searchHref } from './mail.js';
import { ageLabel, dateTimeOrDash, plural, workloadLabel } from './format.js';

type Row = StatusReport['rows'][number];

/** Ce qui est sauvegardé, avec les noms de la navigation : un site est un « Site SharePoint ». */
function contentLabel(r: Row): string {
  return r.kind === 'site' ? 'Site SharePoint' : workloadLabel(r.workload);
}

const COLUMNS: Column<Row>[] = [
  {
    header: 'Source',
    cell: (r) =>
      r.state !== 'ok' && r.kind === 'mailbox' && r.workload === 'mail' ? (
        <a href={searchHref(r.sourceId)}>{r.displayName}</a>
      ) : (
        r.displayName
      ),
  },
  { header: 'Contenu', cell: contentLabel },
  { header: 'Dernière sauvegarde (UTC)', cell: (r) => dateTimeOrDash(r.lastSnapshotAt) },
  { header: 'Ancienneté', cell: (r) => ageLabel(r.ageHours) },
  { header: 'État', cell: (r) => <StateBadge state={r.state} /> },
];

/** État du chargement du tableau de bord. */
export type StatusState = StatusReport | 'loading' | 'error' | 'empty';

/** Mêmes états et mêmes libellés pour les sauvegardes et pour les plans. */
const STATE_COMPLIANCE: Record<BackupState, ComplianceState> = {
  ok: 'compliant',
  stale: 'late',
  missing: 'failed',
};

const STATE_LABELS: Record<ComplianceState, string> = {
  compliant: 'À jour',
  late: 'En retard',
  failed: 'En échec',
};

/** Pastille d'état : icône et texte, jamais la couleur seule. */
function StateBadge({ state }: { state: BackupState }) {
  const status = STATE_COMPLIANCE[state];
  return <StatusPill status={status} label={STATE_LABELS[status]} />;
}

const SEVERITY: Record<BackupState, number> = { missing: 0, stale: 1, ok: 2 };

/** Du pire état au meilleur, puis de la plus ancienne à la plus récente (sans sauvegarde : en premier). */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY[a.state] - SEVERITY[b.state] ||
      (b.ageHours ?? Number.POSITIVE_INFINITY) - (a.ageHours ?? Number.POSITIVE_INFINITY),
  );
}

type PlanEntry = PlanComplianceReport['nonCompliant'][number];

const PLAN_COLUMNS: Column<PlanEntry>[] = [
  { header: 'Plan', cell: (p) => <a href={PLANS_HASH}>{p.name}</a> },
  { header: 'Dernière réussite (UTC)', cell: (p) => dateTimeOrDash(p.lastSuccessAt) },
  { header: 'État', cell: (p) => <StatusPill status={p.state === 'failed' ? 'failed' : 'late'} /> },
];

const COMPLIANCE_ORDER: ComplianceState[] = ['compliant', 'late', 'failed'];

function Counts({ counts }: { counts: Record<ComplianceState, number> }) {
  return (
    <ul className="plan-counts">
      {COMPLIANCE_ORDER.map((state) => (
        <li key={state}>
          <StatusPill status={state} label={STATE_LABELS[state]} /> <strong>{counts[state]}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Conformité des plans de protection : décompte par état, puis les plans non conformes. */
function PlansCompliance({ plans }: { plans: PlanComplianceReport | null | undefined }) {
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
          <Counts counts={plans.counts} />
          {plans.nonCompliant.length > 0 && (
            <DataTable
              caption="Plans en retard ou en échec"
              columns={PLAN_COLUMNS}
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

/** Bandeau de synthèse : « mes sauvegardes vont-elles bien ? » */
function Summary({ report }: { report: StatusReport }) {
  const count = (state: BackupState) => report.rows.filter((r) => r.state === state).length;
  const plans = report.plans ?? null;
  const parts: [number, string, string][] = [
    [count('stale'), 'sauvegarde', 'en retard'],
    [count('missing'), 'sauvegarde', 'en échec'],
    [plans?.counts.late ?? 0, 'plan', 'en retard'],
    [plans?.counts.failed ?? 0, 'plan', 'en échec'],
  ];
  const shown = parts.filter(([n]) => n > 0);
  // Pas de « tout est à jour » sans rien à constater, ni quand l'état des plans est inconnu.
  if (shown.length === 0 && (report.rows.length === 0 || report.plans === null)) return null;
  if (shown.length === 0) return <Alert tone="success">Toutes les sauvegardes sont à jour</Alert>;
  const planIssues = (plans?.counts.late ?? 0) + (plans?.counts.failed ?? 0);
  const severe = count('missing') > 0 || (plans?.counts.failed ?? 0) > 0;
  return (
    <Alert tone={severe ? 'error' : 'warning'}>
      {shown.map(([n, noun, what]) => `${plural(n, noun)} ${what}`).join(', ')}
      {planIssues > 0 && (
        <>
          {' '}
          <a href={PLANS_HASH}>Voir les plans de protection</a>
        </>
      )}
    </Alert>
  );
}

/** Sauvegardes : décompte par état, puis le tableau trié ; sous 900 px, les lignes à jour sont repliées. */
function Backups({ report }: { report: StatusReport }) {
  const [showOk, setShowOk] = useState(false);
  const rows = sortRows(report.rows);
  const okCount = rows.filter((r) => r.state === 'ok').length;
  const counts: Record<ComplianceState, number> = { compliant: okCount, late: 0, failed: 0 };
  for (const r of rows) if (r.state !== 'ok') counts[STATE_COMPLIANCE[r.state]]++;
  return (
    <section className="status-section" aria-labelledby="backups-title">
      <h2 id="backups-title">Sauvegardes</h2>
      <p className="help">{`Une sauvegarde est en retard au-delà de ${report.maxAgeHours} h.`}</p>
      <Counts counts={counts} />
      <div className={showOk ? 'backups show-ok' : 'backups'}>
        <DataTable
          caption="État par source et par contenu"
          hideCaption
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => `${r.kind}/${r.sourceId}/${r.workload}`}
          rowClassName={(r) => (r.state === 'ok' ? 'row-ok' : undefined)}
          empty={{ message: 'Aucune boîte ni site sauvegardé.' }}
        />
        {okCount > 0 && (
          <Button
            variant="secondary"
            className="ok-toggle"
            aria-expanded={showOk}
            onClick={() => setShowOk(!showOk)}
          >
            {showOk
              ? 'Masquer les sauvegardes à jour'
              : `Afficher ${okCount < 2 ? 'la sauvegarde' : `les ${okCount} sauvegardes`} à jour`}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Synthèse, plans, puis sauvegardes ; l'état est écrit en toutes lettres (pas la couleur seule). */
export function StatusView({ state }: { state: StatusState }) {
  if (state === 'loading') return <p role="status">Chargement de l’état des sauvegardes…</p>;
  if (state === 'empty')
    return (
      <EmptyState>
        Aucune sauvegarde pour l’instant. Elle apparaîtra ici après la première exécution d’un plan
        de protection.
      </EmptyState>
    );
  if (state === 'error') return <Alert tone="error">État des sauvegardes indisponible</Alert>;
  return (
    <>
      <Summary report={state} />
      <PlansCompliance plans={state.plans} />
      <Backups report={state} />
    </>
  );
}
