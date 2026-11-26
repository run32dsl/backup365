/** Charges sauvegardées, par ordre de priorité de la vision produit. */
export const WORKLOADS = ['mail', 'contacts', 'onedrive', 'sharepoint', 'teams'] as const;
export type Workload = (typeof WORKLOADS)[number];

export function isWorkload(value: string): value is Workload {
  return (WORKLOADS as readonly string[]).includes(value);
}

/** Source sauvegardée (boîte aux lettres). L'identifiant est opaque. */
export interface Mailbox {
  id: string;
  displayName: string;
}

/** Équipe Teams sauvegardée. L'identifiant est opaque. */
export interface Team {
  id: string;
  displayName: string;
}

/** Site SharePoint sauvegardé. L'identifiant est opaque. */
export interface Site {
  id: string;
  displayName: string;
}

export interface Snapshot {
  id: string;
  workload: Workload;
  /** Horodatage UTC, ISO 8601. */
  createdAt: string;
}

export interface SnapshotDetail extends Snapshot {
  itemCount: number;
}

/** Le catalogue ne peut pas répondre (stockage injoignable, phrase erronée…). */
export class CatalogUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogUnavailableError';
  }
}

/** Le stockage répond, mais le bucket n'existe pas : aucune sauvegarde n'a encore eu lieu. */
export class NoBackupFoundError extends CatalogUnavailableError {
  constructor(options?: ErrorOptions) {
    super('Aucune sauvegarde trouvée', options);
    this.name = 'NoBackupFoundError';
  }
}

/** Catalogue des sauvegardes, en lecture seule. */
export interface BackupCatalog {
  listMailboxes(): Promise<Mailbox[]>;
  /** Instantanés d'une boîte pour une charge, du plus récent au plus ancien. */
  listSnapshots(mailboxId: string, workload: Workload): Promise<Snapshot[]>;
  /** Sites SharePoint dont une sauvegarde existe (et non tous les sites du tenant). */
  listSites(): Promise<Site[]>;
  /** Instantanés `sharepoint` d'un site, du plus récent au plus ancien. */
  listSiteSnapshots(siteId: string): Promise<Snapshot[]>;
  /**
   * Équipes Teams dont une sauvegarde existe ; absent si l'adaptateur ne lit pas Teams (aucune
   * équipe). Le SDK 7.2.0 ne copie que les messages des canaux (docs/adr/0022).
   */
  listTeams?(): Promise<Team[]>;
  /** Instantanés `teams` d'une équipe, du plus récent au plus ancien. */
  listTeamSnapshots?(teamId: string): Promise<Snapshot[]>;
  /** `null` si l'instantané n'existe pas. */
  getSnapshotDetail(workload: Workload, snapshotId: string): Promise<SnapshotDetail | null>;
}
