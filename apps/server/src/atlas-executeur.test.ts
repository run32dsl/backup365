import { describe, expect, it, vi } from 'vitest';
import {
  AtlasExecuteur,
  toBackupConfig,
  type AtlasBackupApi,
  type DriveOutcome,
  type MailOutcome,
} from './atlas-executeur.js';
import { errorCode } from './plan-scheduler.js';

const ALL = ['mail', 'onedrive', 'sharepoint'] as const;
const mailOk: MailOutcome = { interrupted: false, summary: { folderErrors: [] } };
const driveOk: DriveOutcome = { interrupted: false, summary: { healthy: true } };

function fakeApi(
  over: Partial<
    Record<'mail' | 'contacts' | 'calendar' | 'drive' | 'site', () => Promise<unknown>>
  > = {},
) {
  const calls: string[] = [];
  const api = {
    outlook: {
      backup: vi.fn((id: string) => {
        calls.push(`mail:${id}`);
        return (over.mail ?? (() => Promise.resolve(mailOk)))() as Promise<MailOutcome>;
      }),
    },
    contacts: {
      backup: vi.fn((id: string) => {
        calls.push(`contacts:${id}`);
        return (over.contacts ?? (() => Promise.resolve(driveOk)))() as Promise<DriveOutcome>;
      }),
    },
    calendar: {
      backup: vi.fn((id: string) => {
        calls.push(`calendar:${id}`);
        return (over.calendar ?? (() => Promise.resolve(driveOk)))() as Promise<DriveOutcome>;
      }),
    },
    onedrive: {
      backup: vi.fn((id: string) => {
        calls.push(`onedrive:${id}`);
        return (over.drive ?? (() => Promise.resolve(driveOk)))() as Promise<DriveOutcome>;
      }),
    },
    sharepoint: {
      backup: vi.fn((id: string) => {
        calls.push(`sharepoint:${id}`);
        return (over.site ?? (() => Promise.resolve([driveOk])))() as Promise<DriveOutcome[]>;
      }),
    },
    dispose: () => Promise.resolve(),
  } satisfies AtlasBackupApi;
  const executeur = new AtlasExecuteur({ api, isSite: (id) => Promise.resolve(id === 'site-1') });
  return { api, calls, executeur };
}

const driveEmpty: DriveOutcome = {
  interrupted: false,
  summary: { healthy: true, noSnapshotReason: 'no_content' },
};

