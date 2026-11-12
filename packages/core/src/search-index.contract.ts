import { describe, expect, it } from 'vitest';
import type { MailMetadata, SearchIndex, SearchQuery } from './search.js';

function mail(messageId: string, over: Partial<MailMetadata> = {}): MailMetadata {
  return {
    messageId,
    sender: 'alice@example.test',
    recipients: ['bob@example.test'],
    subject: 'Sujet',
    date: '2026-01-15T10:00:00.000Z',
    folder: 'Inbox',
    size: 1000,
    attachments: [],
    ...over,
  };
}

const base: SearchQuery = { limit: 50, offset: 0 };

/** Tests de contrat du port `SearchIndex`, à rejouer sur chaque adaptateur. */
export function searchIndexContract(name: string, create: () => Promise<SearchIndex>): void {
  async function seeded(): Promise<SearchIndex> {
    const index = await create();
    await index.indexSnapshot('mbx-1', 'snap-1', [
      mail('m1', { subject: 'Facture de janvier', attachments: ['facture-0001.pdf'] }),
      mail('m2', {
        sender: 'carol@example.test',
        subject: 'Réunion équipe',
        date: '2026-02-10T09:00:00.000Z',
        folder: 'Projets',
      }),
      mail('m3', {
        subject: 'Rapport',
        recipients: ['dave@example.test', 'erin@example.test'],
        date: '2026-03-05T12:00:00.000Z',
      }),
    ]);
    await index.indexSnapshot('mbx-2', 'snap-2', [mail('m4', { subject: 'Facture autre boîte' })]);
    return index;
  }
  const ids = (page: { items: { messageId: string }[] }) => page.items.map((i) => i.messageId);

  describe(`SearchIndex contract: ${name}`, () => {
    it('stores every metadata field', async () => {
      const index = await seeded();
      const page = await index.search({ ...base, q: 'facture', mailbox: 'mbx-1' });
      expect(page.items).toEqual([
        {
          ...mail('m1', { subject: 'Facture de janvier', attachments: ['facture-0001.pdf'] }),
          mailboxId: 'mbx-1',
          snapshotId: 'snap-1',
        },
      ]);
    });

    it('searches by subject, ignoring case and accents', async () => {
      const index = await seeded();
      expect(ids(await index.search({ ...base, q: 'REUNION', mailbox: 'mbx-1' }))).toEqual(['m2']);
    });

    it('searches attachment names and folders', async () => {
      const index = await seeded();
      expect(ids(await index.search({ ...base, q: 'pdf' }))).toEqual(['m1']);
      expect(ids(await index.search({ ...base, q: 'projets' }))).toEqual(['m2']);
    });

    it('filters by sender', async () => {
      const index = await seeded();
      const page = await index.search({ ...base, from: 'carol', mailbox: 'mbx-1' });
      expect(ids(page)).toEqual(['m2']);
    });

    it('filters by recipient', async () => {
      const index = await seeded();
      expect(ids(await index.search({ ...base, to: 'erin' }))).toEqual(['m3']);
    });

    it('filters by date range, upper bound excluded, newest first', async () => {
      const index = await seeded();
      const page = await index.search({
        ...base,
        mailbox: 'mbx-1',
        after: '2026-01-15T10:00:00.000Z',
        before: '2026-03-05T12:00:00.000Z',
      });
      expect(ids(page)).toEqual(['m2', 'm1']);
    });

    it('restricts to one mailbox', async () => {
      const index = await seeded();
      expect(await index.search({ ...base, q: 'facture' })).toMatchObject({ total: 2 });
      expect(ids(await index.search({ ...base, q: 'facture', mailbox: 'mbx-2' }))).toEqual(['m4']);
    });

    it('paginates and reports the total', async () => {
      const index = await seeded();
      const first = await index.search({ ...base, mailbox: 'mbx-1', limit: 2 });
      const second = await index.search({ ...base, mailbox: 'mbx-1', limit: 2, offset: 2 });
      expect(first.total).toBe(3);
      expect([...ids(first), ...ids(second)]).toEqual(['m3', 'm2', 'm1']);
    });

    it('returns the sheet of one mail, or null when it is not in that mailbox', async () => {
      const index = await seeded();
      expect(await index.getMail('mbx-1', 'm2')).toMatchObject({
        mailboxId: 'mbx-1',
        messageId: 'm2',
        snapshotId: 'snap-1',
        subject: 'Réunion équipe',
      });
      expect(await index.getMail('mbx-2', 'm2')).toBeNull();
      expect(await index.getMail('mbx-1', 'absent')).toBeNull();
    });

    it('treats query syntax as plain text', async () => {
      const index = await seeded();
      for (const q of ['"', 'facture OR', 'sujet*)', 'NEAR(', '-', 'subject:x']) {
        await expect(index.search({ ...base, q })).resolves.toBeDefined();
      }
      expect(ids(await index.search({ ...base, q: 'rapport" OR "facture' }))).toEqual([]);
    });

    it('tracks indexed snapshots and does not duplicate known messages', async () => {
      const index = await seeded();
      expect(await index.isSnapshotIndexed('snap-1')).toBe(true);
      expect(await index.isSnapshotIndexed('snap-x')).toBe(false);
      await index.indexSnapshot('mbx-1', 'snap-3', [mail('m1', { subject: 'Facture de janvier' })]);
      expect(await index.search({ ...base, mailbox: 'mbx-1' })).toMatchObject({ total: 3 });
    });

    it('ignores a second indexing of the same snapshot', async () => {
      const index = await seeded();
      await expect(index.indexSnapshot('mbx-1', 'snap-1', [mail('m9')])).resolves.toBeUndefined();
      expect(await index.search({ ...base, mailbox: 'mbx-1' })).toMatchObject({ total: 3 });
    });

    it('rolls back a snapshot that fails to index', async () => {
      const index = await create();
      const broken = [mail('a'), { ...mail('b'), subject: undefined as never }];
      await expect(index.indexSnapshot('mbx-1', 'snap-bad', broken)).rejects.toThrow();
      expect(await index.isSnapshotIndexed('snap-bad')).toBe(false);
      expect(await index.search(base)).toMatchObject({ total: 0 });
    });
  });
}
