import { useState } from 'react';
import type {
  BackupState,
  ComplianceState,
  PlanComplianceReport,
  StatusReport,
} from '@backup365/core';
import { Alert, Button, DataTable, EmptyState, StatusPill, type Column } from './ui/index.js';
import {
  PLANS_HASH,
  UNIT_NAMES,
  lateNote,
  lateSourcesNote,
  retentionLabel,
  runLabel,
  serviceOf,
} from './plans.js';
import { searchHref } from './mail.js';
import { ageLabel, dateTimeOf, dateTimeOrDash, plural, workloadLabel } from './format.js';
import { AUDIT_HASH } from './routes.js';
import { RESTORE_BUTTONS } from './RestoreJourney.js';

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
  { header: 'Contenu', cell: contentLabel, className: 'nowrap' },
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

type ServiceEntry = NonNullable<StatusReport['services']>[number];

/** Nom des éléments d'un périmètre : la sélection d'un plan désigne des boîtes ou des comptes. */
const SCOPE_UNITS: Record<ServiceEntry['service'], { one: string; all: string } | null> = {
  mail: { one: 'boîte', all: 'Toutes les boîtes' },
  onedrive: { one: 'compte', all: 'Tous les comptes' },
  sharepoint: null,
};

/** `12 boîtes`, `Tous les comptes` ; chaîne vide sans plan. */
export function scopeLabel(s: Pick<ServiceEntry, 'service' | 'scope'>): string {
  if (s.scope === null) return '';
  const unit = SCOPE_UNITS[s.service];
  if (s.scope.kind === 'all') return unit?.all ?? 'Tous les sites';
  return unit
    ? plural(s.scope.count, unit.one)
    : plural(s.scope.count, 'élément choisi', 'éléments choisis');
}

/** Temps relatif, puis la date exacte dessous (`<time datetime>`) ; « Jamais » sans sauvegarde. */
function LastBackup({ at, ageHours }: { at: string | null; ageHours: number | null }) {
  const exact = dateTimeOf(at);
  // Une date illisible est une absence, comme dans `backupState`.
  if (at === null || ageHours === null || exact === '') return <>Jamais</>;
  const age = ageLabel(ageHours);
  return (
    <time dateTime={at}>
      {age.charAt(0).toUpperCase() + age.slice(1)}
      <small className="state-note">{`${exact} UTC`}</small>
    </time>
  );
}

type Late = { plan: PlanComplianceReport['nonCompliant'][number] };

/**
 * Ce que les lignes du catalogue disent d'un service : la plus récente sauvegarde et le pire état.
 * `last` est nul tant qu'aucune source n'a de sauvegarde datée : le catalogue rend une ligne par
 * compte dès qu'il existe, même jamais sauvegardé, et ces lignes ne contredisent pas la synthèse.
 */
function fromRows(service: ServiceEntry['service'], rows: readonly Row[]) {
  const own = rows.filter((r) => serviceOf(r) === service);
  let last: Row | null = null;
  for (const r of own) {
    if (r.lastSnapshotAt === null || r.ageHours === null || dateTimeOf(r.lastSnapshotAt) === '')
      continue;
    if (last === null || Date.parse(r.lastSnapshotAt) > Date.parse(last.lastSnapshotAt ?? ''))
      last = r;
  }
  const state: BackupState = own.some((r) => r.state === 'missing')
    ? 'missing'
    : own.some((r) => r.state === 'stale')
      ? 'stale'
      : 'ok';
  return { last, state };
}

/**
 * Un service de la synthèse, remis d'accord avec ce que la page liste plus bas. Deux faits
 * seulement priment sur la synthèse : une sauvegarde datée dans « Sauvegardes » (la ligne en
 * reprend la date et l'état) et un plan listé qui couvre le service (il n'est pas « Non
 * protégé »). Sans sauvegarde datée, « Jamais » et « En attente » restent ceux du serveur.
 */
