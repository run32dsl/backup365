import { describe, expect, it, vi } from 'vitest';
import type { AtlasHandle } from './atlas-sdk.js';
import { startAtlas } from './atlas-startup.js';

const SECRET = 'passphrase-of-14+-secret';
const env = {
  BACKUP365_TENANT_ID: 'tenant-test',
  BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
  BACKUP365_S3_ACCESS_KEY_ID: 'id',
  BACKUP365_S3_SECRET_ACCESS_KEY: 'secret',
  BACKUP365_ENCRYPTION_PASSPHRASE: SECRET,
};

const handle = (dispose = vi.fn(() => Promise.resolve())): AtlasHandle => ({
  outlook: {
    listMailboxes: () => Promise.resolve([]),
    listSnapshots: () => Promise.resolve([]),
    getSnapshotDetail: () => Promise.resolve(undefined),
  },
  onedrive: { listSnapshots: () => Promise.resolve([]) },
  dispose,
});

describe('startAtlas', () => {
  it('is unconfigured without any storage variable, and never builds the SDK', () => {
    const factory = vi.fn(() => handle());
    expect(startAtlas({}, factory)).toEqual({ status: 'unconfigured' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('refuses a partial configuration, naming variables but no value', () => {
    const partial = { BACKUP365_TENANT_ID: 'tenant-test', BACKUP365_S3_ACCESS_KEY_ID: 'id' };
    const factory = vi.fn(() => handle());
    expect(() => startAtlas(partial, factory)).toThrow(/BACKUP365_/);
    expect(() => startAtlas(partial, factory)).not.toThrow(/tenant-test/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('exposes a catalog whose dispose releases the SDK instance', async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const result = startAtlas(env, () => handle(dispose));
    if (result.status !== 'ready') throw new Error('expected ready');
    await result.atlas.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('reports only code and name when the SDK rejects the configuration', () => {
    const failing = (): AtlasHandle => {
      throw Object.assign(new Error(`bad passphrase ${SECRET}`), {
        code: 'ATLAS_CONFIG',
        name: 'AtlasConfigError',
      });
    };
    const result = startAtlas(env, failing);
    expect(result).toEqual({ status: 'failed', code: 'ATLAS_CONFIG', name: 'AtlasConfigError' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
