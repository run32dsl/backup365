import { OwnerBusyError } from '@wisecom/atlas-sdk';
import { describe, expect, it } from 'vitest';
import type { AuditEvent, AuditLog, MailRestoreOutcome, MailRestorer } from '@backup365/core';
import { AtlasSdkMailRestorer } from './atlas-mail-restore.js';
import { RestoreService, restoreFolderName } from './restore-service.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';
import { buildTestApp } from './test-support.js';

const SECRET_SUBJECT = 'Facture secrète 1';

function auditLog(over: Partial<AuditLog> = {}) {
  const events: AuditEvent[] = [];
  const audit: AuditLog = {
    record: (e) => {
      events.push(e);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ total: 0, items: [] }),
    verify: () => Promise.resolve({ ok: true, entries: 0 }),
    ...over,
  };
  return { events, audit };
}

/** Restaurateur qu'un test débloque à la main ; `calls` garde ce qu'il a reçu. */
function controlledRestorer() {
  const calls: [string, string, string][] = [];
  let release: (outcome: MailRestoreOutcome | Error) => void = () => undefined;
  const restorer: MailRestorer = {
    restoreMessage: (snapshotId, ref, folder) => {
      calls.push([snapshotId, ref, folder]);
      return new Promise((resolve, reject) => {
        release = (o) => {
          if (o instanceof Error) reject(o);
          else resolve(o);
        };
      });
    },
  };
  return { restorer, calls, release: (o: MailRestoreOutcome | Error) => release(o) };
}

const target = { mailboxId: 'mbx-1', messageId: 'm1', snapshotId: 'snap-1' };

describe('AtlasSdkMailRestorer', () => {
  it('restores one message into the original mailbox, in the named folder', async () => {
    const seen: unknown[] = [];
    const restorer = new AtlasSdkMailRestorer({
      outlook: {
        restore: (snapshotId, options) => {
          seen.push(snapshotId, options);
          return Promise.resolve({ restoredCount: 1, errorCount: 0 });
        },
      },
    });
    const out = await restorer.restoreMessage('snap-1', 'm1', 'Restauré par backup365 14/11/2026');
    expect(out).toEqual({ restored: 1, errors: 0 });
    // Aucune boîte cible : le SDK restaure dans la boîte d'origine.
    expect(seen).toEqual([
      'snap-1',
      { messageRef: 'm1', folderName: 'Restauré par backup365 14/11/2026' },
    ]);
  });
});

describe('restoreFolderName', () => {
  it('formats the UTC date as dd/mm/yyyy', () => {
    expect(restoreFolderName(new Date('2026-11-04T23:59:00Z'))).toBe(
      'Restauré par backup365 04/11/2026',
    );
  });
});

