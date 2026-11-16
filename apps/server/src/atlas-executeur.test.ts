import { describe, expect, it, vi } from 'vitest';
import {
  AtlasExecuteur,
  toBackupConfig,
  type AtlasBackupApi,
  type DriveOutcome,
  type MailOutcome,
} from './atlas-executeur.js';
import { errorCode } from './plan-scheduler.js';

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

describe('AtlasExecuteur', () => {
  it('backs up mail then OneDrive for an owner, without forcing a full backup', async () => {
    const { calls, executeur, api } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'owner-1' });
    expect(calls).toEqual(['mail:owner-1', 'onedrive:owner-1']);
    // Un seul argument : le SDK décide seul entre complète et incrémentale.
    expect(api.outlook.backup.mock.calls[0]).toEqual(['owner-1']);
  });

  it('backs up a known SharePoint site with sharepoint.backup only', async () => {
    const { calls, executeur } = fakeApi();
    await executeur.execute({ planId: 'p', itemId: 'site-1' });
    expect(calls).toEqual(['sharepoint:site-1']);
  });

  it('fails the run without calling the SDK when the catalog lookup throws', async () => {
    const { api } = fakeApi();
    const executeur = new AtlasExecuteur({
      api,
      isSite: () => Promise.reject(new Error('catalog unavailable')),
    });
    const err = await executeur.execute({ planId: 'p', itemId: 'x' }).catch((e: unknown) => e);
    expect(errorCode(err)).toBe('Error');
    expect(api.outlook.backup).not.toHaveBeenCalled();
    expect(api.sharepoint.backup).not.toHaveBeenCalled();
  });

  it('fails a SharePoint run that returns no result instead of recording a success', async () => {
    const { calls, executeur } = fakeApi({ site: () => Promise.resolve([]) });
    const err = await executeur.execute({ planId: 'p', itemId: 'site-1' }).catch((e: unknown) => e);
    expect(calls).toEqual(['sharepoint:site-1']);
    expect(errorCode(err)).toBe('no_result');
  });

  it('still tries OneDrive when mail fails, then rejects with the first error code', async () => {
    const { calls, executeur } = fakeApi({
      mail: () =>
        Promise.reject(Object.assign(new Error('token abc-secret'), { code: 'ATLAS_AUTH_DENIED' })),
    });
    const err = await executeur.execute({ planId: 'p', itemId: 'o' }).catch((e: unknown) => e);
    expect(calls).toEqual(['mail:o', 'onedrive:o']);
    expect(errorCode(err)).toBe('ATLAS_AUTH_DENIED');
  });

  it('fails an interrupted run and a run with folder or drive errors', async () => {
    const interrupted = fakeApi({ mail: () => Promise.resolve({ ...mailOk, interrupted: true }) });
    await expect(interrupted.executeur.execute({ planId: 'p', itemId: 'o' })).rejects.toMatchObject(
      {
        code: 'interrupted',
      },
    );
    const folders = fakeApi({
      mail: () => Promise.resolve({ interrupted: false, summary: { folderErrors: ['x'] } }),
    });
    await expect(folders.executeur.execute({ planId: 'p', itemId: 'o' })).rejects.toMatchObject({
      code: 'backup_errors',
    });
    const site = fakeApi({
      site: () => Promise.resolve([driveOk, { interrupted: false, summary: { healthy: false } }]),
    });
    await expect(site.executeur.execute({ planId: 'p', itemId: 'site-1' })).rejects.toMatchObject({
      code: 'backup_errors',
    });
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
