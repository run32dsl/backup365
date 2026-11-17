import { describe, expect, it } from 'vitest';
import type {
  AuditEvent,
  AuditLog,
  DriveRestoreOutcome,
  DriveRestoreRequest,
  DriveRestorer,
} from '@backup365/core';
import {
  AtlasSdkDriveBrowser,
  AtlasSdkDriveRestorer,
  type AtlasDriveReader,
  type AtlasDriveRestorer,
} from './atlas-drive.js';
import { DriveRestoreService } from './drive-restore-service.js';
import { buildTestApp } from './test-support.js';

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

const manifest = (hours: number) => ({
  snapshotId: 'snap-2',
  createdAt: new Date(Date.UTC(2026, 10, 14, 2, 10) - hours * 3_600_000),
  totalFiles: 3,
  entries: [
    {
      fileName: 'budget.xlsx',
      parentPath: '/Documents/Budget',
      sizeBytes: 84_000,
      lastModifiedAt: '2026-11-13T22:04:00.000Z',
      backupAt: '2026-11-14T02:10:00.000Z',
      changeType: 'updated',
    },
    {
      fileName: 'old.xlsx',
      parentPath: '/Documents/Budget/2025',
      sizeBytes: 1_000,
      backupAt: '2026-11-14T02:10:00.000Z',
      changeType: 'created',
    },
    {
      fileName: 'gone.txt',
      parentPath: '/Documents/Budget',
      sizeBytes: 5,
      backupAt: '2026-11-14T02:10:00.000Z',
      changeType: 'deleted',
    },
  ],
});

function fakeReader(): AtlasDriveReader {
  return {
    onedrive: {
      listSnapshots: (owner) =>
        owner === 'unknown@exemple.fr'
          ? Promise.resolve([])
          : Promise.resolve([{ ...manifest(48), snapshotId: 'snap-1', entries: [] }, manifest(0)]),
      listFileVersions: (_owner, ref) =>
        Promise.resolve(
          ref !== '/Documents/Budget/budget.xlsx'
            ? []
            : [
                {
                  snapshotId: 'snap-1',
                  backupAt: '2026-11-12T02:10:00.000Z',
                  versionId: 'v2',
                  sizeBytes: 81_000,
                  lastModifiedAt: '2026-11-10T18:30:00.000Z',
                  changeType: 'updated',
                },
                {
                  snapshotId: 'snap-2',
                  backupAt: '2026-11-14T02:10:00.000Z',
                  sizeBytes: 84_000,
                  lastModifiedAt: '2026-11-13T22:04:00.000Z',
                  changeType: 'updated',
                },
              ],
        ),
    },
  };
}

describe('AtlasSdkDriveBrowser', () => {
  const browser = new AtlasSdkDriveBrowser(fakeReader());

  it('lists snapshots newest first, folders then files, without deleted items', async () => {
    expect((await browser.listSnapshots('a@exemple.fr')).map((s) => s.id)).toEqual([
      'snap-2',
      'snap-1',
    ]);
    const entries = await browser.listFolder('a@exemple.fr', 'snap-2', '/Documents/Budget');
    expect(entries?.map((e) => [e.kind, e.name])).toEqual([
      ['folder', '2025'],
      ['file', 'budget.xlsx'],
    ]);
    expect(await browser.listFolder('a@exemple.fr', 'nope', '/')).toBeNull();
  });

  it('lists versions newest first and marks the current one', async () => {
    const versions = await browser.listVersions('a@exemple.fr', '/Documents/Budget/budget.xlsx');
    expect(versions.map((v) => [v.versionId, v.current])).toEqual([
      [null, true],
      ['v2', false],
    ]);
  });

  it('turns SDK failures into an unavailable catalog, keeping the message in the cause', async () => {
    const failing = new AtlasSdkDriveBrowser({
      onedrive: { listSnapshots: () => Promise.reject(new Error('https://bucket/secret')) },
    });
    await expect(failing.listSnapshots('a')).rejects.toMatchObject({
      name: 'CatalogUnavailableError',
      message: 'Sauvegarde OneDrive indisponible',
    });
    await expect(failing.listVersions('a', '/x')).rejects.toMatchObject({
      name: 'CatalogUnavailableError',
    });
  });
});