describe('RestoreService', () => {
  it('measures the duration and records the request then the result', async () => {
    const { events, audit } = auditLog();
    const c = controlledRestorer();
    let now = Date.parse('2026-11-14T10:00:00Z');
    const service = new RestoreService({ restorer: c.restorer, audit, now: () => now });
    const job = await service.start('alice', target, 'Ticket #1');
    expect(job).toMatchObject({ status: 'running', durationMs: null });
    expect(service.last('mbx-1', 'm1')?.status).toBe('running');
    expect(c.calls).toEqual([['snap-1', 'm1', 'Restauré par backup365 14/11/2026']]);

    now += 18_000;
    c.release({ restored: 1, errors: 0 });
    await service.idle();
    expect(service.last('mbx-1', 'm1')).toMatchObject({
      status: 'succeeded',
      durationMs: 18_000,
      error: null,
    });
    expect(events.map((e) => [e.action, e.actor, e.target])).toEqual([
      ['restore.request', 'alice', 'mbx-1/m1'],
      ['restore.result', 'alice', 'mbx-1/m1'],
    ]);
    expect(events[0]?.reason).toBe('Ticket #1');
    expect(events[1]?.reason).toBe('outcome=succeeded;duration_ms=18000;reason=Ticket #1');
  });

  it('fails on reported errors or on an exception, without keeping the SDK message', async () => {
    const { events, audit } = auditLog();
    const c = controlledRestorer();
    const service = new RestoreService({ restorer: c.restorer, audit });
    await service.start('alice', target, 'Ticket #1');
    c.release({ restored: 0, errors: 1 });
    await service.idle();
    expect(service.last('mbx-1', 'm1')).toMatchObject({
      status: 'failed',
      error: 'restore_error',
    });

    await service.start('alice', target, 'Ticket #1');
    c.release(new Error('https://bucket.example.test/secret-key failed'));
    await service.idle();
    const last = service.last('mbx-1', 'm1');
    expect(last).toMatchObject({ status: 'failed', error: 'restore_unreachable' });
    expect(JSON.stringify([last, events])).not.toContain('secret-key');
    expect(events.at(-1)?.reason).toMatch(/^outcome=failed;duration_ms=\d+;reason=Ticket #1$/);
  });

  it('says the mailbox is busy when the SDK refuses it (ATLAS_OWNER_BUSY, issue #567)', async () => {
    const c = controlledRestorer();
    const service = new RestoreService({ restorer: c.restorer, audit: auditLog().audit });
    await service.start('alice', target, 'Ticket #1');
    c.release(new OwnerBusyError({ workload: 'outlook', owner_id: 'mbx-1' }));
    await service.idle();
    expect(service.last('mbx-1', 'm1')).toMatchObject({ status: 'failed', error: 'restore_busy' });
  });

  it('fails a restoration that never returns', async () => {
    const c = controlledRestorer();
    const service = new RestoreService({
      restorer: c.restorer,
      audit: auditLog().audit,
      timeoutMs: 20,
    });
    await service.start('alice', target, 'Ticket #1');
    await service.idle();
    expect(service.last('mbx-1', 'm1')).toMatchObject({
      status: 'failed',
      error: 'restore_unreachable',
    });
  });

  it('refuses a second restoration of the same mail while one runs', async () => {
    const c = controlledRestorer();
    const service = new RestoreService({ restorer: c.restorer, audit: auditLog().audit });
    await service.start('alice', target, 'Ticket #1');
    expect(await service.start('bob', target, 'Ticket #2')).toBe('in_progress');
    c.release({ restored: 1, errors: 0 });
    await service.idle();
    expect(await service.start('bob', target, 'Ticket #2')).toMatchObject({ status: 'running' });
    c.release({ restored: 1, errors: 0 });
    await service.idle();
  });

  it('does not restore when the request cannot be recorded', async () => {
    const c = controlledRestorer();
    const { audit } = auditLog({ record: () => Promise.reject(new Error('disk full')) });
    const service = new RestoreService({ restorer: c.restorer, audit });
    await expect(service.start('alice', target, 'Ticket #1')).rejects.toThrow('disk full');
    expect(c.calls).toHaveLength(0);
    expect(service.last('mbx-1', 'm1')).toBeUndefined();
  });

  it('reports a result that cannot be recorded without failing the restoration', async () => {
    const codes: string[] = [];
    let n = 0;
    const { audit } = auditLog({
      record: () => (++n === 1 ? Promise.resolve() : Promise.reject(new Error('disk full'))),
    });
    const c = controlledRestorer();
    const service = new RestoreService({
      restorer: c.restorer,
      audit,
      onError: (code) => codes.push(code),
    });
    await service.start('alice', target, 'Ticket #1');
    c.release({ restored: 1, errors: 0 });
    await service.idle();
    expect(service.last('mbx-1', 'm1')?.status).toBe('succeeded');
    expect(codes).toEqual(['audit_result_failed']);
  });
});

async function setup(
  over: {
    role?: 'admin' | 'operator';
    restorer?: MailRestorer | null;
    audit?: AuditLog | null;
  } = {},
) {
  const { events, audit } = auditLog();
  const c = controlledRestorer();
  const searchIndex = SqliteSearchIndex.open(':memory:');
  await searchIndex.indexSnapshot('mbx-1', 'snap-1', [
    {
      messageId: 'm1',
      sender: 'alice@example.test',
      recipients: ['bob@example.test'],
      subject: SECRET_SUBJECT,
      date: '2026-01-01T10:00:00.000Z',
      folder: 'Inbox',
      size: 10,
      attachments: [],
    },
  ]);
  const log = over.audit === null ? undefined : (over.audit ?? audit);
  const service =
    over.restorer === null || !log
      ? undefined
      : new RestoreService({ restorer: over.restorer ?? c.restorer, audit: log });
  const app = buildTestApp({
    version: '1',
    searchIndex,
    ...(log ? { audit: log } : {}),
    ...(service ? { restore: service } : {}),
    ...(over.role ? { role: over.role } : {}),
  });
  return { app, events, c, service };
}

const url = '/api/mails/mbx-1/m1/restore';
const post = (app: Awaited<ReturnType<typeof setup>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });

