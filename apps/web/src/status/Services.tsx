import {
  effectiveState,
  type BackupState,
  type PlanComplianceReport,
  type StatusReport,
} from '@backup365/core';
import { PLANS_HASH, lateNote, retentionLabel } from '../plans.js';
import { dateTimeOf, ageLabel, workloadLabel } from '../format.js';
import { FAILED_RUNS_HASH, runsHash } from '../activities/runs.js';
import { Alert, DataTable, StatusPill, type Column } from '../ui/index.js';
import {
  StateBadge,
  cardLine,
  scopeLabel,
  lateCause,
  serviceOf,
  type Row,
  type ServiceEntry,
} from './model.js';

/**
 * Temps relatif, en minuscule comme dans « Sauvegardes », puis la date exacte dessous
 * (`<time datetime>`) ; « Jamais » sans sauvegarde.
 */
function LastBackup({ at, ageHours }: { at: string | null; ageHours: number | null }) {
  const exact = dateTimeOf(at);
  // Une date illisible est une absence, comme dans `backupState`.
  if (at === null || ageHours === null || exact === '') return <>Jamais</>;
  return (
    <time dateTime={at}>
      {ageLabel(ageHours)}
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
  const state: BackupState = own.some((r) => effectiveState(r) === 'missing')
    ? 'missing'
    : own.some((r) => effectiveState(r) === 'stale')
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

/** Libellés propres à cet écran (jamais ceux de la restauration). */
export const SERVICE_LINKS = {
  failedRuns: 'Voir les sauvegardes en échec',
  planRuns: 'Historique du plan',
} as const;

/**
 * Pastille, puis l'action utile : créer un plan s'il n'y en a pas ; pour un retard, sa cause sur
 * une ligne secondaire ; en échec, Activités › Sauvegardes filtrée sur « En échec », où se lisent
 * la cause et ce qu'il faut faire. Le nom accessible du lien nomme le
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
    const failed = service.plan.state === 'failed';
    return (
      <div>
        <StatusPill status={failed ? 'failed' : 'late'} />
        {note && <small className="state-note">{note}</small>}
        {/* Le plan en cause est connu : ses exécutions, comme « Historique » dans Plans. */}
        {failed && (
          <a
            className="state-link"
            href={runsHash(service.plan.id)}
            aria-label={`${SERVICE_LINKS.planRuns} : ${name}`}
          >
            {SERVICE_LINKS.planRuns}
          </a>
        )}
      </div>
    );
  }
  const cause = lateCause(service.service, rows);
  const hasFailure = rows.some((r) => serviceOf(r) === service.service && r.failure);
  return (
    <div>
      <StateBadge state={service.state} />
      {cause !== '' && (service.state === 'stale' || hasFailure) && (
        <small className="state-note">{cause}</small>
      )}
      {service.state === 'missing' && (
        <a
          className="state-link"
          href={FAILED_RUNS_HASH}
          aria-label={`${SERVICE_LINKS.failedRuns} : ${name}`}
        >
          {SERVICE_LINKS.failedRuns}
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

/** Carte mobile : « il y a 3 h · 24/11/2026 11:46 UTC · conservés 1 an · toutes les boîtes ». */
function serviceCardLine(s: ServiceEntry): string {
  const exact = dateTimeOf(s.lastSnapshotAt);
  const dated = s.lastSnapshotAt !== null && s.ageHours !== null && exact !== '';
  const age = dated ? ageLabel(s.ageHours) : 'jamais';
  const scope = scopeLabel(s);
  return cardLine([
    age,
    dated ? `${exact} UTC` : '',
    s.retentionDays === null ? '' : `conservés ${retentionLabel(s.retentionDays)}`,
    scope.charAt(0).toLowerCase() + scope.slice(1),
  ]);
}

const serviceColumns = (rows: readonly Row[]): Column<ServiceEntry & Partial<Late>>[] => [
  {
    header: 'Service',
    rowHeader: true,
    className: 'card-title',
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
    className: 'card-hidden',
    cell: (s) => <LastBackup at={s.lastSnapshotAt} ageHours={s.ageHours} />,
  },
  {
    header: 'État',
    className: 'card-nolabel',
    cell: (s) => <ServiceState service={s} rows={rows} />,
  },
  {
    header: 'Conservation',
    className: 'card-hidden',
    cell: (s) => (s.retentionDays === null ? '' : retentionLabel(s.retentionDays)),
  },
  { header: 'Périmètre', className: 'card-hidden', cell: scopeLabel },
  // Sous 900 px seulement : les valeurs ci-dessus sur une ligne secondaire, sans libellé.
  { header: 'Détail', className: 'card-only', cell: serviceCardLine },
];

/** Une ligne par service ; un service sans plan est grisé (`--muted`, sans `opacity`). */
export function Services({ report }: { report: StatusReport }) {
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

/** Services sans aucun plan ; vide tant que la synthèse des services est absente ou en erreur. */
export function unprotectedServices(report: StatusReport): ServiceEntry['service'][] {
  return (report.services ?? [])
    .map((s) => reconcile(s, report.rows, report.plans))
    .filter((s) => !s.hasPlan)
    .map((s) => s.service);
}