function reconcile(
  s: ServiceEntry,
  rows: readonly Row[],
  plans: PlanComplianceReport | null | undefined,
): ServiceEntry & Partial<Late> {
  const own = fromRows(s.service, rows);
  // Plusieurs plans listés : le pire état l'emporte (un échec n'est pas masqué par un retard).
  const covering = (plans?.nonCompliant ?? []).filter((p) => p.dataTypes?.includes(s.service));
  const plan = covering.find((p) => p.state === 'failed') ?? covering[0];
  const hasPlan = s.hasPlan || plan !== undefined;
  if (own.last === null) return { ...s, hasPlan, ...(plan && { plan }) };
  return {
    ...s,
    hasPlan,
    // La date d'un service est celle de la plus récente ligne du tableau « Sauvegardes ».
    lastSnapshotAt: own.last.lastSnapshotAt,
    ageHours: own.last.ageHours,
    state: own.state,
    awaitingFirstRun: false,
  };
}

/** `1 compte sur 5 en retard` ; chaîne vide si aucune source du service n'est en retard. */
export function lateCause(service: ServiceEntry['service'], rows: readonly Row[]): string {
  const own = rows.filter((r) => serviceOf(r) === service);
  const late = own.filter((r) => r.state !== 'ok').length;
  if (late === 0) return '';
  return `${plural(late, UNIT_NAMES[service])} sur ${own.length} en retard`;
}

/**
 * Pastille, puis l'action utile : créer un plan s'il n'y en a pas ; pour un retard, sa cause sur
 * une ligne secondaire ; sans aucune sauvegarde, le journal. Le nom accessible du lien nomme le
 * service : le même libellé revient sur plusieurs lignes. Un seul élément dans la cellule : en
 * carte, le lien reste sous la pastille.
 */
function ServiceState({
  service,
  rows,
}: {
  service: ServiceEntry & Partial<Late>;
  rows: readonly Row[];
}) {
  const name = workloadLabel(service.service);
  if (!service.hasPlan)
    return (
      <div>
        <StatusPill status="unconfigured" label="Non protégé" />
        <a className="state-link" href={PLANS_HASH} aria-label={`Créer un plan pour ${name}`}>
          Créer un plan
        </a>
      </div>
    );
  // Un plan sans sauvegarde : « En attente » jusqu'à l'échéance de sa première exécution (comme l'accueil).
  if (service.awaitingFirstRun)
    return (
      <div>
        <StatusPill status="pending" />
      </div>
    );
  // Un plan listé couvre le service sans qu'aucune source soit sauvegardée, première échéance
  // passée : l'état est celui du plan, dit comme dans le tableau des plans.
  if (service.plan && service.lastSnapshotAt === null) {
    const note = lateNote(service.plan.state, service.plan.lastSuccessAt);
    return (
      <div>
        <StatusPill status={service.plan.state === 'failed' ? 'failed' : 'late'} />
        {note && <small className="state-note">{note}</small>}
      </div>
    );
  }
  const cause = lateCause(service.service, rows);
  return (
    <div>
      <StateBadge state={service.state} />
      {service.state === 'stale' && cause !== '' && <small className="state-note">{cause}</small>}
      {service.state === 'missing' && (
        <a
          className="state-link"
          href={AUDIT_HASH}
          aria-label={`${RESTORE_BUTTONS.audit} : ${name}`}
        >
          {RESTORE_BUTTONS.audit}
        </a>
      )}
    </div>
  );
}

/** Glyphes décoratifs : le nom du service reste écrit à côté. */
const SERVICE_ICONS: Record<ServiceEntry['service'], string> = {
  mail: '✉',
  onedrive: '☁',
  sharepoint: '▤',
};

const serviceColumns = (rows: readonly Row[]): Column<ServiceEntry & Partial<Late>>[] => [
  {
    header: 'Service',
    rowHeader: true,
    cell: (s) => (
      <>
        <span className="service-icon" aria-hidden="true">
          {SERVICE_ICONS[s.service]}
        </span>{' '}
        {workloadLabel(s.service)}
      </>
    ),
  },
  {
    header: 'Dernière sauvegarde',
    cell: (s) => <LastBackup at={s.lastSnapshotAt} ageHours={s.ageHours} />,
  },
  { header: 'État', cell: (s) => <ServiceState service={s} rows={rows} /> },
  {
    header: 'Conservation',
    cell: (s) => (s.retentionDays === null ? '' : retentionLabel(s.retentionDays)),
  },
  { header: 'Périmètre', cell: scopeLabel },
];