describe('POST /api/mails/:mailboxId/:messageId/restore', () => {
  it('starts the restoration (202) for an operator and records the request with the reason', async () => {
    const t = await setup({ role: 'operator' });
    const res = await post(t.app, { reason: ' Ticket #1234 : mail supprimé par erreur ' });
    expect(res.statusCode).toBe(202);
    expect(res.json<{ job: { status: string; folder: string } }>().job).toMatchObject({
      status: 'running',
      folder: expect.stringMatching(/^Restauré par backup365 \d\d\/\d\d\/\d{4}$/) as string,
    });
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({
      action: 'restore.request',
      actor: 'tester',
      target: 'mbx-1/m1',
      reason: 'Ticket #1234 : mail supprimé par erreur',
    });
    expect(t.c.calls[0]?.[0]).toBe('snap-1');

    t.c.release({ restored: 1, errors: 0 });
    await t.service?.idle();
    const status = await t.app.inject({ url });
    expect(status.json<{ last: { status: string; durationMs: number } }>().last).toMatchObject({
      status: 'succeeded',
    });
  });

  it('never writes the content or the subject of the mail to the audit', async () => {
    const t = await setup();
    await post(t.app, { reason: 'Ticket #1' });
    t.c.release({ restored: 1, errors: 0 });
    await t.service?.idle();
    expect(t.events).toHaveLength(2);
    expect(JSON.stringify(t.events)).not.toContain(SECRET_SUBJECT);
    expect(JSON.stringify(t.events)).not.toContain('alice@example.test');
  });

  it('requires a reason of 3 to 120 characters, without restoring or recording', async () => {
    const t = await setup();
    for (const payload of [{}, { reason: '  ' }, { reason: 'ab' }, { reason: 'x'.repeat(121) }]) {
      const res = await post(t.app, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'reason_required' });
    }
    expect((await post(t.app, { reason: 'x'.repeat(120) })).statusCode).toBe(202);
    expect(t.events.filter((e) => e.action === 'restore.request')).toHaveLength(1);
  });

  it('answers 404 for an unknown mail, 409 while running', async () => {
    const t = await setup();
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/api/mails/mbx-1/nope/restore',
      payload: { reason: 'Ticket #1' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(t.c.calls).toHaveLength(0);
    expect((await post(t.app, { reason: 'Ticket #1' })).statusCode).toBe(202);
    const again = await post(t.app, { reason: 'Ticket #1' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'restore_in_progress' });
  });

  it('answers 503 when restoration is not configured or the audit is missing', async () => {
    const none = await setup({ restorer: null });
    const res = await post(none.app, { reason: 'Ticket #1' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'restore_unavailable' });
    expect((await none.app.inject({ url: '/api/restore' })).json()).toEqual({ configured: false });

    const noAudit = await setup({ audit: null });
    expect((await post(noAudit.app, { reason: 'Ticket #1' })).statusCode).toBe(503);
  });

  it('reports configured restoration', async () => {
    const t = await setup();
    expect((await t.app.inject({ url: '/api/restore' })).json()).toEqual({ configured: true });
    expect((await t.app.inject({ url })).json()).toEqual({ last: null });
  });

  it('requires a session', async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: 'POST',
      url,
      payload: { reason: 'Ticket #1' },
      headers: { cookie: 'x=y', 'x-csrf-token': 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});
