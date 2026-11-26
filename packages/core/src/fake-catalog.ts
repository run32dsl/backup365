import type {
  BackupCatalog,
  Mailbox,
  Site,
  Snapshot,
  SnapshotDetail,
  Team,
  Workload,
} from './catalog.js';

export interface FakeCatalogData {
  mailboxes: Mailbox[];
  /** Sites SharePoint sauvegardés. */
  sites?: Site[];
  /** Équipes Teams sauvegardées. */
  teams?: Team[];
  /** Instantanés par boîte, par site ou par équipe. */
  snapshots: Record<string, Snapshot[]>;
  details?: Record<string, SnapshotDetail>;
}

/** Faux en mémoire du port, pour les tests (aucun réseau). */
export class FakeBackupCatalog implements BackupCatalog {
  constructor(private readonly data: FakeCatalogData) {}

  listMailboxes(): Promise<Mailbox[]> {
    return Promise.resolve([...this.data.mailboxes]);
  }

  listSites(): Promise<Site[]> {
    return Promise.resolve([...(this.data.sites ?? [])]);
  }

  listSiteSnapshots(siteId: string): Promise<Snapshot[]> {
    return this.listSnapshots(siteId, 'sharepoint');
  }

  listTeams(): Promise<Team[]> {
    return Promise.resolve([...(this.data.teams ?? [])]);
  }

  listTeamSnapshots(teamId: string): Promise<Snapshot[]> {
    return this.listSnapshots(teamId, 'teams');
  }

  listSnapshots(mailboxId: string, workload: Workload): Promise<Snapshot[]> {
    const all = this.data.snapshots[mailboxId] ?? [];
    return Promise.resolve(
      all
        .filter((s) => s.workload === workload)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  getSnapshotDetail(workload: Workload, snapshotId: string): Promise<SnapshotDetail | null> {
    const detail = this.data.details?.[snapshotId];
    return Promise.resolve(detail && detail.workload === workload ? detail : null);
  }
}