describe('AtlasExecuteur', () => {
  it('reports no_content for an empty SharePoint site, and only then', async () => {
    const empty = fakeApi({ site: () => Promise.resolve([driveEmpty, driveEmpty]) });
    await expect(
      empty.executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL }),
    ).resolves.toEqual({
      noSnapshotReason: 'no_content',
    });
    const mixed = fakeApi({ site: () => Promise.resolve([driveEmpty, driveOk]) });
    await expect(
      mixed.executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL }),
    ).resolves.toEqual({});
  });

  it('does not report no_content for an owner whose mailbox was backed up', async () => {
    const { executeur } = fakeApi({ drive: () => Promise.resolve(driveEmpty) });
    await expect(
      executeur.execute({ planId: 'p', itemId: 'owner-1', dataTypes: ALL }),
    ).resolves.toEqual({});
  });

  it('adds up the copied items and the source size the SDK reports', async () => {
    const owner = fakeApi({
      mail: () =>
        Promise.resolve({
          ...mailOk,
          summary: { folderErrors: [], stored: 40 },
          manifest: { totalSizeBytes: 1000 },
        }),
      drive: () =>
        Promise.resolve({
          ...driveOk,
          summary: { healthy: true, filesStored: 2 },
          snapshot: { totalSizeBytes: 500 },
        }),
    });
    await expect(
      owner.executeur.execute({ planId: 'p', itemId: 'owner-1', dataTypes: ALL }),
    ).resolves.toEqual({ itemsSaved: 42, sourceBytes: 1500 });
    const site = fakeApi({
      site: () => Promise.resolve([{ ...driveOk, summary: { healthy: true, filesStored: 3 } }]),
    });
    await expect(
      site.executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL }),
    ).resolves.toEqual({ itemsSaved: 3 });
  });

  it('backs up mail then OneDrive for an owner, without forcing a full backup', async () => {
    const { calls, executeur, api } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'owner-1', dataTypes: ALL });
    expect(calls).toEqual(['mail:owner-1', 'onedrive:owner-1']);
    // Un seul argument : le SDK décide seul entre complète et incrémentale.
    expect(api.outlook.backup.mock.calls[0]).toEqual(['owner-1']);
  });

  it('backs up a known SharePoint site with sharepoint.backup only', async () => {
    const { calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL });
    expect(calls).toEqual(['sharepoint:site-1']);
  });

  it('fails the run without calling the SDK when the catalog lookup throws', async () => {
    const { api } = fakeApi();
    const executeur = new AtlasExecuteur({
      api,
      isSite: () => Promise.reject(new Error('catalog unavailable')),
    });
    const err = await executeur
      .execute({ planId: 'p', itemId: 'x', dataTypes: ALL })
      .catch((e: unknown) => e);
    expect(errorCode(err)).toBe('Error');
    expect(api.outlook.backup).not.toHaveBeenCalled();
    expect(api.sharepoint.backup).not.toHaveBeenCalled();
  });

  it('fails a SharePoint run that returns no result instead of recording a success', async () => {
    const { calls, executeur } = fakeApi({ site: () => Promise.resolve([]) });
    const err = await executeur
      .execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL })
      .catch((e: unknown) => e);
    expect(calls).toEqual(['sharepoint:site-1']);
    expect(errorCode(err)).toBe('no_result');
  });

  it('still tries OneDrive when mail fails, then rejects with the first error code', async () => {
    const { calls, executeur } = fakeApi({
      mail: () =>
        Promise.reject(Object.assign(new Error('token abc-secret'), { code: 'ATLAS_AUTH_DENIED' })),
    });
    const err = await executeur
      .execute({ planId: 'p', itemId: 'o', dataTypes: ALL })
      .catch((e: unknown) => e);
    expect(calls).toEqual(['mail:o', 'onedrive:o']);
    expect(errorCode(err)).toBe('ATLAS_AUTH_DENIED');
  });

  it('fails an interrupted run and a run with folder or drive errors', async () => {
    const interrupted = fakeApi({ mail: () => Promise.resolve({ ...mailOk, interrupted: true }) });
    await expect(
      interrupted.executeur.execute({ planId: 'p', itemId: 'o', dataTypes: ALL }),
    ).rejects.toMatchObject({
      code: 'interrupted',
    });
    const folders = fakeApi({
      mail: () => Promise.resolve({ interrupted: false, summary: { folderErrors: ['x'] } }),
    });
    await expect(
      folders.executeur.execute({ planId: 'p', itemId: 'o', dataTypes: ALL }),
    ).rejects.toMatchObject({
      code: 'backup_errors',
    });
    const site = fakeApi({
      site: () => Promise.resolve([driveOk, { interrupted: false, summary: { healthy: false } }]),
    });
    await expect(
      site.executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL }),
    ).rejects.toMatchObject({
      code: 'backup_errors',
    });
  });
});

describe('AtlasExecuteur, protected data types (#310)', () => {
  it('does not back up the mailbox when the plan lacks mail', async () => {
    const { api, calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['onedrive', 'sharepoint'] });
    expect(api.outlook.backup).not.toHaveBeenCalled();
    expect(calls).toEqual(['onedrive:u1']);
  });

  it('does not back up OneDrive when the plan lacks onedrive', async () => {
    const { api, calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['mail', 'sharepoint'] });
    expect(api.onedrive.backup).not.toHaveBeenCalled();
    expect(calls).toEqual(['mail:u1']);
  });

  it('does not back up a site when the plan lacks sharepoint', async () => {
    const { api, executeur } = fakeApi();
    const result = await executeur.execute({
      planId: 'p',
      itemId: 'site-1',
      dataTypes: ['mail', 'onedrive'],
    });
    expect(api.sharepoint.backup).not.toHaveBeenCalled();
    expect(result).toEqual({ noSnapshotReason: 'no_content' });
  });

  it('backs up a site when the plan has sharepoint', async () => {
    const { calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ['sharepoint'] });
    expect(calls).toEqual(['sharepoint:site-1']);
  });
});

