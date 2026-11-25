import { describe, expect, it } from 'vitest';
import { annotateFailures, type PlanRun } from './protection-plan.js';
import { buildServiceSummaries, effectiveState, type StatusRow } from './status.js';

const row = (id: string, workload: StatusRow['workload'] = 'mail'): StatusRow => ({
  kind: 'mailbox',
  sourceId: id,
  displayName: id,
  workload,
  lastSnapshotAt: '2026-11-25T07:36:00.000Z',
  ageHours: 0,
  state: 'ok',
});

const run = (status: PlanRun['status'], at: string): PlanRun => ({
  startedAt: at,
  finishedAt: at,
  status,
});

const failedPlan = {
  id: 'p1',
  name: 'Boîte direction, quotidien',
  dataTypes: ['mail'] as const,
  scope: 'selection' as const,
  selection: ['a@example.test'],
};
const goodPlan = {
  id: 'p2',
  name: 'Messagerie Direction',
  dataTypes: ['mail'] as const,
  scope: 'all' as const,
};
const runs: Record<string, PlanRun[]> = {
  p1: [run('failed', '2026-11-25T07:36:00.000Z')],
  p2: [run('success', '2026-11-25T07:36:00.000Z')],
};

describe('annotateFailures', () => {
  const rows = [row('a@example.test'), row('b@example.test')];

  it('marks a source covered by one failed and one successful plan as failed, naming both', () => {
    const [a, b] = annotateFailures(rows, [failedPlan, goodPlan], (id) => runs[id] ?? []);
    expect(a?.failure).toEqual({
      planId: 'p1',
      plan: 'Boîte direction, quotidien',
      at: '2026-11-25T07:36:00.000Z',
      coveredBy: { plan: 'Messagerie Direction', at: '2026-11-25T07:36:00.000Z' },
    });
    expect(a && effectiveState(a)).toBe('missing');
    expect(b?.failure).toBeUndefined();
    expect(b && effectiveState(b)).toBe('ok');
  });

  it('has no coveredBy when no other plan succeeded, and ignores a running last run', () => {
    const [a] = annotateFailures(rows, [failedPlan], (id) => runs[id] ?? []);
    expect(a?.failure?.coveredBy).toBeUndefined();
    const running: PlanRun = {
      startedAt: '2026-11-25T08:00:00.000Z',
      finishedAt: null,
      status: 'running',
    };
    const [again] = annotateFailures(rows, [failedPlan], () => [running, ...(runs.p1 ?? [])]);
    expect(again?.failure?.plan).toBe('Boîte direction, quotidien');
  });

  it('makes the service failed instead of up to date', () => {
    const annotated = annotateFailures(rows, [failedPlan, goodPlan], (id) => runs[id] ?? []);
    const mail = buildServiceSummaries(
      annotated,
      [
        {
          ...failedPlan,
          dataTypes: ['mail'],
          retentionDays: 30,
          rpoHours: 24,
          createdAt: '2026-11-01T00:00:00Z',
          selection: ['a@example.test'],
        },
      ],
      26,
      new Date('2026-11-25T08:00:00Z'),
    ).find((s) => s.service === 'mail');
    expect(mail?.state).toBe('missing');
  });
});
