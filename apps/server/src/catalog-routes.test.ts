import { CONTRACT_FIXTURE } from '@backup365/core/testing';
import { CatalogUnavailableError, FakeBackupCatalog, type BackupCatalog } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const fake = new FakeBackupCatalog({
  mailboxes: [{ ...CONTRACT_FIXTURE.mailbox }],
  snapshots: { 'mbx-1': CONTRACT_FIXTURE.snapshots.map((s) => ({ ...s })) },
});

describe('catalog routes', () => {
  it('lists mailboxes', async () => {
    const app = buildApp({ version: '1', catalog: fake });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mailboxes: [CONTRACT_FIXTURE.mailbox] });
  });

  it('lists mail snapshots by default, newest first', async () => {
    const app = buildApp({ version: '1', catalog: fake });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ snapshots: { id: string }[] }>().snapshots.map((s) => s.id);
    expect(ids).toEqual(['snap-new', 'snap-old']);
  });

  it('filters by workload', async () => {
    const app = buildApp({ version: '1', catalog: fake });
    const res = await app.inject({
      method: 'GET',
      url: '/api/mailboxes/mbx-1/snapshots?workload=contacts',
    });
    expect(res.json<{ snapshots: { id: string }[] }>().snapshots).toHaveLength(1);
  });

  it('rejects an unknown workload', async () => {
    const app = buildApp({ version: '1', catalog: fake });
    const res = await app.inject({
      method: 'GET',
      url: '/api/mailboxes/mbx-1/snapshots?workload=nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 503 when no catalog is configured', async () => {
    const app = buildApp({ version: '1' });
    expect((await app.inject({ method: 'GET', url: '/api/mailboxes' })).statusCode).toBe(503);
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(503);
  });

  it('answers 503 on the snapshots route when the catalog fails', async () => {
    const failing: BackupCatalog = {
      listMailboxes: () => Promise.resolve([]),
      listSnapshots: () => Promise.reject(new CatalogUnavailableError('x')),
      getSnapshotDetail: () => Promise.resolve(null),
    };
    const app = buildApp({ version: '1', catalog: failing });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(503);
  });

  it('rejects an oversized mailbox id', async () => {
    const app = buildApp({ version: '1', catalog: fake });
    const res = await app.inject({
      method: 'GET',
      url: `/api/mailboxes/${'a'.repeat(257)}/snapshots`,
    });
    // Fastify borne déjà la taille des paramètres de chemin : le routeur refuse (414).
    expect(res.statusCode).toBe(414);
  });

  it('keeps other errors as 500', async () => {
    const broken: BackupCatalog = {
      ...fake,
      listMailboxes: () => Promise.reject(new Error('boom')),
      listSnapshots: () => Promise.resolve([]),
      getSnapshotDetail: () => Promise.resolve(null),
    };
    const app = buildApp({ version: '1', catalog: broken });
    expect((await app.inject({ method: 'GET', url: '/api/mailboxes' })).statusCode).toBe(500);
  });

  it('answers 503 without details when the catalog fails', async () => {
    const failing: BackupCatalog = {
      ...fake,
      listMailboxes: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      listSnapshots: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      getSnapshotDetail: () => Promise.resolve(null),
    };
    const app = buildApp({ version: '1', catalog: failing });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('{"error":"catalog_unavailable"}');
  });
});