describe('AtlasExecuteur, contacts (#543)', () => {
  it('backs up the contacts of a mailbox when the plan includes them', async () => {
    const { api, calls, executeur } = fakeApi({
      contacts: () => Promise.resolve({ ...driveOk, snapshot: { totalSizeBytes: 300 } }),
    });
    const result = await executeur.execute({
      planId: 'p',
      itemId: 'u1',
      dataTypes: ['mail', 'contacts', 'onedrive'],
    });
    expect(calls).toEqual(['mail:u1', 'contacts:u1', 'onedrive:u1']);
    // Un seul argument : boîte d'origine, le SDK choisit seul complète ou incrémentale.
    expect(api.contacts.backup.mock.calls[0]).toEqual(['u1']);
    expect(result).toEqual({ sourceBytes: 300 });
  });

  it('does not back up contacts when the plan lacks them, nor for a site', async () => {
    const owner = fakeApi();
    await owner.executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ALL });
    expect(owner.api.contacts.backup).not.toHaveBeenCalled();
    const site = fakeApi();
    await site.executeur.execute({
      planId: 'p',
      itemId: 'site-1',
      dataTypes: ['contacts', 'sharepoint'],
    });
    expect(site.calls).toEqual(['sharepoint:site-1']);
  });

  it('fails the run when the contacts backup has errors, after trying the other charges', async () => {
    const { calls, executeur } = fakeApi({
      contacts: () => Promise.resolve({ interrupted: false, summary: { healthy: false } }),
    });
    await expect(
      executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['contacts', 'onedrive'] }),
    ).rejects.toMatchObject({ code: 'backup_errors' });
    expect(calls).toEqual(['contacts:u1', 'onedrive:u1']);
  });

  it('reports no_content when a contacts-only plan finds an empty address book', async () => {
    const { executeur } = fakeApi({ contacts: () => Promise.resolve(driveEmpty) });
    await expect(
      executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['contacts'] }),
    ).resolves.toEqual({ noSnapshotReason: 'no_content' });
  });
});

describe('AtlasExecuteur, calendar (#544)', () => {
  it('backs up the calendar of a mailbox after contacts and before OneDrive', async () => {
    const { api, calls, executeur } = fakeApi({
      calendar: () => Promise.resolve({ ...driveOk, snapshot: { totalSizeBytes: 700 } }),
    });
    const result = await executeur.execute({
      planId: 'p',
      itemId: 'u1',
      dataTypes: ['mail', 'contacts', 'calendar', 'onedrive'],
    });
    expect(calls).toEqual(['mail:u1', 'contacts:u1', 'calendar:u1', 'onedrive:u1']);
    // Un seul argument : boîte d'origine, le SDK choisit seul complète ou incrémentale.
    expect(api.calendar.backup.mock.calls[0]).toEqual(['u1']);
    expect(result).toEqual({ sourceBytes: 700 });
  });

  it('does not back up the calendar when the plan lacks it, nor for a site', async () => {
    const owner = fakeApi();
    await owner.executeur.execute({
      planId: 'p',
      itemId: 'u1',
      dataTypes: ['mail', 'contacts', 'onedrive'],
    });
    expect(owner.api.calendar.backup).not.toHaveBeenCalled();
    const site = fakeApi();
    await site.executeur.execute({
      planId: 'p',
      itemId: 'site-1',
      dataTypes: ['calendar', 'sharepoint'],
    });
    expect(site.calls).toEqual(['sharepoint:site-1']);
  });

  it('fails the run when the calendar backup has errors, after trying the other charges', async () => {
    const { calls, executeur } = fakeApi({
      calendar: () => Promise.resolve({ interrupted: false, summary: { healthy: false } }),
    });
    await expect(
      executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['calendar', 'onedrive'] }),
    ).rejects.toMatchObject({ code: 'backup_errors' });
    expect(calls).toEqual(['calendar:u1', 'onedrive:u1']);
  });

  it('reports no_content when a calendar-only plan finds no event', async () => {
    const { executeur } = fakeApi({ calendar: () => Promise.resolve(driveEmpty) });
    await expect(
      executeur.execute({ planId: 'p', itemId: 'u1', dataTypes: ['calendar'] }),
    ).resolves.toEqual({ noSnapshotReason: 'no_content' });
  });
});

