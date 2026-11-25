import { describe, expect, it } from 'vitest';
import { listPlanItems } from './plan-items.js';

const catalog = {
  listMailboxes: () => Promise.resolve([{ id: 'u1' }, { id: 'u2' }]),
  listSites: () => Promise.resolve([{ id: 's1' }]),
};
const all = (dataTypes: ('mail' | 'onedrive' | 'sharepoint')[]) => ({
  scope: 'all' as const,
  selection: [],
  dataTypes,
});
const ids = async (p: Promise<{ itemId: string }[]>) => (await p).map((t) => t.itemId);

describe('listPlanItems', () => {
  it('lists mailboxes for mail or onedrive, sites for sharepoint', async () => {
    expect(await ids(listPlanItems(all(['mail']), { catalog }))).toEqual(['u1', 'u2']);
    expect(await ids(listPlanItems(all(['onedrive']), { catalog }))).toEqual(['u1', 'u2']);
    expect(await ids(listPlanItems(all(['sharepoint']), { catalog }))).toEqual(['s1']);
    expect(await listPlanItems(all(['mail', 'onedrive', 'sharepoint']), { catalog })).toEqual([
      { itemId: 'u1', dataTypes: ['mail', 'onedrive'], kind: 'owner', discovered: true },
      { itemId: 'u2', dataTypes: ['mail', 'onedrive'], kind: 'owner', discovered: true },
      { itemId: 's1', dataTypes: ['sharepoint'], kind: 'site', discovered: true },
    ]);
  });

  it('returns the selection as is, and nothing without a catalog', async () => {
    const selection = {
      scope: 'selection' as const,
      selection: ['x'],
      dataTypes: ['mail' as const],
    };
    expect(await listPlanItems(selection, { catalog })).toEqual([
      { itemId: 'x', dataTypes: ['mail'], discovered: false },
    ]);
    expect(await listPlanItems(all(['mail']))).toEqual([]);
  });

  it('takes whole-tenant charges from the directory, accounts never backed up included', async () => {
    const directory = {
      listOwners: () => Promise.resolve([{ id: 'u1' }, { id: 'new-user' }]),
      listSites: () => Promise.resolve([{ id: 'new-site' }]),
    };
    const items = await ids(listPlanItems(all(['mail', 'sharepoint']), { catalog, directory }));
    expect(items).toEqual(['u1', 'new-user', 'new-site']);
  });

  it('mixes per charge: mail on the selection, OneDrive on the whole tenant', async () => {
    const plan = {
      scope: 'selection' as const,
      selection: ['u1'],
      dataTypes: ['mail' as const, 'onedrive' as const],
      selectionTypes: ['mail' as const],
    };
    expect(await listPlanItems(plan, { catalog })).toEqual([
      { itemId: 'u1', dataTypes: ['mail', 'onedrive'], kind: 'owner', discovered: false },
      { itemId: 'u2', dataTypes: ['onedrive'], kind: 'owner', discovered: true },
    ]);
  });

  it('falls back on the catalog when the directory fails, and reports only the code', async () => {
    const codes: string[] = [];
    const failing = Object.assign(new Error('secret detail'), { code: 'ATLAS_GRAPH_UNAVAILABLE' });
    const directory = {
      listOwners: () => Promise.reject(failing),
      listSites: () => Promise.reject(failing),
    };
    const items = await ids(
      listPlanItems(all(['mail']), { catalog, directory, onDirectoryError: (c) => codes.push(c) }),
    );
    expect(items).toEqual(['u1', 'u2']);
    expect(codes).toEqual(['ATLAS_GRAPH_UNAVAILABLE']);
    const degraded = await listPlanItems(all(['mail']), { catalog, directory });
    expect(degraded.degraded).toBe(true);
    expect((await listPlanItems(all(['mail']), { catalog })).degraded).toBeUndefined();
  });

  it('backs up only the mail of a shared mailbox, never its missing OneDrive', async () => {
    const directory = {
      listOwners: () => Promise.resolve([{ id: 'user' }, { id: 'shared', mailOnly: true }]),
      listSites: () => Promise.resolve([]),
    };
    expect(await listPlanItems(all(['mail', 'onedrive']), { directory })).toEqual([
      { itemId: 'user', dataTypes: ['mail', 'onedrive'], kind: 'owner', discovered: true },
      { itemId: 'shared', dataTypes: ['mail'], kind: 'owner', discovered: true },
    ]);
    expect(await listPlanItems(all(['onedrive']), { directory })).toHaveLength(1);
  });
});
