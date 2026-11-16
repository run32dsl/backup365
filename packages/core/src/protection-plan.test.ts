import { describe, expect, it } from 'vitest';
import {
  buildPlanComplianceReport,
  nextRunAt,
  parseProtectionPlanInput,
  planCompliance,
  runIntervalMinutes,
  staggerOffsetMinutes,
  type PlanRun,
} from './protection-plan.js';

const valid = {
  name: 'Direction',
  scope: 'all',
  rpoHours: 12,
  retentionDays: 365,
  gdprJustification: 'Obligation de conservation des courriers (intérêt légitime).',
};

describe('parseProtectionPlanInput', () => {
  it('accepts a valid plan and defaults the RPO to 24 h', () => {
    const withoutRpo: Record<string, unknown> = { ...valid };
    delete withoutRpo.rpoHours;
    expect(parseProtectionPlanInput(withoutRpo)).toMatchObject({
      ok: true,
      plan: { rpoHours: 24, rtoHours: null, selection: [] },
    });
  });
  it('protects every data type by default and orders a given list', () => {
    expect(parseProtectionPlanInput(valid)).toMatchObject({
      plan: { dataTypes: ['mail', 'files', 'calendar', 'contacts'] },
    });
    expect(
      parseProtectionPlanInput({ ...valid, dataTypes: ['contacts', 'mail', 'mail'] }),
    ).toMatchObject({ ok: true, plan: { dataTypes: ['mail', 'contacts'] } });
  });
  it('refuses an empty or unknown list of data types', () => {
    for (const dataTypes of [[], ['teams'], 'mail', [1], null]) {
      expect(parseProtectionPlanInput({ ...valid, dataTypes }).ok).toBe(false);
    }
  });
  it('refuses a missing, blank or oversized GDPR justification', () => {
    for (const gdprJustification of [undefined, '', '   ', 'x'.repeat(1001), 42]) {
      expect(parseProtectionPlanInput({ ...valid, gdprJustification }).ok).toBe(false);
    }
  });
  it('refuses an RPO outside 4, 12 and 24 hours', () => {
    for (const rpoHours of [1, 6, 8, 48, '24', null, 12.5]) {
      expect(parseProtectionPlanInput({ ...valid, rpoHours }).ok).toBe(false);
    }
  });
  it('requires a selection for the selection scope and none for all', () => {
    expect(parseProtectionPlanInput({ ...valid, scope: 'selection' }).ok).toBe(false);
    expect(parseProtectionPlanInput({ ...valid, scope: 'selection', selection: ['a'] }).ok).toBe(
      true,
    );
    expect(parseProtectionPlanInput({ ...valid, selection: ['a'] }).ok).toBe(false);
  });
  it('validates name, retention, RTO and the shape of the input', () => {
    expect(parseProtectionPlanInput({ ...valid, name: ' ' }).ok).toBe(false);
    expect(parseProtectionPlanInput({ ...valid, retentionDays: 0 }).ok).toBe(false);
    expect(parseProtectionPlanInput({ ...valid, rtoHours: 0 }).ok).toBe(false);
    expect(parseProtectionPlanInput('plan').ok).toBe(false);
    expect(parseProtectionPlanInput(null).ok).toBe(false);
  });
  it('never echoes the received values in its messages', () => {
    const result = parseProtectionPlanInput({ ...valid, name: '', rpoHours: 'secret-xyz' });
    expect(JSON.stringify(result)).not.toContain('secret-xyz');
  });
});

describe('nextRunAt', () => {
  const after = new Date('2026-11-16T10:17:42Z');
  it.each([
    [4, 120],
    [12, 360],
    [24, 720],
  ] as const)('runs at least every RPO/2 for an RPO of %i h (%i min)', (rpo, minutes) => {
    expect(runIntervalMinutes(rpo)).toBe(minutes);
    const first = nextRunAt({ id: 'plan-a', rpoHours: rpo }, after);
    const second = nextRunAt({ id: 'plan-a', rpoHours: rpo }, first);
    expect(first.getTime()).toBeGreaterThan(after.getTime());
    expect(first.getTime() - after.getTime()).toBeLessThanOrEqual(minutes * 60_000);
    expect(second.getTime() - first.getTime()).toBe(minutes * 60_000);
    expect(first.getTime() % 60_000).toBe(0);
  });
  it('is stable from one call to the next', () => {
    const a = nextRunAt({ id: 'plan-a', rpoHours: 4 }, after);
    expect(nextRunAt({ id: 'plan-a', rpoHours: 4 }, after)).toEqual(a);
    expect(staggerOffsetMinutes('plan-a', 4)).toBe(staggerOffsetMinutes('plan-a', 4));
  });
  it('keeps a frozen offset so that slots do not move between versions', () => {
    expect(staggerOffsetMinutes('plan-a', 12)).toBe(244);
  });
  it('is strictly after the given instant, even on a slot or just after it', () => {
    const p = { id: 'plan-a', rpoHours: 4 } as const;
    const slot = nextRunAt(p, new Date('2026-11-16T10:17:42Z'));
    const following = new Date(slot.getTime() + 120 * 60_000);
    expect(nextRunAt(p, slot)).toEqual(following);
    expect(nextRunAt(p, new Date(slot.getTime() + 30_000))).toEqual(following);
  });
  it('spreads plans over the interval', () => {
    const offsets = new Set(
      Array.from({ length: 20 }, (_, i) => staggerOffsetMinutes('plan-' + i, 12)),
    );
    expect(offsets.size).toBeGreaterThan(10);
    for (const o of offsets) expect(o).toBeLessThan(360);
  });
});

