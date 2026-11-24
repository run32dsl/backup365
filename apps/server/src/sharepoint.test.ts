import { describe, expect, it } from 'vitest';
import {
  FakeBackupCatalog,
  type AuditEvent,
  type AuditLog,
  type SiteRestoreOutcome,
  type SiteRestoreRequest,
  type SiteRestorer,
} from '@backup365/core';
import {
  AtlasSdkSiteBrowser,
  AtlasSdkSiteRestorer,
  type AtlasSiteReader,
  type AtlasSiteRestorer,
} from './atlas-site.js';
import { SiteRestoreService } from './site-restore-service.js';
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

const entry = (library: string, parentPath: string, fileName: string, sizeBytes = 100) => ({
  libraryName: library,
  fileName,
  parentPath,
  sizeBytes,
  backupAt: '2026-11-14T02:10:00.000Z',
  changeType: 'updated',
});

const reader: AtlasSiteReader = {
  sharepoint: {
    listSnapshots: (siteId) =>
      siteId === 'broken'
        ? Promise.reject(new Error('https://bucket/secret'))
        : Promise.resolve([
            {
              snapshotId: 'snap-1',
              entries: [
                entry('Documents', '/Plans', 'plan-a.pdf', 800),
                entry('Documents', '/Plans', 'plan-b.pdf', 200),
                entry('Archives', '/', 'old.pdf', 50),
              ],
            },
            { snapshotId: 'snap-bare' },
            { snapshotId: 'snap-empty', entries: [] },
          ]),
  },
};

describe('AtlasSdkSiteBrowser', () => {
  const browser = new AtlasSdkSiteBrowser(reader);

  it('lists libraries, folders and files, and sizes a scope', async () => {
    expect((await browser.listFolder('s', 'snap-1', '/'))?.map((e) => e.name)).toEqual([
      'Archives',
      'Documents',
    ]);
    expect(await browser.summarize('s', 'snap-1', '/Documents')).toEqual({
      items: 2,
      sizeBytes: 1_000,
    });
    expect(await browser.listFolder('s', 'nope', '/')).toBeNull();
  });

  it('turns SDK failures and missing manifests into an unavailable catalog', async () => {
    await expect(browser.listFolder('broken', 'snap-1', '/')).rejects.toMatchObject({
      name: 'CatalogUnavailableError',
      message: 'Sauvegarde SharePoint indisponible',
    });
    await expect(browser.listFolder('s', 'snap-bare', '/')).rejects.toMatchObject({
      name: 'CatalogUnavailableError',
    });
  });
});

describe('AtlasSdkSiteRestorer', () => {
  function sdk(
    over: Partial<Awaited<ReturnType<AtlasSiteRestorer['sharepoint']['restore']>>> = {},
  ) {
    const calls: unknown[] = [];
    const atlas: AtlasSiteRestorer = {
      sharepoint: {
        restore: (_s, options) => {
          calls.push(options);
          return Promise.resolve({
            filesRestored: 3,
            filesSkipped: 2,
            errors: [],
            interrupted: false,
            ...over,
          });
        },
      },
    };
    return { calls, restorer: new AtlasSdkSiteRestorer(atlas) };
  }
  const req = (over: Partial<SiteRestoreRequest>): SiteRestoreRequest => ({
    siteId: 's',
    snapshotId: 'snap-1',
    scope: 'folder',
    path: '/Documents/Plans',
    copyName: '',
    ...over,
  });

  it('always restores in place and never replaces', async () => {
    const { calls, restorer } = sdk();
    await restorer.restore(req({}));
    await restorer.restore(
      req({
        scope: 'item',
        path: '/Documents/Plans/a.pdf',
        copyName: 'a (restauré le 14-11-2026).pdf',
      }),
    );
    await restorer.restore(req({ scope: 'site', path: '/' }));
    expect(calls).toEqual([
      {
        snapshotId: 'snap-1',
        fileFilter: ['/Documents/Plans'],
        conflictBehavior: 'rename',
        inPlace: true,
      },
      {
        snapshotId: 'snap-1',
        fileFilter: ['/Documents/Plans/a.pdf'],
        conflictBehavior: 'rename',
        inPlace: true,
        renameTo: 'a (restauré le 14-11-2026).pdf',
      },
      { snapshotId: 'snap-1', conflictBehavior: 'rename', inPlace: true },
    ]);
  });

  it('counts restored, skipped and errors, an interruption being an error', async () => {
    expect(await sdk().restorer.restore(req({}))).toEqual({ restored: 3, skipped: 2, errors: 0 });
    expect(await sdk({ errors: ['x'], interrupted: true }).restorer.restore(req({}))).toMatchObject(
      { errors: 2 },
    );
  });
});