describe('AtlasSdkDriveRestorer', () => {
  function sdk() {
    const calls: [string, unknown][] = [];
    const atlas: AtlasDriveRestorer = {
      onedrive: {
        restore: (_o, options) => {
          calls.push(['restore', options]);
          return Promise.resolve({ filesRestored: 1, errors: [] });
        },
        restoreVersion: (_o, options) => {
          calls.push(['restoreVersion', options]);
          return Promise.resolve({ filesRestored: 0, errors: ['x', 'y'] });
        },
      },
    };
    return { calls, restorer: new AtlasSdkDriveRestorer(atlas) };
  }
  const base: DriveRestoreRequest = {
    ownerId: 'a',
    snapshotId: 'snap-2',
    path: '/Documents/Budget/budget.xlsx',
    kind: 'file',
    mode: 'copy',
    copyName: 'budget (restauré 14-11-2026).xlsx',
  };

  it('restores a file as a renamed copy in place, never replacing', async () => {
    const { calls, restorer } = sdk();
    expect(await restorer.restore(base)).toEqual({ restored: 1, errors: 0 });
    expect(calls).toEqual([
      [
        'restore',
        {
          snapshotId: 'snap-2',
          fileFilter: ['/Documents/Budget/budget.xlsx'],
          conflictBehavior: 'rename',
          inPlace: true,
          renameTo: 'budget (restauré 14-11-2026).xlsx',
        },
      ],
    ]);
  });

  it('restores a folder into a dated sibling folder', async () => {
    const { calls, restorer } = sdk();
    await restorer.restore({
      ...base,
      path: '/Documents/Budget',
      kind: 'folder',
      copyName: 'Budget (restauré 14-11-2026)',
    });
    expect(calls[0]?.[1]).toMatchObject({
      conflictBehavior: 'rename',
      destination: '/Documents/Budget (restauré 14-11-2026)',
    });
  });

  it('restores a version as a copy, or in place on explicit replacement, counting errors', async () => {
    const { calls, restorer } = sdk();
    expect(await restorer.restore({ ...base, versionId: 'v2' })).toEqual({
      restored: 0,
      errors: 2,
    });
    await restorer.restore({ ...base, versionId: 'v2', mode: 'replace' });
    expect(calls.map(([, o]) => (o as { placement: string }).placement)).toEqual([
      'copy',
      'in-place',
    ]);
    expect(calls[0]?.[0]).toBe('restoreVersion');
  });

  it('replaces a file only when asked, and refuses to replace a folder or the root', async () => {
    const { calls, restorer } = sdk();
    await restorer.restore({ ...base, mode: 'replace' });
    expect(calls[0]?.[1]).toMatchObject({ conflictBehavior: 'replace', inPlace: true });
    await expect(restorer.restore({ ...base, kind: 'folder', mode: 'replace' })).rejects.toThrow();
    await expect(restorer.restore({ ...base, path: '/' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

function controlled() {
  const calls: DriveRestoreRequest[] = [];
  let release: (o: DriveRestoreOutcome | Error) => void = () => undefined;
  const restorer: DriveRestorer = {
    restore: (req) => {
      calls.push(req);
      return new Promise((resolve, reject) => {
        release = (o) => {
          if (o instanceof Error) reject(o);
          else resolve(o);
        };
      });
    },
  };
  return { calls, restorer, release: (o: DriveRestoreOutcome | Error) => release(o) };
}

const target = {
  ownerId: 'a@exemple.fr',
  snapshotId: 'snap-2',
  path: '/Documents/Budget/budget.xlsx',
  name: 'budget.xlsx',
  kind: 'file' as const,
  mode: 'copy' as const,
  versionAt: null,
};

describe('DriveRestoreService', () => {
  it('measures the duration, names the copy and audits the request then the result', async () => {
    const { events, audit } = auditLog();
    const c = controlled();
    let now = Date.parse('2026-11-14T10:00:00Z');
    const service = new DriveRestoreService({ restorer: c.restorer, audit, now: () => now });
    const job = await service.start('alice', target, 'Ticket #1');
    expect(job).toMatchObject({
      status: 'running',
      copyName: 'budget (restauré 14-11-2026).xlsx',
    });
    now += 12_000;
    c.release({ restored: 1, errors: 0 });
    await service.idle();
    expect(service.last(target.ownerId, target.path)).toMatchObject({
      status: 'succeeded',
      durationMs: 12_000,
    });
    expect(events.map((e) => [e.action, e.resource, e.target])).toEqual([
      ['restore.request', 'onedrive.restore', 'a@exemple.fr/Documents/Budget/budget.xlsx'],
      ['restore.result', 'onedrive.restore', 'a@exemple.fr/Documents/Budget/budget.xlsx'],
    ]);
    expect(events[1]?.reason).toBe(
      'outcome=succeeded;duration_ms=12000;mode=copy;reason=Ticket #1',
    );
  });

  it('fails without keeping the SDK message, on errors, exception or timeout', async () => {
    const { events, audit } = auditLog();
    const c = controlled();
    const service = new DriveRestoreService({ restorer: c.restorer, audit, timeoutMs: 30 });
    await service.start('alice', target, 'Ticket #1');
    c.release({ restored: 0, errors: 1 });
    await service.idle();
    expect(service.last(target.ownerId, target.path)?.error).toBe('restore_error');
    await service.start('alice', target, 'Ticket #1');
    c.release(new Error('https://bucket/secret-key'));
    await service.idle();
    expect(service.last(target.ownerId, target.path)?.error).toBe('restore_unreachable');
    expect(JSON.stringify(events)).not.toContain('secret-key');
    await service.start('alice', target, 'Ticket #1');
    await service.idle();
    expect(service.last(target.ownerId, target.path)?.error).toBe('restore_unreachable');
  });

  it('refuses a second restoration of the same item, and does nothing if the audit fails', async () => {
    const c = controlled();
    const service = new DriveRestoreService({ restorer: c.restorer, audit: auditLog().audit });
    await service.start('alice', target, 'Ticket #1');
    expect(await service.start('bob', target, 'Ticket #2')).toBe('in_progress');
    c.release({ restored: 1, errors: 0 });
    await service.idle();

    const broken = controlled();
    const failing = new DriveRestoreService({
      restorer: broken.restorer,
      audit: auditLog({ record: () => Promise.reject(new Error('disk full')) }).audit,
    });
    await expect(failing.start('alice', target, 'Ticket #1')).rejects.toThrow('disk full');
    expect(broken.calls).toHaveLength(0);
    expect(failing.last(target.ownerId, target.path)).toBeUndefined();
  });
});

function setup(over: { configured?: boolean; audit?: AuditLog | null } = {}) {
  const { events, audit } = auditLog();
  const log = over.audit === null ? undefined : (over.audit ?? audit);
  const c = controlled();
  const service =
    over.configured === false || !log
      ? undefined
      : new DriveRestoreService({ restorer: c.restorer, audit: log });
  const app = buildTestApp({
    version: '1',
    drive: new AtlasSdkDriveBrowser(fakeReader()),
    ...(log ? { audit: log } : {}),
    ...(service ? { driveRestore: service } : {}),
  });
  return { app, events, c, service };
}

const owner = 'a%40exemple.fr';
const item = {
  snapshotId: 'snap-2',
  path: '/Documents/Budget/budget.xlsx',
  kind: 'file',
  mode: 'copy',
  reason: 'Ticket #1234 : fichier supprimé',
};
const post = (app: ReturnType<typeof setup>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/onedrive/${owner}/restore`, payload: payload as object });

describe('OneDrive read routes', () => {
  it('lists snapshots and folders, auditing the reading of items before answering', async () => {
    const t = setup();
    const snaps = await t.app.inject({ url: `/api/onedrive/${owner}/snapshots` });
    expect(snaps.json<{ snapshots: { id: string }[] }>().snapshots[0]?.id).toBe('snap-2');
    const res = await t.app.inject({
      url: `/api/onedrive/${owner}/items?snapshot=snap-2&path=/Documents/Budget`,
    });
    expect(res.json<{ entries: unknown[] }>().entries).toHaveLength(2);
    expect(t.events).toMatchObject([
      {
        action: 'list.view',
        resource: 'onedrive.items',
        target: 'a@exemple.fr/Documents/Budget',
        count: 2,
        actor: 'tester',
      },
    ]);
    const versions = await t.app.inject({
      url: `/api/onedrive/${owner}/versions?path=/Documents/Budget/budget.xlsx`,
    });
    expect(versions.json<{ versions: unknown[] }>().versions).toHaveLength(2);
    expect(t.events.at(-1)).toMatchObject({ action: 'item.open', resource: 'onedrive.versions' });
  });

  it('answers 404, 400 and 503 without leaking details', async () => {
    const t = setup();
    expect(
      (await t.app.inject({ url: `/api/onedrive/${owner}/items?snapshot=nope` })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ url: `/api/onedrive/${owner}/items?snapshot=snap-2&path=/a/../b` }))
        .statusCode,
    ).toBe(400);
    expect((await t.app.inject({ url: `/api/onedrive/${owner}/versions?path=/` })).statusCode).toBe(
      400,
    );
    expect(t.events.filter((e) => e.action === 'access.denied')).toHaveLength(1);

    const noAudit = setup({ audit: null });
    const res = await noAudit.app.inject({ url: `/api/onedrive/${owner}/items?snapshot=snap-2` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'audit_unavailable' });

    const broken = buildTestApp({
      version: '1',
      audit: auditLog().audit,
      drive: new AtlasSdkDriveBrowser({
        onedrive: { listSnapshots: () => Promise.reject(new Error('https://bucket/secret')) },
      }),
    });
    const down = await broken.inject({ url: `/api/onedrive/${owner}/items?snapshot=snap-2` });
    expect(down.statusCode).toBe(503);
    expect(down.body).not.toContain('secret');
  });
});

describe('OneDrive without storage', () => {
  it('answers catalog_unavailable, never backup_not_configured', async () => {
    const { audit } = auditLog();
    const noBrowser = buildTestApp({ version: '1', audit });
    const broken = buildTestApp({
      version: '1',
      audit,
      drive: new AtlasSdkDriveBrowser({
        onedrive: { listSnapshots: () => Promise.reject(new Error('down')) },
      }),
    });
    const urls = [
      `/api/onedrive/${owner}/snapshots`,
      `/api/onedrive/${owner}/items?snapshot=snap-2`,
      `/api/onedrive/${owner}/versions?path=/a.txt`,
    ];
    for (const app of [noBrowser, broken]) {
      for (const url of urls) {
        const res = await app.inject({ url });
        expect(res.statusCode, url).toBe(503);
        expect(res.json(), url).toEqual({ error: 'catalog_unavailable' });
        expect(res.body).not.toContain('backup_not_configured');
      }
    }
  });
});

describe('POST /api/onedrive/:ownerId/restore', () => {
  it('starts a restoration (202) and records the request with the reason', async () => {
    const t = setup({});
    const res = await post(t.app, item);
    expect(res.statusCode).toBe(202);
    expect(res.json<{ job: { copyName: string } }>().job.copyName).toMatch(
      /^budget \(restauré \d\d-\d\d-\d{4}\)\.xlsx$/,
    );
    expect(t.events).toMatchObject([
      { action: 'restore.request', reason: item.reason, actor: 'tester' },
    ]);
    expect(t.c.calls[0]).toMatchObject({ ownerId: 'a@exemple.fr', mode: 'copy' });
    t.c.release({ restored: 1, errors: 0 });
    await t.service?.idle();
    const last = await t.app.inject({ url: `/api/onedrive/${owner}/restore?path=${item.path}` });
    expect(last.json<{ last: { status: string } }>().last.status).toBe('succeeded');
  });

  it('restores a folder, and a version chosen in the panel', async () => {
    const t = setup();
    expect(
      (await post(t.app, { ...item, path: '/Documents/Budget', kind: 'folder' })).statusCode,
    ).toBe(202);
    t.c.release({ restored: 1, errors: 0 });
    await t.service?.idle();
    const version = await post(t.app, { ...item, snapshotId: 'snap-1', versionId: 'v2' });
    expect(version.statusCode).toBe(202);
    expect(version.json<{ job: { versionAt: string } }>().job.versionAt).toBe(
      '2026-11-10T18:30:00.000Z',
    );
    expect(t.c.calls[1]).toMatchObject({ versionId: 'v2', snapshotId: 'snap-1' });
  });

  it('requires a reason, without restoring or recording', async () => {
    const t = setup();
    for (const reason of [undefined, '  ', 'ab', 'x'.repeat(121)]) {
      const res = await post(t.app, { ...item, reason });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'reason_required' });
    }
    expect(t.events).toHaveLength(0);
    expect(t.c.calls).toHaveLength(0);
  });

  it('refuses malformed requests, and items or versions that the backup does not hold', async () => {
    const t = setup();
    for (const bad of [
      { ...item, path: '/' },
      { ...item, path: '/a/../b' },
      { ...item, kind: 'drive' },
      { ...item, mode: 'overwrite' },
      { ...item, snapshotId: '' },
      { ...item, kind: 'folder', path: '/Documents/Budget', mode: 'replace' },
      { ...item, kind: 'folder', path: '/Documents/Budget', versionId: 'v2' },
    ]) {
      expect((await post(t.app, bad)).statusCode).toBe(400);
    }
    expect((await post(t.app, { ...item, path: '/Documents/absent.txt' })).statusCode).toBe(404);
    expect((await post(t.app, { ...item, versionId: 'v9' })).statusCode).toBe(404);
    expect((await post(t.app, { ...item, snapshotId: 'nope' })).statusCode).toBe(404);
    expect(t.c.calls).toHaveLength(0);
    expect(t.events.filter((e) => e.action === 'restore.request')).toHaveLength(0);
  });

  it('answers 409 while running, 503 when not configured or without audit', async () => {
    const t = setup();
    expect((await post(t.app, item)).statusCode).toBe(202);
    expect((await post(t.app, item)).statusCode).toBe(409);
    const none = setup({ configured: false });
    const res = await post(none.app, item);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'restore_unavailable' });
    expect((await post(setup({ audit: null }).app, item)).statusCode).toBe(503);
  });

  it('never writes file names beyond the path, nor any content, to the audit', async () => {
    const t = setup();
    await post(t.app, item);
    t.c.release({ restored: 1, errors: 0 });
    await t.service?.idle();
    expect(JSON.stringify(t.events)).not.toContain('84000');
    expect(t.events.map((e) => e.action)).toEqual(['restore.request', 'restore.result']);
  });
});

describe('OneDrive restoration state and timeouts', () => {
  it('reports its own configuration, apart from the mail restoration', async () => {
    expect((await setup().app.inject({ url: '/api/onedrive/status' })).json()).toEqual({
      configured: true,
    });
    expect(
      (await setup({ configured: false }).app.inject({ url: '/api/onedrive/status' })).json(),
    ).toEqual({ configured: false });
  });

  it('does not announce a copy name for a restored version, whose name the SDK picks', async () => {
    const t = setup();
    const res = await post(t.app, { ...item, snapshotId: 'snap-1', versionId: 'v2' });
    expect(res.json<{ job: { copyName: string | null } }>().job.copyName).toBeNull();
  });

  it('keeps the item reserved after the timeout until the SDK call really ends', async () => {
    const c = controlled();
    const { events, audit } = auditLog();
    const service = new DriveRestoreService({ restorer: c.restorer, audit, timeoutMs: 20 });
    await service.start('alice', target, 'Ticket #1');
    await service.idle();
    expect(service.last(target.ownerId, target.path)?.error).toBe('restore_unreachable');
    expect(await service.start('bob', target, 'Ticket #2')).toBe('in_progress');
    c.release(new Error('late failure'));
    await new Promise((r) => setTimeout(r, 5));
    expect(await service.start('bob', target, 'Ticket #2')).toMatchObject({ status: 'running' });
    expect(events.filter((e) => e.action === 'restore.result')).toHaveLength(1);
    c.release({ restored: 1, errors: 0 });
    await service.idle();
  });
});
