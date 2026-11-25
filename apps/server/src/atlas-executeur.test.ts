import { describe, expect, it, vi } from 'vitest';
import {
  AtlasExecuteur,
  tenantDirectory,
  toBackupConfig,
  type AtlasBackupApi,
  type DriveOutcome,
  type MailOutcome,
} from './atlas-executeur.js';
import { errorCode } from './plan-scheduler.js';

const ALL = ['mail', 'onedrive', 'sharepoint'] as const;
const mailOk: MailOutcome = { interrupted: false, summary: { folderErrors: [] } };
const driveOk: DriveOutcome = { interrupted: false, summary: { healthy: true } };

function fakeApi(over: Partial<Record<'mail' | 'drive' | 'site', () => Promise<unknown>>> = {}) {
  const calls: string[] = [];
  const api = {
    outlook: {
      backup: vi.fn((id: string) => {
        calls.push(`mail:${id}`);
        return (over.mail ?? (() => Promise.resolve(mailOk)))() as Promise<MailOutcome>;
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

  it('trusts the kind given by the tenant directory for a site never backed up', async () => {
    const { calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'new-site', dataTypes: ALL, kind: 'site' });
    await executeur.execute({ planId: 'p', itemId: 'site-1', dataTypes: ALL, kind: 'owner' });
    expect(calls).toEqual(['sharepoint:new-site', 'mail:site-1', 'onedrive:site-1']);
  });

  it('lists the tenant like the SDK tenant backup: licensed or shared mailboxes, real sites', async () => {
    const { api } = fakeApi();
    const directory = tenantDirectory({
      ...api,
      outlook: {
        ...api.outlook,
        listAvailableMailboxes: () =>
          Promise.resolve([
            { userId: 'licensed', hasExchangeLicense: true },
            { userId: 'shared', hasExchangeLicense: false, mailboxPurpose: 'shared' },
            { userId: 'unlicensed', hasExchangeLicense: false, mailboxPurpose: 'user' },
          ]),
      },
      sharepoint: {
        ...api.sharepoint,
        listSites: () =>
          Promise.resolve([
            { siteId: 'team', kind: 'site' },
            { siteId: 'container', kind: 'file_storage_container' },
          ]),
      },
    });
    expect(await directory?.listOwners()).toEqual([
      { id: 'licensed' },
      { id: 'shared', mailOnly: true },
    ]);
    expect(await directory?.listSites()).toEqual([{ id: 'team' }]);
    expect(tenantDirectory(api)).toBeUndefined();
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
