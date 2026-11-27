import type { BackupCatalog, Workload } from './catalog.js';
import {
  nextRunAt,
  type PlanComplianceReport,
  type SourceFailure,
  type ProtectionPlanInput,
} from './protection-plan.js';

/** Seuil d'alerte par défaut : une sauvegarde nocturne doit avoir moins de 26 h. */
export const DEFAULT_MAX_AGE_HOURS = 26;

/** `ok` : instantané récent ; `stale` (« ancien ») : au-delà du seuil ; `missing` (« absent ») : aucun instantané. */
export type BackupState = 'ok' | 'stale' | 'missing';

/** Nature de la source : une boîte aux lettres ou un site SharePoint. */
export type SourceKind = 'mailbox' | 'site';

export interface StatusRow {
  kind: SourceKind;
  /** Identifiant de la boîte ou du site. */
  sourceId: string;
  displayName: string;
  workload: Workload;
  /** Date du dernier instantané (UTC, ISO 8601) ; `null` si absent. */
  lastSnapshotAt: string | null;
  /** Âge en heures entières (arrondi à l'inférieur) ; `null` si absent. */
  ageHours: number | null;
  state: BackupState;
  /** Ajouté par `GET /api/status` pour les administrateurs : un plan qui couvre la source a échoué. */
  failure?: SourceFailure;
}

/** État affiché : une source dont un plan a échoué n'est jamais « à jour » (elle est en échec). */
export function effectiveState(row: Pick<StatusRow, 'state' | 'failure'>): BackupState {
  return row.state === 'ok' && row.failure ? 'missing' : row.state;
}

export interface StatusReport {
  generatedAt: string;
  maxAgeHours: number;
  /** Nombre de lignes `stale` ou `missing`. */
  alertCount: number;
  rows: StatusRow[];
  /**
   * Somme des tailles (`sizeBytes`) des instantanés lus pour ce tableau, en octets ; `0` sans
   * instantané, `null` si l'un d'eux n'a pas de taille (ou si la somme dépasse un entier sûr).
   * Toujours fourni par `buildStatusReport` ; facultatif pour les rapports construits à la main.
   */
  volume_octets?: number | null;
  /** Ajouté par `GET /api/status` : conformité des plans ; `null` si leur base ne répond pas. */
  plans?: PlanComplianceReport | null;
  /** Ajouté par `GET /api/status` pour les administrateurs : une ligne par service ; `null` si la base des plans ne répond pas. */
  services?: ServiceSummary[] | null;
  /**
   * Ajouté par `GET /api/status` pour les administrateurs, avec un stockage configuré : le stockage
   * refuse-t-il les écritures conditionnelles (`checkStorage()` du SDK 7.3.0) ? `null` si la
   * vérification a échoué.
   */
  storage?: { conditionalWrites: ConditionalWrites | null };
}

/**
 * Écritures conditionnelles du stockage, d'après la sonde du SDK : `supported`, elles sont
 * refusées comme il faut ; `ignored`, le stockage en accepte au moins une, et deux opérations
 * simultanées sur un même élément ne seraient plus exclues, donc Atlas refuse d'y écrire depuis le
 * SDK 7.3.0 ; `not_probed`, la sonde n'a pas pu
 * écrire (pas encore de bucket, ou pas de droit d'écriture).
 */
export type ConditionalWrites = 'supported' | 'ignored' | 'not_probed';

/**
 * État d'une sauvegarde. Un instantané daté du futur (horloges décalées) compte pour un âge nul ;
 * une date illisible est traitée comme une absence. Le seuil lui-même est encore `ok`.
 */
export function backupState(
  lastSnapshotAt: string | null,
  now: Date,
  maxAgeHours: number,
): { state: BackupState; ageHours: number | null } {
  if (lastSnapshotAt === null) return { state: 'missing', ageHours: null };
  const time = Date.parse(lastSnapshotAt);
  if (Number.isNaN(time)) return { state: 'missing', ageHours: null };
  const ageMs = Math.max(0, now.getTime() - time);
  return {
    state: ageMs > maxAgeHours * 3_600_000 ? 'stale' : 'ok',
    ageHours: Math.floor(ageMs / 3_600_000),
  };
}

/**
 * Date du dernier instantané, quel que soit l'ordre (le port promet le plus récent en premier,
 * on ne s'y fie pas pour une alerte). Les dates illisibles sont écartées : elles ne doivent pas
 * masquer un instantané valide.
 */
