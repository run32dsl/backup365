import { afterEach, describe, expect, it } from 'vitest';
import type { StatusRow } from './status.js';
import {
  alignCompliance,
  alignRunEnd,
  buildPlanComplianceReport,
  currentRunSlot,
  failureCauseOf,
  isNightPlan,
  nextRunAt,
  scheduleWindowLabel,
  parseProtectionPlanInput,
  planCompliance,
  runIntervalMinutes,
  staggerOffsetMinutes,
  type PlanRun,
} from './protection-plan.js';

describe('failureCauseOf: SDK 7.2.0 error codes (issue #567)', () => {
  it('turns each new Atlas code into a readable cause, never the code itself', () => {
    expect(failureCauseOf('ATLAS_OWNER_BUSY')).toBe('owner_busy');
    expect(failureCauseOf('ATLAS_ACCESS_REFUSED')).toBe('access_refused');
    expect(failureCauseOf('ATLAS_AUTH_DENIED')).toBe('access_refused');
    expect(failureCauseOf('ATLAS_GRAPH_UNAVAILABLE')).toBe('graph_unavailable');
    expect(failureCauseOf('ATLAS_STORAGE_UNAVAILABLE')).toBe('storage_unavailable');
    expect(failureCauseOf('ATLAS_FORMAT_UNSUPPORTED')).toBe('format_unsupported');
    expect(failureCauseOf('ATLAS_WRITE_REFUSED')).toBe('write_refused');
  });

  it('reads an incomplete Microsoft 365 listing (SDK 7.3.0, issue #609) as Graph unavailable', () => {
    expect(failureCauseOf('ATLAS_LISTING_INCOMPLETE')).toBe('graph_unavailable');
  });

  it('keeps the existing causes and falls back to unknown', () => {
    expect(failureCauseOf('interrupted')).toBe('interrupted');
    expect(failureCauseOf('ATLAS_SNAPSHOT_NOT_NEWEST')).toBe('unknown');
    expect(failureCauseOf('toString')).toBe('unknown');
    expect(failureCauseOf('unknown')).toBe('unknown');
    expect(failureCauseOf(null)).toBe('unknown');
  });
});

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
  it('protects every data type but contacts by default and orders a given list', () => {
    expect(parseProtectionPlanInput(valid)).toMatchObject({
      plan: { dataTypes: ['mail', 'onedrive', 'sharepoint'] },
    });
    expect(
      parseProtectionPlanInput({ ...valid, dataTypes: ['sharepoint', 'mail', 'mail'] }),
    ).toMatchObject({ ok: true, plan: { dataTypes: ['mail', 'sharepoint'] } });
  });
  it('accepts contacts as a data type, after mail (#543)', () => {
    expect(
      parseProtectionPlanInput({ ...valid, dataTypes: ['onedrive', 'contacts', 'mail'] }),
    ).toMatchObject({ ok: true, plan: { dataTypes: ['mail', 'contacts', 'onedrive'] } });
  });
  it('accepts the calendar as a data type, after contacts, never by default (#544)', () => {
    expect(
      parseProtectionPlanInput({ ...valid, dataTypes: ['onedrive', 'calendar', 'contacts'] }),
    ).toMatchObject({ ok: true, plan: { dataTypes: ['contacts', 'calendar', 'onedrive'] } });
    expect(parseProtectionPlanInput(valid)).toMatchObject({
      plan: { dataTypes: ['mail', 'onedrive', 'sharepoint'] },
    });
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

describe('alignment with the listed backups', () => {
  const now = new Date('2026-11-25T01:21:00Z');
  const source = (sourceId: string, lastSnapshotAt: string, state: 'ok' | 'stale'): StatusRow => ({
    kind: 'mailbox',
    sourceId,
    displayName: 'Source',
    workload: 'onedrive',
    lastSnapshotAt,
    ageHours: 0,
    state,
  });
  const rows = [
    source('a', '2026-11-24T21:21:00Z', 'ok'),
    source('b', '2026-11-21T22:21:00Z', 'stale'),
  ];
  const plan = { id: 'p', name: 'P', rpoHours: 24 as const, dataTypes: ['onedrive' as const] };
  const run: PlanRun = {
    startedAt: '2026-11-25T01:20:00Z',
    finishedAt: '2026-11-25T01:21:00Z',
    status: 'success',
  };

  it('is late, dated by the latest listed backup, when a covered source is late', () => {
    const report = buildPlanComplianceReport([plan], () => [run], now, rows);
    expect(report.counts).toEqual({ compliant: 0, late: 1, failed: 0 });
    expect(report.nonCompliant[0]).toMatchObject({
      state: 'late',
      lastSuccessAt: '2026-11-24T21:21:00.000Z',
      lastRun: { finishedAt: '2026-11-24T21:21:00.000Z' },
    });
  });

  it('counts a plan late when a single covered source is late, as the overview does (#495)', () => {
    // La route de l'accueil et le rapport de Sources passent par `alignCompliance`.
    const base = { state: 'compliant' as const, lastSuccessAt: run.finishedAt };
    expect(alignCompliance(base, plan, rows).state).toBe('late');
    expect(alignCompliance(base, plan, rows.slice(0, 1)).state).toBe('compliant');
    expect(buildPlanComplianceReport([plan], () => [run], now, rows).counts.late).toBe(1);
  });

  it('ignores sources the plan does not cover and keeps the plan without a catalogue', () => {
    const selection = { ...plan, scope: 'selection' as const, selection: ['a'] };
    expect(buildPlanComplianceReport([selection], () => [run], now, rows).counts.compliant).toBe(1);
    expect(buildPlanComplianceReport([plan], () => [run], now).counts.compliant).toBe(1);
  });

  it('never moves a failure date or a missing success', () => {
    expect(alignRunEnd({ status: 'failed', finishedAt: run.finishedAt }, plan, rows)).toBe(
      run.finishedAt,
    );
    expect(alignCompliance({ state: 'late', lastSuccessAt: null }, plan, rows)).toEqual({
      state: 'late',
      lastSuccessAt: null,
    });
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

  it('sets apart « à jour » plans whose successes created no restore point', () => {
    const empty: Record<string, PlanRun[]> = {
      a: [
        {
          startedAt: '2026-11-16T11:00:00Z',
          finishedAt: '2026-11-16T11:05:00Z',
          status: 'success',
          noSnapshotReason: 'no_content',
        },
      ],
      b: runs['a']!,
    };
    const report = buildPlanComplianceReport(plans.slice(0, 2), (id) => empty[id] ?? [], now);
    expect(report.counts.compliant).toBe(2);
    expect(report.pending).toBe(1);
  });

  it('carries the data types of each listed plan, and none when the plan gives none', () => {
    const typed = [{ ...plans[3]!, dataTypes: ['onedrive', 'sharepoint'] as const }, plans[2]!];
    const report = buildPlanComplianceReport(typed, (id) => runs[id] ?? [], now);
    expect(report.nonCompliant[0]?.dataTypes).toEqual(['onedrive', 'sharepoint']);
    expect(report.nonCompliant[1]).not.toHaveProperty('dataTypes');
  });

  it('carries the last finished run of each non-compliant plan, null without any', () => {
    const report = buildPlanComplianceReport(plans, (id) => runs[id] ?? [], now);
    const lastRuns = Object.fromEntries(report.nonCompliant.map((p) => [p.id, p.lastRun]));
    expect(lastRuns['c']).toEqual({
      status: 'failed',
      startedAt: '2026-11-16T11:00:00Z',
      finishedAt: '2026-11-16T11:01:00Z',
      noSnapshotReason: null,
    });
    expect(lastRuns['d']).toBeNull();
    // Une exécution en cours n'est pas un résultat : on lit la dernière terminée.
    const running = buildPlanComplianceReport(
      [plans[3]!],
      () => [
        { startedAt: '2026-11-16T11:30:00Z', finishedAt: null, status: 'running' },
        { startedAt: '2026-11-16T10:00:00Z', finishedAt: '2026-11-16T10:01:00Z', status: 'failed' },
      ],
      now,
    );
    expect(running.nonCompliant[0]?.lastRun?.startedAt).toBe('2026-11-16T10:00:00Z');
  });

  it('reports nothing without plans', () => {
    expect(buildPlanComplianceReport([], () => [], now)).toEqual({
      counts: { compliant: 0, late: 0, failed: 0 },
      pending: 0,
      nonCompliant: [],
    });
  });
});

// Le paquet n'embarque pas les types Node : seul `process.env.TZ` sert ici (fuseau du serveur).
declare const process: { env: Record<string, string | undefined> };

describe('night window (ADR 0017)', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const night = (id: string) => ({ id, rpoHours: 24 }) as const;

  /** Créneaux d'un plan de nuit entre deux dates, en suivant `nextRunAt`. */
  function slotsBetween(id: string, from: Date, to: Date): Date[] {
    const out: Date[] = [];
    for (let t = nextRunAt(night(id), from); t < to; t = nextRunAt(night(id), t)) out.push(t);
    return out;
  }

  it.each(['Europe/Paris', 'UTC', 'America/New_York'])(
    'puts every slot of a 24 h plan in 22 h – 6 h and keeps the RPO across DST (%s)',
    (tz) => {
      process.env.TZ = tz;
      for (const id of ['plan-a', 'plan-b', 'p3', 'zzz', 'Mails']) {
        const slots = slotsBetween(
          id,
          new Date('2026-01-01T00:00:00Z'),
          new Date('2027-01-01T00:00:00Z'),
        );
        for (const s of slots) expect(hourOf(s) >= 22 || hourOf(s) < 6).toBe(true);
        for (let i = 1; i < slots.length; i++) {
          const gap = (slots[i]!.getTime() - slots[i - 1]!.getTime()) / 3_600_000;
          expect(gap).toBeLessThanOrEqual(24);
        }
      }
    },
  );

  it('keeps the gap under 24 h on the spring-forward and fall-back nights', () => {
    process.env.TZ = 'Europe/Paris';
    for (const [from, to] of [
      ['2026-03-27T00:00:00Z', '2026-03-31T00:00:00Z'],
      ['2026-10-24T00:00:00Z', '2026-10-28T00:00:00Z'],
    ] as const) {
      const slots = slotsBetween('plan-a', new Date(from), new Date(to));
      const gaps = slots.slice(1).map((s, i) => (s.getTime() - slots[i]!.getTime()) / 3_600_000);
      expect(gaps.length).toBeGreaterThan(4);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(21);
    }
  });

  it('gives currentRunSlot as the last slot at or before the instant', () => {
    process.env.TZ = 'Europe/Paris';
    const p = night('plan-a');
    const slot = nextRunAt(p, new Date('2026-11-16T10:00:00Z'));
    expect(currentRunSlot(p, slot)).toEqual(slot);
    expect(currentRunSlot(p, new Date(slot.getTime() - 1))).not.toEqual(slot);
    expect(currentRunSlot(p, new Date(slot.getTime() + 60_000))).toEqual(slot);
  });

  it('leaves plans under 24 h on their RPO/2 rhythm, whatever the time zone', () => {
    const after = new Date('2026-11-16T10:17:42Z');
    for (const rpo of [4, 12] as const) {
      const p = { id: 'plan-a', rpoHours: rpo };
      process.env.TZ = 'UTC';
      const utc = nextRunAt(p, after);
      process.env.TZ = 'Pacific/Auckland';
      expect(nextRunAt(p, after)).toEqual(utc);
      expect(nextRunAt(p, utc).getTime() - utc.getTime()).toBe(rpo * 30 * 60_000);
      expect(currentRunSlot(p, utc)).toEqual(utc);
      expect(isNightPlan(rpo)).toBe(false);
      expect(scheduleWindowLabel(rpo)).toBeNull();
    }
  });

  it('labels the window on the plan sheet', () => {
    expect(isNightPlan(24)).toBe(true);
    expect(scheduleWindowLabel(24)).toBe('Sauvegarde planifiée la nuit (22 h – 6 h)');
  });
});
