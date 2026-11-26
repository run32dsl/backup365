import type { DataType } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { listPlanItems, teamOfItem } from './plan-items.js';

const catalog = {
  listMailboxes: () => Promise.resolve([{ id: 'u1' }, { id: 'u2' }]),
  listSites: () => Promise.resolve([{ id: 's1' }]),
};
const all = (dataTypes: DataType[]) => ({
  scope: 'all' as const,
  selection: [],
  dataTypes,
});

describe('listPlanItems', () => {
  it('lists mailboxes for mail, contacts, calendar or onedrive, sites for sharepoint', async () => {
    expect(await listPlanItems(all(['mail']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['contacts']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['calendar']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['onedrive']), catalog)).toEqual(['u1', 'u2']);
    expect(await listPlanItems(all(['sharepoint']), catalog)).toEqual(['s1']);
    expect(await listPlanItems(all(['mail', 'onedrive', 'sharepoint']), catalog)).toEqual([
      'u1',
      'u2',
      's1',
    ]);
  });

  it('adds every team, prefixed, for Teams whatever the scope (#34)', async () => {
    const withTeams = { ...catalog, listTeams: () => Promise.resolve([{ id: 't1' }]) };
    expect(await listPlanItems(all(['teams']), withTeams)).toEqual(['teams:t1']);
    expect(await listPlanItems(all(['mail', 'teams']), withTeams)).toEqual([
      'u1',
      'u2',
      'teams:t1',
    ]);
    const picked = {
      scope: 'selection' as const,
      selection: ['x'],
      dataTypes: ['mail', 'teams'] as DataType[],
    };
    expect(await listPlanItems(picked, withTeams)).toEqual(['x', 'teams:t1']);
    expect(teamOfItem('teams:t1')).toBe('t1');
    expect(teamOfItem('u1')).toBeUndefined();
    // Sans liste d'équipes, Teams n'ajoute rien.
    expect(await listPlanItems(all(['teams']), catalog)).toEqual([]);
  });

  it('still lists mailboxes when the teams cannot be listed, with a failing marker (#34)', async () => {
    const refused = { ...catalog, listTeams: () => Promise.reject(new Error('403')) };
    expect(await listPlanItems(all(['mail', 'teams']), refused)).toEqual(['u1', 'u2', 'teams:']);
    expect(teamOfItem('teams:')).toBe('');
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
