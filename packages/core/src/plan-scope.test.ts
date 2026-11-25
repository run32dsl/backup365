import { describe, expect, it } from 'vitest';
import { autoAddedAtLastRun } from './auto-added.js';
import { chargeScope, parseProtectionPlanInput } from './protection-plan.js';
import { buildServiceSummaries } from './status.js';

const base = {
  name: 'Plan',
  rpoHours: 4,
  retentionDays: 30,
  gdprJustification: 'Obligation légale.',
};

describe('périmètre par charge (issue #545)', () => {
  it('defaults: every charge follows the plan scope', () => {
    const all = parseProtectionPlanInput({ ...base, scope: 'all' });
    expect(all.ok && all.plan.selectionTypes).toEqual([]);
    const picked = parseProtectionPlanInput({
      ...base,
      scope: 'selection',
      dataTypes: ['mail', 'sharepoint'],
      selection: ['a'],
    });
    expect(picked.ok && picked.plan.selectionTypes).toEqual(['mail', 'sharepoint']);
  });

  it('accepts a mix, and refuses incoherent limited charges without echoing them', () => {
    const mixed = parseProtectionPlanInput({
      ...base,
      scope: 'selection',
      dataTypes: ['mail', 'onedrive'],
      selection: ['a'],
      selectionTypes: ['onedrive'],
    });
    expect(mixed.ok && mixed.plan.selectionTypes).toEqual(['onedrive']);
    const foreign = parseProtectionPlanInput({
      ...base,
      scope: 'selection',
      dataTypes: ['mail'],
      selection: ['a'],
      selectionTypes: ['<script>'],
    });
    expect(foreign.ok).toBe(false);
    expect(JSON.stringify(foreign)).not.toContain('<script>');
    const allButLimited = parseProtectionPlanInput({
      ...base,
      scope: 'all',
      dataTypes: ['mail'],
      selectionTypes: ['mail'],
    });
    expect(allButLimited.ok).toBe(false);
  });

  it('chargeScope reads the per-charge choice, old plans included', () => {
    const mixed = { scope: 'selection' as const, selectionTypes: ['mail' as const] };
    expect(chargeScope(mixed, 'mail')).toBe('selection');
    expect(chargeScope(mixed, 'onedrive')).toBe('all');
    expect(chargeScope({ scope: 'selection' }, 'onedrive')).toBe('selection');
    expect(chargeScope({ scope: 'all' }, 'mail')).toBe('all');
  });

  it('the Sources service line says « all » for a whole-tenant charge of a mixed plan', () => {
    const plan = {
      id: 'p',
      createdAt: '2026-01-01T00:00:00Z',
      scope: 'selection' as const,
      dataTypes: ['mail' as const, 'onedrive' as const],
      selection: ['a'],
      selectionTypes: ['mail' as const],
      retentionDays: 30,
      rpoHours: 4 as const,
    };
    const services = buildServiceSummaries([], [plan], 26, new Date('2026-02-01T00:00:00Z'));
    const scopeOf = (s: string) => services.find((x) => x.service === s)?.scope;
    expect(scopeOf('mail')).toEqual({ kind: 'selection', count: 1 });
    expect(scopeOf('onedrive')).toEqual({ kind: 'all' });
  });
});

describe('autoAddedAtLastRun', () => {
  const plan = { id: 'p', name: 'Tout le tenant', rpoHours: 4 as const };

  it('lists the items added during the last run only, named from the catalog', () => {
    const runs = [
      // Ajouté à une exécution antérieure (un créneau dure 2 h pour un RPO de 4 h).
      { itemId: 'old', startedAt: '2026-02-28T20:10:00Z', autoAdded: true },
      { itemId: 'a', startedAt: '2026-03-01T02:10:00Z', autoAdded: false },
      { itemId: 'new-user', startedAt: '2026-03-01T02:11:00Z', autoAdded: true },
      { itemId: 'new-site', startedAt: '2026-03-01T02:12:00Z', autoAdded: true },
    ];
    const entries = autoAddedAtLastRun([plan], () => runs, [
      { sourceId: 'new-user', displayName: 'Nouvel arrivant' },
    ]);
    expect(entries).toEqual([
      {
        planId: 'p',
        plan: 'Tout le tenant',
        at: '2026-03-01T02:11:00.000Z',
        items: [
          { id: 'new-user', name: 'Nouvel arrivant' },
          { id: 'new-site', name: null },
        ],
      },
    ]);
  });

  it('says nothing for a plan whose last run added nothing, or that never ran', () => {
    const runs = [
      { itemId: 'x', startedAt: '2026-03-01T00:10:00Z', autoAdded: true },
      { itemId: 'x', startedAt: '2026-03-01T04:10:00Z', autoAdded: false },
    ];
    expect(autoAddedAtLastRun([plan], () => runs, [])).toEqual([]);
    expect(autoAddedAtLastRun([plan], () => [], [])).toEqual([]);
  });
});
