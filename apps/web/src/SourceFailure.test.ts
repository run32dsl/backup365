import { describe, expect, it } from 'vitest';
import type { StatusReport } from '@backup365/core';
import { failureBanner, type PlanItem } from './plans.js';
import { failureNote, lateCause, sortRows } from './StatusView.js';

type Row = StatusReport['rows'][number];

const at = '2026-11-25T07:36:00.000Z';
const failing: Row = {
  kind: 'mailbox',
  sourceId: 'a@example.test',
  displayName: 'a@example.test',
  workload: 'mail',
  lastSnapshotAt: at,
  ageHours: 0,
  state: 'ok',
  failure: {
    planId: 'p1',
    plan: 'Boîte direction, quotidien',
    at,
    coveredBy: { plan: 'Messagerie Direction', at },
  },
};
const fine: Row = { ...failing, sourceId: 'b@example.test', displayName: 'b@example.test' };
delete fine.failure;

const plan = {
  id: 'p1',
  name: 'Boîte direction, quotidien',
  compliance: { state: 'failed', lastSuccessAt: null },
  lastRun: { status: 'failed', startedAt: at, finishedAt: at, failureCause: 'backup_errors' },
} as unknown as PlanItem;

const report = (rows: Row[]) => ({ rows, maxAgeHours: 26, generatedAt: at });

describe('source covered by a failed plan', () => {
  it('names the failed plan, its date and the plan that still covers the source', () => {
    expect(failureNote(failing)).toBe(
      'Plan « Boîte direction, quotidien » : échec le 25/11/2026 07:36 UTC · dernière réussite par « Messagerie Direction » le 25/11/2026 07:36 UTC',
    );
    expect(failureNote(fine)).toBeUndefined();
  });

  it('sorts first and counts as a failure in the service', () => {
    expect(sortRows([fine, failing])[0]).toBe(failing);
    expect(lateCause('mail', [failing, fine])).toBe('1 boîte sur 2 en échec');
  });

  it('says the data stays covered, naming the other plan, instead of unprotected', () => {
    expect(failureBanner(plan, true, report([failing])).consequence).toBe(
      'Ces données restent couvertes par « Messagerie Direction » (dernière réussite 25/11/2026 07:36 UTC).',
    );
    expect(failureBanner(plan, true, report([failing, fine])).consequence).toBe(
      'Ces données restent couvertes par « Messagerie Direction » (dernière réussite 25/11/2026 07:36 UTC).',
    );
  });

  it('keeps the unprotected warning when a source has no other plan', () => {
    const alone: Row = { ...failing, failure: { planId: 'p1', plan: 'x', at } };
    expect(failureBanner(plan, true, report([failing, alone])).consequence).toBe(
      'Ces données ne sont pas encore protégées.',
    );
    expect(failureBanner(plan, true).consequence).toBe('Ces données ne sont pas encore protégées.');
  });
});
