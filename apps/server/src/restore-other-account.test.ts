import { describe, expect, it } from 'vitest';
import {
  FakeBackupCatalog,
  type AuditEvent,
  type AuditLog,
  type MailRestoreOutcome,
  type MailRestorer,
} from '@backup365/core';
import { AtlasSdkMailRestorer } from './atlas-mail-restore.js';
import { RestoreService, transferFolderName } from './restore-service.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';
import { buildTestApp } from './test-support.js';

/** Restauration d'un mail vers la boîte d'un autre compte (issue #546, docs/adr/0024). */

const SOURCE = 'camille@example.org';
const TARGET = 'dominique@example.org';
const SUBJECT = 'Budget 2026';

function restorerSpy() {
  const calls: unknown[][] = [];
  let release: (o: MailRestoreOutcome) => void = () => undefined;
  const restorer: MailRestorer = {
    restoreMessage: (...args) => {
      calls.push(args);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  return { restorer, calls, release: (o: MailRestoreOutcome) => release(o) };
}

async function setup(
  role: 'admin' | 'operator',
  catalogOver: Partial<Pick<FakeBackupCatalog, 'listMailboxes'>> = {},
) {
  const events: AuditEvent[] = [];
  const audit: AuditLog = {
    record: (e) => {
      events.push(e);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ total: 0, items: [] }),
    verify: () => Promise.resolve({ ok: true, entries: 0 }),
  };
  const searchIndex = SqliteSearchIndex.open(':memory:');
  await searchIndex.indexSnapshot(SOURCE, 'snap-1', [
    {
      messageId: 'm1',
      sender: 'x@example.org',
      recipients: [SOURCE],
      subject: SUBJECT,
      date: '2026-11-25T02:00:00.000Z',
      folder: 'Inbox',
      size: 10,
      attachments: [],
    },
  ]);
  const catalog = new FakeBackupCatalog({
    mailboxes: [
      { id: SOURCE, displayName: 'Camille Exemple' },
      { id: TARGET, displayName: 'Dominique Fictif' },
    ],
    snapshots: {},
  });
  Object.assign(catalog, catalogOver);
  const spy = restorerSpy();
  const service = new RestoreService({ restorer: spy.restorer, audit });
  const app = buildTestApp({
    version: '1',
    searchIndex,
    catalog,
    audit,
    restore: service,
    role,
    username: role === 'admin' ? 'admin-1' : 'operateur-1',
  });
  const post = (payload: object) =>
    app.inject({
      method: 'POST',
      url: `/api/mails/${encodeURIComponent(SOURCE)}/m1/restore`,
      payload,
    });
  return { app, events, spy, service, post };
}

const reason = 'Ticket INC-12345 : départ d’un agent';

describe('restore a mail to another account', () => {
  it('restores into the other mailbox, in a new dated folder named after the source', async () => {
    const t = await setup('admin');
    const res = await t.post({ reason, targetMailbox: TARGET });
    expect(res.statusCode).toBe(202);
    const { job } = res.json<{ job: Record<string, unknown> }>();
    expect(job).toMatchObject({
      status: 'running',
      folder: expect.stringMatching(/^Restauration de Camille Exemple \d\d-\d\d-\d{4}$/) as string,
      transfer: { sourceName: 'Camille Exemple', targetId: TARGET, targetName: 'Dominique Fictif' },
    });
    // Le SDK reçoit la boîte de destination : sans elle, il restaurerait chez la source.
    expect(t.spy.calls[0]).toEqual(['snap-1', 'm1', job.folder, TARGET]);
  });

  it('records who, what, to whom, the reason and the result', async () => {
    const t = await setup('admin');
    await t.post({ reason, targetMailbox: TARGET });
    t.spy.release({ restored: 1, errors: 0 });
    await t.service.idle();
    expect(t.events.map((e) => [e.action, e.actor, e.resource, e.target])).toEqual([
      ['restore.request', 'admin-1', 'mail.restore', `${SOURCE}/m1`],
      ['restore.result', 'admin-1', 'mail.restore', `${SOURCE}/m1`],
    ]);
    expect(t.events[0]?.reason).toBe(`from=${SOURCE};to=${TARGET};reason=${reason}`);
    expect(t.events[1]?.reason).toMatch(
      new RegExp(
        `^outcome=succeeded;duration_ms=\\d+;from=${SOURCE};to=${TARGET};reason=${reason}$`,
      ),
    );
    expect(t.events[1]?.count).toBe(1);
    // Jamais l'objet du mail dans le journal.
    expect(JSON.stringify(t.events)).not.toContain(SUBJECT);
  });

  it('refuses an operator with admin_required, records the refusal and restores nothing', async () => {
    const t = await setup('operator');
    const res = await t.post({ reason, targetMailbox: TARGET });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'admin_required' });
    expect(t.spy.calls).toHaveLength(0);
    expect(t.events).toMatchObject([
      { action: 'access.denied', resource: 'mail.restore', reason: 'admin_required' },
    ]);
    // L'opérateur garde la restauration dans la boîte d'origine.
    expect((await t.post({ reason })).statusCode).toBe(202);
  });

  it('refuses the source account and an account unknown to the catalog', async () => {
    const t = await setup('admin');
    const same = await t.post({ reason, targetMailbox: SOURCE });
    expect(same.statusCode).toBe(400);
    expect(same.json()).toEqual({ error: 'target_same' });
    const unknown = await t.post({ reason, targetMailbox: 'nobody@example.org' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: 'target_unknown' });
    expect((await t.post({ targetMailbox: TARGET })).json()).toEqual({ error: 'reason_required' });
    expect(t.spy.calls).toHaveLength(0);
    // Chaque destination refusée est consignée ; rien n'est demandé ni restauré.
    expect(t.events.map((e) => [e.action, e.reason])).toEqual([
      ['access.denied', 'target_same'],
      ['access.denied', 'target_unknown'],
    ]);
  });

  it('answers 503 when the catalog cannot vouch for the destination', async () => {
    const t = await setup('admin', {
      listMailboxes: () => Promise.reject(new Error('down')),
    });
    const res = await t.post({ reason, targetMailbox: TARGET });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'catalog_unavailable' });
    expect(t.spy.calls).toHaveLength(0);
    expect(t.events.map((e) => e.reason)).toEqual(['catalog_unavailable']);
  });
});

describe('transfer support', () => {
  it('names the folder after the source with a dd-mm-yyyy UTC date', () => {
    expect(transferFolderName('Camille Exemple', new Date('2026-11-26T23:30:00Z'))).toBe(
      'Restauration de Camille Exemple 26-11-2026',
    );
  });

  it('passes targetMailbox to the SDK only for another account', async () => {
    const seen: unknown[] = [];
    const restorer = new AtlasSdkMailRestorer({
      outlook: {
        restore: (_id, options) => {
          seen.push(options);
          return Promise.resolve({ restoredCount: 1, errorCount: 0 });
        },
      },
    });
    await restorer.restoreMessage('s', 'm1', 'F', TARGET);
    await restorer.restoreMessage('s', 'm1', 'F');
    expect(seen).toEqual([
      { messageRef: 'm1', folderName: 'F', targetMailbox: TARGET },
      { messageRef: 'm1', folderName: 'F' },
    ]);
  });
});