function latest(snapshots: readonly { createdAt: string }[]): string | null {
  return (
    snapshots
      .map((s) => s.createdAt)
      .filter((d) => !Number.isNaN(Date.parse(d)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
  );
}

/**
 * Calcule l'état de chaque source pour chaque charge suivie, à partir du catalogue (lecture
 * seule). Les boîtes couvrent les charges autres que `sharepoint` ; les sites sauvegardés
 * (`listSites`) ne sont lus que si `sharepoint` est suivie.
 */
export async function buildStatusReport(
  catalog: BackupCatalog,
  workloads: readonly Workload[],
  maxAgeHours: number,
  now: Date = new Date(),
): Promise<StatusReport> {
  const rows: StatusRow[] = [];
  let volume: number | null = 0;
  const add = (
    kind: SourceKind,
    source: { id: string; displayName: string },
    workload: Workload,
    snapshots: readonly { createdAt: string; sizeBytes?: number }[],
  ) => {
    for (const s of snapshots) {
      volume = volume === null || s.sizeBytes === undefined ? null : volume + s.sizeBytes;
    }
    const last = latest(snapshots);
    rows.push({
      kind,
      sourceId: source.id,
      displayName: source.displayName,
      workload,
      lastSnapshotAt: last,
      ...backupState(last, now, maxAgeHours),
    });
  };
  const mailWorkloads = workloads.filter((w) => w !== 'sharepoint');
  const mailboxes = mailWorkloads.length > 0 ? await catalog.listMailboxes() : [];
  for (const mailbox of mailboxes) {
    for (const workload of mailWorkloads) {
      add('mailbox', mailbox, workload, await catalog.listSnapshots(mailbox.id, workload));
    }
  }
  if (workloads.includes('sharepoint')) {
    for (const site of await catalog.listSites()) {
      add('site', site, 'sharepoint', await catalog.listSiteSnapshots(site.id));
    }
  }
  return {
    generatedAt: now.toISOString(),
    maxAgeHours,
    alertCount: rows.filter((r) => r.state !== 'ok').length,
    rows,
    volume_octets: volume !== null && Number.isSafeInteger(volume) ? volume : null,
  };
}

/** Services présentés sur la page « Sources », dans l'ordre d'affichage. */
export const SERVICES = ['mail', 'onedrive', 'sharepoint'] as const;
export type Service = (typeof SERVICES)[number];

export interface ServiceSummary {
  service: Service;
  /** Au moins un plan couvre ce service ; sinon la ligne est grisée. */
  hasPlan: boolean;
  /** Dernier instantané, tous éléments confondus (UTC, ISO 8601) ; `null` si aucun. */
  lastSnapshotAt: string | null;
  ageHours: number | null;
  /** Pire état parmi les sources du service : une source en retard n'est pas masquée par une autre à jour. */
  state: BackupState;
  /** Conservation la plus longue parmi les plans qui couvrent le service ; `null` sans plan. */
  retentionDays: number | null;
  /** `all` si un plan couvre tout le service ; sinon nombre d'éléments distincts choisis. */
  scope: { kind: 'all' } | { kind: 'selection'; count: number } | null;
  /**
   * Un plan couvre le service, aucune sauvegarde n'existe encore et la première exécution prévue
   * n'est pas échue : l'écran dit « En attente » au lieu de « En échec ».
   */
  awaitingFirstRun: boolean;
}

type PlanFacts = Pick<
  ProtectionPlanInput,
  'dataTypes' | 'scope' | 'selection' | 'retentionDays' | 'rpoHours'
> & { id: string; createdAt: string };

/** Vrai tant que la première exécution prévue après la création du plan n'est pas échue. */
function firstRunPending(plan: PlanFacts, now: Date): boolean {
  const created = new Date(plan.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return nextRunAt(plan, created).getTime() > now.getTime();
}

const WORST_FIRST: readonly BackupState[] = ['missing', 'stale', 'ok'];

/** Une ligne par service : dernier instantané, pire état, conservation et périmètre des plans. */
export function buildServiceSummaries(
  rows: readonly StatusRow[],
  plans: readonly PlanFacts[],
  maxAgeHours: number,
  now: Date = new Date(),
): ServiceSummary[] {
  return SERVICES.map((service) => {
    const own = rows.filter((r) => r.workload === service);
    const covering = plans.filter((p) => p.dataTypes.includes(service));
    // La date d'un service est celle de la plus récente sauvegarde que la page « Sources » liste
    // pour lui : jamais l'heure d'une exécution de plan, qui peut ne rien avoir copié.
    const last = latest(
      own.flatMap((r) => (r.lastSnapshotAt === null ? [] : [{ createdAt: r.lastSnapshotAt }])),
    );
    const state = WORST_FIRST.find((s) => own.some((r) => effectiveState(r) === s)) ?? 'missing';
    const selected = new Set(covering.flatMap((p) => (p.scope === 'selection' ? p.selection : [])));
    const scope: ServiceSummary['scope'] =
      covering.length === 0
        ? null
        : covering.some((p) => p.scope === 'all')
          ? { kind: 'all' }
          : { kind: 'selection', count: selected.size };
    return {
      service,
      hasPlan: covering.length > 0,
      lastSnapshotAt: last,
      ageHours: backupState(last, now, maxAgeHours).ageHours,
      state,
      retentionDays: covering.length > 0 ? Math.max(...covering.map((p) => p.retentionDays)) : null,
      scope,
      // Plusieurs plans : l'attente cesse dès que la première exécution de l'un d'eux est échue.
      awaitingFirstRun:
        covering.length > 0 && last === null && covering.every((p) => firstRunPending(p, now)),
    };
  });
}

/** Une sauvegarde au-delà du seuil de retard, rattachée au service de la page « Sources ». */
export interface LateBackup {
  service: Service;
  /** Nom de la boîte, du compte ou du site. */
  name: string;
  /** Date du dernier instantané (UTC, ISO 8601). */
  lastSnapshotAt: string;
}

/**
 * Sauvegardes en retard (`stale`), pour la carte « Sauvegarde » de l'accueil. Même définition que
 * le bandeau et le compteur de « Sources », qui comptent les lignes `stale` de `GET /api/status` ;
 * un test serveur garantit que les nombres restent égaux. Une source sans instantané (`missing`)
 * n'en fait pas partie.
 */
export function lateBackups(rows: readonly StatusRow[]): LateBackup[] {
  const serviceOf = (r: StatusRow): Service =>
    r.kind === 'site' ? 'sharepoint' : r.workload === 'onedrive' ? 'onedrive' : 'mail';
  return rows.flatMap((r) =>
    r.state === 'stale' && r.lastSnapshotAt !== null
      ? [{ service: serviceOf(r), name: r.displayName, lastSnapshotAt: r.lastSnapshotAt }]
      : [],
  );
}