describe('planCompliance', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const run = (
    startedAt: string,
    status: PlanRun['status'],
    finishedAt: string | null = startedAt,
  ): PlanRun => ({ startedAt, finishedAt, status });

  it('is compliant when the last success is younger than the RPO', () => {
    expect(planCompliance(4, [run('2026-11-16T08:30:00Z', 'success')], now)).toEqual({
      state: 'compliant',
      lastSuccessAt: '2026-11-16T08:30:00Z',
    });
  });
  it('counts a no_content success and keeps the shape the dashboard shares', () => {
    const empty: PlanRun = {
      ...run('2026-11-16T10:00:00Z', 'success'),
      noSnapshotReason: 'no_content',
    };
    // Forme exacte : un champ obligatoire de plus casserait les autres producteurs de `Compliance`.
    expect(planCompliance(4, [empty], now)).toEqual({
      state: 'compliant',
      lastSuccessAt: '2026-11-16T10:00:00Z',
    });
  });
  it('is late exactly at the RPO', () => {
    expect(planCompliance(4, [run('2026-11-16T08:00:00Z', 'success')], now).state).toBe('late');
  });
  it('is failed when the latest run failed and the last success is too old', () => {
    const runs = [run('2026-11-15T00:00:00Z', 'success'), run('2026-11-16T11:00:00Z', 'failed')];
    expect(planCompliance(4, runs, now).state).toBe('failed');
  });
  it('stays compliant after a failure that follows a recent success', () => {
    const runs = [run('2026-11-16T10:00:00Z', 'success'), run('2026-11-16T11:00:00Z', 'failed')];
    expect(planCompliance(4, runs, now).state).toBe('compliant');
  });
  it('is late while a run is in progress without any recent success', () => {
    expect(planCompliance(4, [run('2026-11-16T11:00:00Z', 'running', null)], now).state).toBe(
      'late',
    );
  });
  it('does not trust a success that ends in the future', () => {
    expect(planCompliance(4, [run('2026-11-16T13:00:00Z', 'success')], now).state).toBe('late');
  });
  it('is late with no run at all', () => {
    expect(planCompliance(24, [], now)).toEqual({ state: 'late', lastSuccessAt: null });
  });
  it('is failed when the only run failed', () => {
    expect(planCompliance(24, [run('2026-11-16T11:00:00Z', 'failed')], now).state).toBe('failed');
  });
});

describe('buildPlanComplianceReport', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const plans = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    name: id.toUpperCase(),
    rpoHours: 4 as const,
  }));
  const runs: Record<string, PlanRun[]> = {
    a: [
      { startedAt: '2026-11-16T11:00:00Z', finishedAt: '2026-11-16T11:05:00Z', status: 'success' },
    ],
    b: [
      { startedAt: '2026-11-15T01:00:00Z', finishedAt: '2026-11-15T01:05:00Z', status: 'success' },
    ],
    c: [
      { startedAt: '2026-11-16T11:00:00Z', finishedAt: '2026-11-16T11:01:00Z', status: 'failed' },
    ],
  };

  it('counts each state and lists late and failed plans', () => {
    const report = buildPlanComplianceReport(plans, (id) => runs[id] ?? [], now);
    expect(report.counts).toEqual({ compliant: 1, late: 2, failed: 1 });
    expect(report.nonCompliant.map((p) => [p.id, p.state])).toEqual([
      ['b', 'late'],
      ['c', 'failed'],
      ['d', 'late'],
    ]);
  });

  it('reports nothing without plans', () => {
    expect(buildPlanComplianceReport([], () => [], now)).toEqual({
      counts: { compliant: 0, late: 0, failed: 0 },
      nonCompliant: [],
    });
  });
});
