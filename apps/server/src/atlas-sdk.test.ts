import { describe, expect, it, vi } from 'vitest';
import {
  NO_GRAPH_CLIENT_ID,
  NO_GRAPH_CLIENT_SECRET,
  createAtlasCatalog,
  toAtlasConfig,
  type AtlasHandle,
} from './atlas-sdk.js';
import type { StorageConfig } from './config.js';

const storage: StorageConfig = {
  tenantId: 'tenant-test',
  endpoint: 'https://s3.example.test',
  region: 'r1',
  accessKeyId: 'id',
  secretAccessKey: 'secret',
  encryptionPassphrase: 'passphrase-of-14+',
};

describe('toAtlasConfig', () => {
  it('maps the storage settings and uses explicit placeholder Graph values', () => {
    expect(toAtlasConfig(storage)).toEqual({
      tenantId: 'tenant-test',
      clientId: NO_GRAPH_CLIENT_ID,
      clientSecret: NO_GRAPH_CLIENT_SECRET,
      s3Endpoint: 'https://s3.example.test',
      s3Region: 'r1',
      s3AccessKey: 'id',
      s3SecretKey: 'secret',
      encryptionPassphrase: 'passphrase-of-14+',
    });
    expect(NO_GRAPH_CLIENT_ID).not.toBe('');
    expect(NO_GRAPH_CLIENT_SECRET).not.toBe('');
  });
});

describe('createAtlasCatalog', () => {
  it('reads through the SDK and disposes the instance', async () => {
    const validate = vi.fn();
    const dispose = vi.fn(() => Promise.resolve());
    const factory = vi.fn((): AtlasHandle & { validate: () => void } => ({
      outlook: {
        listMailboxes: () => Promise.resolve([{ ownerId: 'o1', ownerEmail: 'a@example.test' }]),
        listSnapshots: () => Promise.resolve([]),
        getSnapshotDetail: () => Promise.resolve(undefined),
      },
      onedrive: { listSnapshots: () => Promise.resolve([]) },
      validate,
      dispose,
    }));
    const { catalog, dispose: close } = createAtlasCatalog(storage, factory);
    expect(await catalog.listMailboxes()).toEqual([{ id: 'o1', displayName: 'a@example.test' }]);
    await close();
    expect(factory).toHaveBeenCalledOnce();
    expect(validate).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
