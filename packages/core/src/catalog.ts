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

/** Catalogue des sauvegardes, en lecture seule. */
export interface BackupCatalog {
  listMailboxes(): Promise<Mailbox[]>;
  /** Instantanés d'une boîte pour une charge, du plus récent au plus ancien. */
  listSnapshots(mailboxId: string, workload: Workload): Promise<Snapshot[]>;
  /** `null` si l'instantané n'existe pas. */
  getSnapshotDetail(workload: Workload, snapshotId: string): Promise<SnapshotDetail | null>;
}
