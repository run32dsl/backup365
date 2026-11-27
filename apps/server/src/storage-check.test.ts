import { describe, expect, it } from 'vitest';
import { StorageCheck } from './storage-check.js';

describe('StorageCheck (issue #567)', () => {
  it('keeps a result for its lifetime, then probes again', async () => {
    let now = 0;
    let probes = 0;
    const check = new StorageCheck(
      {
        checkStorage: () => {
          probes++;
          return Promise.resolve({ conditionalWrites: { support: 'supported' } });
        },
      },
      { ttlMs: 1_000, now: () => now },
    );
    expect(await check.conditionalWrites()).toBe('supported');
    now = 999;
    expect(await check.conditionalWrites()).toBe('supported');
    expect(probes).toBe(1);
    now = 1_000;
    await check.conditionalWrites();
    expect(probes).toBe(2);
  });

  it('checks a blocked storage again as soon as a failure, to give restores back (#614)', async () => {
    let now = 0;
    let probes = 0;
    const check = new StorageCheck(
      {
        checkStorage: () => {
          probes++;
          return Promise.resolve({ conditionalWrites: { support: 'ignored' } });
        },
      },
      { ttlMs: 10_000, failureTtlMs: 500, now: () => now },
    );
    expect(await check.conditionalWrites()).toBe('ignored');
    now = 499;
    await check.conditionalWrites();
    expect(probes).toBe(1);
    now = 500;
    await check.conditionalWrites();
    expect(probes).toBe(2);
  });

  it('shares one probe between concurrent calls', async () => {
    let probes = 0;
    const check = new StorageCheck({
      checkStorage: () => {
        probes++;
        return Promise.resolve({ conditionalWrites: { support: 'supported' } });
      },
    });
    expect(await Promise.all([check.conditionalWrites(), check.conditionalWrites()])).toEqual([
      'supported',
      'supported',
    ]);
    expect(probes).toBe(1);
  });

  it('gives up on a storage that never answers, and keeps the failure a short while', async () => {
    let now = 0;
    let probes = 0;
    const check = new StorageCheck(
      {
        checkStorage: () => {
          probes++;
          return new Promise(() => undefined);
        },
      },
      { timeoutMs: 20, failureTtlMs: 500, ttlMs: 10_000, now: () => now },
    );
    expect(await check.conditionalWrites()).toBeNull();
    now = 499;
    expect(await check.conditionalWrites()).toBeNull();
    expect(probes).toBe(1);
    now = 500;
    expect(await check.conditionalWrites()).toBeNull();
    expect(probes).toBe(2);
  });
});
