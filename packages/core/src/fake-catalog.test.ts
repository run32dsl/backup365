import { CONTRACT_FIXTURE, backupCatalogContract } from './catalog.contract.js';
import { FakeBackupCatalog } from './fake-catalog.js';

backupCatalogContract('FakeBackupCatalog', () =>
  Promise.resolve(
    new FakeBackupCatalog({
      mailboxes: [{ ...CONTRACT_FIXTURE.mailbox }],
      sites: [{ ...CONTRACT_FIXTURE.site }],
      snapshots: {
        'mbx-1': CONTRACT_FIXTURE.snapshots.map((s) => ({ ...s })),
        [CONTRACT_FIXTURE.site.id]: CONTRACT_FIXTURE.siteSnapshots.map((s) => ({ ...s })),
      },
      details: { 'snap-new': { ...CONTRACT_FIXTURE.detail } },
    }),
  ),
);
