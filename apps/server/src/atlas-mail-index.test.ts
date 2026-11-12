import { describe, expect, it } from 'vitest';
import {
  AtlasSdkSnapshotMailReader,
  SnapshotManifestMissingError,
  type AtlasManifestEntry,
} from './atlas-mail-index.js';

const createdAt = new Date('2026-03-01T08:00:00.000Z');

function readerOf(entries: AtlasManifestEntry[] | undefined) {
  return new AtlasSdkSnapshotMailReader({
    outlook: {
      getSnapshotDetail: (id) =>
        Promise.resolve(id === 'snap-1' && entries ? { createdAt, entries } : undefined),
    },
  });
}

describe('AtlasSdkSnapshotMailReader', () => {
  it('maps manifest entries to metadata without reading any message', async () => {
    const mails = await readerOf([
      {
        objectId: 'obj-1',
        sizeBytes: 1200,
        subject: 'Facture',
        folderId: 'folder-1',
        from: { name: 'Alice', address: 'alice@example.test' },
        attachments: [{ name: 'facture.pdf' }],
        receivedAt: '2026-02-10T09:30:00Z',
      },
    ]).readMails('mbx', 'snap-1');
    expect(mails).toEqual([
      {
        messageId: 'obj-1',
        sender: 'alice@example.test',
        recipients: [],
        subject: 'Facture',
        date: '2026-02-10T09:30:00.000Z',
        folder: 'folder-1',
        size: 1200,
        attachments: ['facture.pdf'],
      },
    ]);
  });

  it('falls back to the snapshot date and empty fields when the manifest omits them', async () => {
    const mails = await readerOf([
      { objectId: 'obj-2', sizeBytes: 5, receivedAt: 'pas une date' },
    ]).readMails('mbx', 'snap-1');
    expect(mails).toEqual([
      {
        messageId: 'obj-2',
        sender: '',
        recipients: [],
        subject: '',
        date: createdAt.toISOString(),
        folder: '',
        size: 5,
        attachments: [],
      },
    ]);
  });

  it('throws for a listed snapshot without manifest, so that it is retried', async () => {
    await expect(readerOf(undefined).readMails('mbx', 'snap-1')).rejects.toThrow(
      SnapshotManifestMissingError,
    );
  });
});
