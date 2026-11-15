import type { BackupCatalog, Workload } from './catalog.js';

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
}

export interface StatusReport {
  generatedAt: string;
  maxAgeHours: number;
  /** Nombre de lignes `stale` ou `missing`. */
  alertCount: number;
  rows: StatusRow[];
}

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
  const add = (
    kind: SourceKind,
    source: { id: string; displayName: string },
    workload: Workload,
    snapshots: readonly { createdAt: string }[],
  ) => {
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
  };
}