/** Une ligne par service ; un service sans plan est grisé (`--muted`, sans `opacity`). */
function Services({ report }: { report: StatusReport }) {
  const { services, rows } = report;
  if (services === undefined) return null;
  if (services === null) return <Alert tone="error">Synthèse des services indisponible</Alert>;
  return (
    <section className="status-section" aria-labelledby="services-title">
      <h2 id="services-title">Services</h2>
      <DataTable
        caption="État par service"
        hideCaption
        columns={serviceColumns(rows)}
        rows={services.map((s) => reconcile(s, rows, report.plans))}
        rowKey={(s) => s.service}
        rowClassName={(s) => (s.hasPlan ? undefined : 'row-muted')}
      />
    </section>
  );
}

type PlanEntry = PlanComplianceReport['nonCompliant'][number];

/** Une sauvegarde datée existe pour un des services que couvre le plan. */
const hasBackupsOf = (p: PlanEntry, rows: readonly Row[]): boolean =>
  p.lastRun === null &&
  rows.some((r) => r.lastSnapshotAt !== null && (p.dataTypes ?? []).includes(serviceOf(r)));

const planColumns = (report: StatusReport): Column<PlanEntry>[] => [
  { header: 'Plan', cell: (p) => <a href={PLANS_HASH}>{p.name}</a> },
  // Même texte que la liste des plans (hors « Rien copié » sans point de restauration, que ce
  // rapport ne porte pas) : la dernière exécution du plan, jamais une date de service.
  { header: 'Dernière exécution (UTC)', cell: (p) => runLabel(p.lastRun, false) },
  {
    header: 'État',
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
];

const COMPLIANCE_ORDER: ComplianceState[] = ['compliant', 'late', 'failed'];

/** `pending` : plans « à jour » sans point de restauration, comptés à part pour que la somme tienne. */
function Counts({
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

/** Conformité des plans de protection : décompte par état, puis les plans non conformes. */
function PlansCompliance({ report }: { report: StatusReport }) {
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

/** Services sans aucun plan ; vide tant que la synthèse des services est absente ou en erreur. */
function unprotectedServices(report: StatusReport): ServiceEntry['service'][] {
  return (report.services ?? [])
    .map((s) => reconcile(s, report.rows, report.plans))
    .filter((s) => !s.hasPlan)
    .map((s) => s.service);
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
  const unprotected = unprotectedServices(report);
  const noPlan =
    unprotected.length === 0
      ? []
      : [
          `${plural(unprotected.length, 'source')} sans plan (${unprotected.map(workloadLabel).join(', ')})`,
        ];
  const shown = parts.filter(([n]) => n > 0);
  const nothing = shown.length === 0 && noPlan.length === 0;
  // Pas de « tout est à jour » sans rien à constater, ni quand l'état des plans est inconnu.
  if (nothing && (report.rows.length === 0 || report.plans === null)) return null;
  if (nothing) return <Alert tone="success">Toutes les sauvegardes sont à jour</Alert>;
  const planIssues = (plans?.counts.late ?? 0) + (plans?.counts.failed ?? 0);
  const severe = count('missing') > 0 || (plans?.counts.failed ?? 0) > 0;
  return (
    <Alert tone={severe ? 'error' : 'warning'}>
      {[...shown.map(([n, noun, what]) => `${plural(n, noun)} ${what}`), ...noPlan].join(', ')}
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
  // Une source sans plan n'a pas de ligne « À jour » : rien ne garantit qu'elle le reste.
  const unprotected = unprotectedServices(report);
  const rows = sortRows(
    report.rows.filter((r) => r.state !== 'ok' || !unprotected.includes(serviceOf(r))),
  );
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
          empty={{
            message:
              report.rows.length > 0
                ? 'Aucune sauvegarde à afficher : les sources sans plan ne sont pas listées comme à jour.'
                : 'Aucune boîte ni site sauvegardé.',
          }}
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
      <Services report={state} />
      <PlansCompliance report={state} />
      <Backups report={state} />
    </>
  );
}