describe('AtlasExecuteur, backup result (#439)', () => {
  const snap = { snapshot: {} };
  async function resultOf(api: ReturnType<typeof fakeApi>, itemId: string) {
    const records: unknown[] = [];
    const report = (r: unknown) => void records.push(r);
    await api.executeur.execute({ planId: 'p', itemId, dataTypes: ALL, report }).catch(() => 0);
    return records;
  }

  it('counts folder errors and warnings, without keeping any name or message', async () => {
    const api = fakeApi({
      mail: () =>
        Promise.resolve({
          ...mailOk,
          summary: { folderErrors: ['Boîte/Projet'], warnings: ['w'] },
        }),
      drive: () =>
        Promise.resolve({ ...driveOk, ...snap, summary: { healthy: true, warnings: ['a', 'b'] } }),
    });
    const records = await resultOf(api, 'o');
    expect(records).toEqual([{ result: 'warnings', folderErrorCount: 1, warningCount: 3 }]);
    expect(JSON.stringify(records)).not.toContain('Projet');
  });

  it('« Réussie » when every backup produced a snapshot without error', async () => {
    const api = fakeApi({ drive: () => Promise.resolve({ ...driveOk, ...snap }) });
    expect(await resultOf(api, 'o')).toEqual([
      { result: 'success', folderErrorCount: 0, warningCount: 0 },
    ]);
  });

  it('« En échec » when backup() throws, returns no result or no snapshot', async () => {
    const thrown = fakeApi({ mail: () => Promise.reject(new Error('x')) });
    const none = fakeApi({ site: () => Promise.resolve([]) });
    const cancelled = fakeApi({
      mail: () => Promise.resolve({ ...mailOk, snapshotStored: false }),
      drive: () => Promise.resolve({ ...driveOk, ...snap }),
    });
    const interrupted = fakeApi({
      mail: () => Promise.resolve({ ...mailOk, interrupted: true }),
      drive: () => Promise.resolve({ ...driveOk, ...snap }),
    });
    const unhealthy = fakeApi({
      site: () =>
        Promise.resolve([{ interrupted: false, summary: { healthy: false, errors: ['e'] } }]),
    });
    const siteThrown = fakeApi({ site: () => Promise.reject(new Error('x')) });
    for (const [api, item] of [
      [thrown, 'o'],
      [none, 'site-1'],
      [cancelled, 'o'],
      [interrupted, 'o'],
      [unhealthy, 'site-1'],
      [siteThrown, 'site-1'],
    ] as const) {
      expect(await resultOf(api, item)).toMatchObject([{ result: 'failed' }]);
    }
  });

  it('keeps the counts of the backups that returned when another one throws', async () => {
    const api = fakeApi({
      mail: () => Promise.reject(new Error('x')),
      drive: () =>
        Promise.resolve({ ...driveOk, ...snap, summary: { healthy: true, warnings: ['w'] } }),
    });
    expect(await resultOf(api, 'o')).toEqual([
      { result: 'failed', folderErrorCount: 0, warningCount: 1 },
    ]);
  });

  it('a clean run without changes keeps the previous snapshot: not a failure', async () => {
    const api = fakeApi({
      drive: () =>
        Promise.resolve({ ...driveOk, summary: { healthy: true, noSnapshotReason: 'no_changes' } }),
    });
    expect(await resultOf(api, 'o')).toEqual([
      { result: 'success', folderErrorCount: 0, warningCount: 0 },
    ]);
  });
});

describe('toBackupConfig', () => {
  it('carries the Microsoft 365 credentials and the storage settings', () => {
    const config = toBackupConfig(
      {
        tenantId: 't',
        endpoint: 'https://s3.example.test',
        region: 'r',
        accessKeyId: 'a',
        secretAccessKey: 's',
        encryptionPassphrase: 'p',
      },
      { clientId: 'cid', clientSecret: 'csecret' },
    );
    expect(config).toMatchObject({ tenantId: 't', clientId: 'cid', clientSecret: 'csecret' });
  });
});
