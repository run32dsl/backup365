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

describe('listPlanItems', () => {
  it('lists mailboxes for mail or onedrive, sites for sharepoint', async () => {
    expect(await listPlanItems(all(['mail']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['onedrive']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['sharepoint']), catalog)).toEqual(['s1']);
    expect(await listPlanItems(all(['mail', 'onedrive', 'sharepoint']), catalog)).toEqual([
      'u1',
      'u2',
      's1',
    ]);
  });

  it('returns the selection as is, and nothing without a catalog', async () => {
    const selection = {
      scope: 'selection' as const,
      selection: ['x'],
      dataTypes: ['mail' as const],
    };
    expect(await listPlanItems(selection, catalog)).toEqual(['x']);
    expect(await listPlanItems(all(['mail']), undefined)).toEqual([]);
  });
});
