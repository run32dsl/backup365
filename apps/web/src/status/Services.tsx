import {
  effectiveState,
  type BackupState,
  type PlanComplianceReport,
  type StatusReport,
} from '@backup365/core';
import {
  PLANS_HASH,
  TEAMS_PRIVATE_CHATS,
  TEAMS_SOURCE_LABEL,
  lateNote,
  retentionLabel,
} from '../plans.js';
import { dateTimeOf, ageLabel, workloadLabel } from '../format.js';
import { AUDIT_HASH } from '../routes.js';
import { RESTORE_BUTTONS } from '../RestoreJourney.js';
import { Alert, DataTable, StatusPill, type Column } from '../ui/index.js';
import {
  StateBadge,
  scopeLabel,
  lateCause,
  serviceOf,
  type Row,
  type ServiceEntry,
} from './model.js';

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
  teams: '☷',
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
        {s.service === 'teams' ? TEAMS_SOURCE_LABEL : workloadLabel(s.service)}
        {s.service === 'teams' && <small className="state-note">{TEAMS_PRIVATE_CHATS}</small>}
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