function controlled() {
  const calls: SiteRestoreRequest[] = [];
  let release: (o: SiteRestoreOutcome | Error) => void = () => undefined;
  const restorer: SiteRestorer = {
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
  return { calls, restorer, release: (o: SiteRestoreOutcome | Error) => release(o) };
}

const target = {
  siteId: 'site-1',
  snapshotId: 'snap-1',
  scope: 'item' as const,
  path: '/Documents/Plans/plan-a.pdf',
  name: 'plan-a.pdf',
  total: 1,
};

describe('SiteRestoreService', () => {
  it('measures the duration, counts the items and audits the request then the result', async () => {
    const { events, audit } = auditLog();
    const c = controlled();
    let now = Date.parse('2026-11-14T10:00:00Z');
    const service = new SiteRestoreService({ restorer: c.restorer, audit, now: () => now });
    const job = await service.start('alice', target, 'Ticket #1');
    expect(job).toMatchObject({
      status: 'running',
      copyName: 'plan-a (restauré le 14-11-2026).pdf',
    });
    now += 192_000;
    c.release({ restored: 1, skipped: 0, errors: 0 });
    await service.idle();
    expect(service.last('site-1')).toMatchObject({
      status: 'succeeded',
      durationMs: 192_000,
      restored: 1,
    });
    expect(events.map((e) => [e.action, e.resource, e.target])).toEqual([
      ['restore.request', 'sharepoint.restore', 'site-1/Documents/Plans/plan-a.pdf'],
      ['restore.result', 'sharepoint.restore', 'site-1/Documents/Plans/plan-a.pdf'],
    ]);
    expect(events[1]).toMatchObject({
      count: 1,
      reason: 'outcome=succeeded;duration_ms=192000;scope=item;skipped=0;errors=0;reason=Ticket #1',
    });
  });

  it('keeps partial counts on failure, without the SDK message', async () => {
    const { events, audit } = auditLog();
    const c = controlled();
    const service = new SiteRestoreService({ restorer: c.restorer, audit, timeoutMs: 30 });
    await service.start('alice', { ...target, scope: 'library', path: '/Documents' }, 'Ticket #1');
    c.release({ restored: 640, skipped: 0, errors: 1 });
    await service.idle();
    expect(service.last('site-1')).toMatchObject({
      status: 'failed',
      error: 'restore_error',
      restored: 640,
      errors: 1,
    });
    await service.start('alice', target, 'Ticket #1');
    c.release(new Error('https://bucket/secret-key'));
    await service.idle();
    expect(service.last('site-1')?.error).toBe('restore_unreachable');
    expect(JSON.stringify(events)).not.toContain('secret-key');
    await service.start('alice', target, 'Ticket #1');
    await service.idle();
    expect(service.last('site-1')?.error).toBe('restore_unreachable');
  });

  it('refuses a second restoration of the same site, and does nothing if the audit fails', async () => {
    const c = controlled();
    const service = new SiteRestoreService({ restorer: c.restorer, audit: auditLog().audit });
    await service.start('alice', target, 'Ticket #1');
    expect(await service.start('bob', { ...target, scope: 'site', path: '/' }, 'x y z')).toBe(
      'in_progress',
    );
    c.release({ restored: 1, skipped: 0, errors: 0 });
    await service.idle();

    const broken = controlled();
    const failing = new SiteRestoreService({
      restorer: broken.restorer,
      audit: auditLog({ record: () => Promise.reject(new Error('disk full')) }).audit,
    });
    await expect(failing.start('alice', target, 'Ticket #1')).rejects.toThrow('disk full');
    expect(broken.calls).toHaveLength(0);
    expect(failing.last('site-1')).toBeUndefined();
  });
});

function setup(
  over: { configured?: boolean; audit?: AuditLog | null; role?: 'admin' | 'operator' } = {},
) {
  const { events, audit } = auditLog();
  const log = over.audit === null ? undefined : (over.audit ?? audit);
  const c = controlled();
  const service =
    over.configured === false || !log
      ? undefined
      : new SiteRestoreService({ restorer: c.restorer, audit: log });
  const app = buildTestApp({
    version: '1',
    ...(over.role ? { role: over.role } : {}),
    catalog: new FakeBackupCatalog({
      mailboxes: [],
      sites: [{ id: 'site-1', displayName: 'Site Urbanisme (exemple)' }],
      snapshots: {
        'site-1': [{ id: 'snap-1', workload: 'sharepoint', createdAt: '2026-11-12T02:00:00.000Z' }],
      },
    }),
    site: new AtlasSdkSiteBrowser(reader),
    ...(log ? { audit: log } : {}),
    ...(service ? { siteRestore: service } : {}),
  });
  return { app, events, c, service };
}

const post = (app: ReturnType<typeof setup>['app'], payload: unknown, site = 'site-1') =>
  app.inject({
    method: 'POST',
    url: `/api/sharepoint/${site}/restore`,
    payload: payload as object,
  });
const library = {
  snapshotId: 'snap-1',
  scope: 'library',
  path: '/Documents',
  reason: 'Suppression accidentelle : dossier supprimé par erreur',
};

describe('SharePoint routes', () => {
  it('lists the sites and snapshots without audit, then audits the content before answering', async () => {
    const { app, events } = setup();
    expect((await app.inject('/api/sharepoint/sites')).json()).toEqual({
      sites: [{ id: 'site-1', displayName: 'Site Urbanisme (exemple)' }],
    });
    expect((await app.inject('/api/sharepoint/site-1/snapshots')).json()).toMatchObject({
      snapshots: [{ id: 'snap-1' }],
    });
    expect(events).toHaveLength(0);
    const items = await app.inject('/api/sharepoint/site-1/items?snapshot=snap-1&path=/Documents');
    expect(items.json().entries.map((e: { name: string }) => e.name)).toEqual(['Plans']);
    const scope = await app.inject('/api/sharepoint/site-1/scope?snapshot=snap-1&path=/Documents');
    expect(scope.json()).toEqual({ items: 2, sizeBytes: 1_000 });
    expect(events.map((e) => [e.action, e.resource, e.target, e.count])).toEqual([
      ['list.view', 'sharepoint.items', 'site-1/Documents', 1],
      ['list.view', 'sharepoint.scope', 'site-1/Documents', 2],
    ]);
    expect((await app.inject('/api/sharepoint/site-1/items?snapshot=nope')).statusCode).toBe(404);
    expect(
      (await app.inject('/api/sharepoint/site-1/items?snapshot=snap-1&path=/a/../b')).statusCode,
    ).toBe(400);
  });

  it('refuses to show content without an audit log, and says when restoring is not configured', async () => {
    const { app } = setup({ audit: null });
    expect((await app.inject('/api/sharepoint/site-1/items?snapshot=snap-1')).statusCode).toBe(503);
    const off = setup({ configured: false });
    expect((await off.app.inject('/api/sharepoint/status')).json()).toEqual({ configured: false });
    expect((await post(off.app, library)).json()).toEqual({ error: 'restore_unavailable' });
    expect((await setup().app.inject('/api/sharepoint/status')).json()).toEqual({
      configured: true,
    });
  });

  it('restores a library in the background, with reason and audit, then reports the last job', async () => {
    const { app, events, c, service } = setup();
    const res = await post(app, library);
    expect(res.statusCode).toBe(202);
    expect(res.json().job).toMatchObject({ scope: 'library', total: 2, status: 'running' });
    expect(c.calls[0]).toMatchObject({ scope: 'library', path: '/Documents', copyName: '' });
    expect((await post(app, library)).statusCode).toBe(409);
    c.release({ restored: 1, skipped: 1, errors: 0 });
    await service?.idle();
    const last = (await app.inject('/api/sharepoint/site-1/restore')).json().last;
    expect(last).toMatchObject({ status: 'succeeded', restored: 1, skipped: 1 });
    expect(events.map((e) => e.action)).toEqual(['restore.request', 'restore.result']);
    expect(events[0]?.reason).toContain('Suppression accidentelle');
  });

  it('validates the request on the server', async () => {
    const { app, c } = setup();
    expect((await post(app, { ...library, reason: ' ' })).json()).toEqual({
      error: 'reason_required',
    });
    for (const bad of [
      { ...library, scope: 'everything' },
      { ...library, scope: 'folder' }, // chemin d'une bibliothèque
      { ...library, scope: 'site' },
      { ...library, path: '/Documents/../x' },
      { ...library, snapshotId: '' },
    ]) {
      expect((await post(app, bad)).statusCode).toBe(400);
    }
    // Existent dans la sauvegarde, avec le bon type.
    for (const missing of [
      { ...library, path: '/Inconnue' },
      { ...library, scope: 'folder', path: '/Documents/Plans/plan-a.pdf' },
      { ...library, scope: 'item', path: '/Documents/Plans' },
      { ...library, snapshotId: 'nope' },
    ]) {
      expect((await post(app, missing)).statusCode).toBe(404);
    }
    expect((await post(app, library, 'autre-site')).statusCode).toBe(404);
    expect(c.calls).toHaveLength(0);
  });

  it('restores a single file under a dated copy name', async () => {
    const { app, c } = setup();
    const res = await post(app, {
      ...library,
      scope: 'item',
      path: '/Documents/Plans/plan-a.pdf',
    });
    expect(res.statusCode).toBe(202);
    expect(c.calls[0]?.copyName).toMatch(/^plan-a \(restauré le \d\d-\d\d-\d{4}\)\.pdf$/);
  });

  it('reserves the whole site to administrators who retype its name', async () => {
    const whole = { ...library, scope: 'site', path: '/' };
    const operator = setup({ role: 'operator' });
    expect((await post(operator.app, whole)).json()).toEqual({ error: 'admin_required' });
    expect((await post(operator.app, library)).statusCode).toBe(202);
    expect(operator.events.some((e) => e.reason === 'admin_required')).toBe(true);

    const admin = setup({ role: 'admin' });
    expect((await post(admin.app, whole)).json()).toEqual({ error: 'confirmation_mismatch' });
    expect(
      (await post(admin.app, { ...whole, confirmName: 'site urbanisme (exemple)' })).statusCode,
    ).toBe(400);
    expect(admin.c.calls).toHaveLength(0);
    expect(admin.events.some((e) => e.reason === 'confirmation_mismatch')).toBe(true);
    // Un site sans aucun fichier actif n'a rien à restaurer.
    const empty = await post(admin.app, {
      ...whole,
      snapshotId: 'snap-empty',
      confirmName: 'Site Urbanisme (exemple)',
    });
    expect(empty.json()).toEqual({ error: 'empty_scope' });
    const ok = await post(admin.app, { ...whole, confirmName: 'Site Urbanisme (exemple)' });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().job).toMatchObject({ scope: 'site', total: 3 });
    expect(admin.c.calls[0]).toMatchObject({ scope: 'site', path: '/' });
  });

  it('answers 503 without leaking the SDK message when the storage fails', async () => {
    const { app } = setup();
    const res = await app.inject('/api/sharepoint/broken/items?snapshot=snap-1');
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('secret');
  });
});

describe('SharePoint without storage', () => {
  it('answers catalog_unavailable on reads, never backup_not_configured', async () => {
    const app = buildTestApp({ version: '1' });
    for (const url of ['/api/sharepoint/sites', '/api/sharepoint/site-1/snapshots']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(503);
      expect(res.json(), url).toEqual({ error: 'catalog_unavailable' });
    }
  });
});
