import { describe, expect, it } from 'vitest';
import {
  MailContentUnavailableError,
  type AuditEvent,
  type AuditLog,
  type MailContent,
  type MailContentReader,
} from '@backup365/core';
import { buildApp } from './app.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';

/** Instantané factice : un vrai message MIME, des adresses en `example.test`. */
const MIME = Buffer.from(
  [
    'From: Alice <alice@example.test>',
    'To: bob@example.test',
    'Subject: Facture 1',
    'Date: Thu, 01 Jan 2026 10:00:00 +0000',
    'Message-ID: <m1@example.test>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Bonjour, voici la facture.',
    '',
  ].join('\r\n'),
);

function setup(over: { audit?: AuditLog; content?: MailContentReader | null } = {}) {
  const events: AuditEvent[] = [];
  const audit: AuditLog = over.audit ?? {
    record: (e) => {
      events.push(e);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ total: 0, items: [] }),
    verify: () => Promise.resolve({ ok: true, entries: 0 }),
  };
  const reads: [string, string][] = [];
  const content: MailContentReader = {
    readMessage: (snapshotId, ref) => {
      reads.push([snapshotId, ref]);
      const found: MailContent | null =
        ref === 'm1' ? { format: 'mime', raw: MIME, attachments: [] } : null;
      return Promise.resolve(found);
    },
  };
  const searchIndex = SqliteSearchIndex.open(':memory:');
  return {
    events,
    reads,
    searchIndex,
    build: async () => {
      await searchIndex.indexSnapshot('mbx-1', 'snap-1', [
        {
          messageId: 'm1',
          sender: 'alice@example.test',
          recipients: ['bob@example.test'],
          subject: 'Facture 1',
          date: '2026-01-01T10:00:00.000Z',
          folder: 'Inbox',
          size: MIME.length,
          attachments: [],
        },
      ]);
      return buildApp({
        version: '1',
        searchIndex,
        audit,
        ...(over.content === null ? {} : { mailContent: over.content ?? content }),
      });
    },
  };
}

const exportUrl = '/api/mails/mbx-1/m1/export';

describe('GET /api/mails/:mailboxId/:messageId', () => {
  it('returns the sheet and records item.open', async () => {
    const t = setup();
    const app = await t.build();
    const res = await app.inject({ method: 'GET', url: '/api/mails/mbx-1/m1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      messageId: 'm1',
      subject: 'Facture 1',
      snapshotId: 'snap-1',
    });
    expect(t.events).toMatchObject([{ action: 'item.open', resource: 'mail', target: 'mbx-1/m1' }]);
  });

  it('answers 404 and records access.denied for an unknown mail', async () => {
    const t = setup();
    const app = await t.build();
    const res = await app.inject({ method: 'GET', url: '/api/mails/mbx-1/absent' });
    expect(res.statusCode).toBe(404);
    expect(t.events).toMatchObject([{ action: 'access.denied', reason: 'mail_not_found' }]);
  });

  it('answers 503 without audit log', async () => {
    const searchIndex = SqliteSearchIndex.open(':memory:');
    const app = buildApp({ version: '1', searchIndex });
    const res = await app.inject({ method: 'GET', url: '/api/mails/mbx-1/m1' });
    expect(res.statusCode).toBe(503);
  });
});

describe('POST /api/mails/:mailboxId/:messageId/export', () => {
  it('exports the stored MIME bytes and records who, what, when and why', async () => {
    const t = setup();
    const app = await t.build();
    const res = await app.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: '  Demande de la direction juridique  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('message/rfc822');
    expect(res.headers['content-disposition']).toBe('attachment; filename="message.eml"');
    expect(res.rawPayload.equals(MIME)).toBe(true);
    expect(t.reads).toEqual([['snap-1', 'm1']]);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({
      action: 'item.export',
      actor: 'anonymous',
      resource: 'mail',
      target: 'mbx-1/m1',
      count: 1,
      reason: 'Demande de la direction juridique',
    });
    expect(Date.parse(t.events[0]?.at ?? '')).not.toBeNaN();
  });

  it.each([
    {},
    { reason: '' },
    { reason: '  ab ' },
    { reason: 'x'.repeat(501) },
    { reason: 'a\nb c' },
  ])('refuses a missing or invalid reason (%j) without reading or recording', async (payload) => {
    const t = setup();
    const app = await t.build();
    const res = await app.inject({ method: 'POST', url: exportUrl, payload });
    expect(res.statusCode).toBe(400);
    expect(t.reads).toEqual([]);
    expect(t.events).toEqual([]);
  });

  it('sends nothing when the audit log fails (fail-closed)', async () => {
    const audit: AuditLog = {
      record: () => Promise.reject(new Error('disk full')),
      list: () => Promise.resolve({ total: 0, items: [] }),
      verify: () => Promise.resolve({ ok: true, entries: 0 }),
    };
    const app = await setup({ audit }).build();
    const res = await app.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: 'Contrôle' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.rawPayload.includes(MIME)).toBe(false);
  });

  it('answers 503 without audit log', async () => {
    const app = buildApp({ version: '1', searchIndex: SqliteSearchIndex.open(':memory:') });
    const res = await app.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: 'Contrôle' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('answers 404 for an unknown mail and 503 without content reader, both recorded', async () => {
    const t = setup();
    const app = await t.build();
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/mails/mbx-1/absent/export',
      payload: { reason: 'Contrôle' },
    });
    expect(unknown.statusCode).toBe(404);

    const t2 = setup({ content: null });
    const app2 = await t2.build();
    const res = await app2.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: 'Contrôle' },
    });
    expect(res.statusCode).toBe(503);
    expect(t2.events).toMatchObject([{ action: 'access.denied', reason: 'content_unavailable' }]);
  });

  it('answers 503 when the storage fails, without leaking the cause', async () => {
    const content: MailContentReader = {
      readMessage: () =>
        Promise.reject(new MailContentUnavailableError('x', { cause: new Error('s3://secret') })),
    };
    const t = setup({ content });
    const app = await t.build();
    const res = await app.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: 'Contrôle' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('secret');
    expect(t.events).toMatchObject([{ action: 'access.denied', reason: 'content_unavailable' }]);
  });

  it('reconstructs the legacy Graph JSON format and flags omitted attachments', async () => {
    const content: MailContentReader = {
      readMessage: () =>
        Promise.resolve({
          format: 'graph-json',
          raw: new Uint8Array(),
          message: {
            subject: 'Réunion',
            from: { emailAddress: { name: 'Alice', address: 'alice@example.test' } },
            toRecipients: [{ emailAddress: { address: 'bob@example.test' } }],
            sentDateTime: '2026-01-01T10:00:00Z',
            body: { contentType: 'text', content: 'Bonjour' },
          },
          attachments: [{ name: 'a.pdf', contentType: 'application/pdf', size: 3 }],
        }),
    };
    const app = await setup({ content }).build();
    const res = await app.inject({
      method: 'POST',
      url: exportUrl,
      payload: { reason: 'Contrôle' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-backup365-omitted-attachments']).toBe('1');
    expect(res.body).toContain('From: Alice <alice@example.test>');
    expect(res.body).toContain('Subject: =?UTF-8?B?');
  });
});
