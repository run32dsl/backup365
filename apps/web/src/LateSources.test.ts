import { describe, expect, it } from 'vitest';
import type { StatusReport } from '@backup365/core';
import { lateSourcesNote } from './plans.js';

type Row = StatusReport['rows'][number];

const row = (name: string, state: Row['state'], last: string | null): Row => ({
  sourceId: name,
  displayName: name,
  kind: 'mailbox',
  workload: 'onedrive',
  lastSnapshotAt: last,
  ageHours: null,
  state,
});

const report = (rows: Row[]) => ({
  rows,
  maxAgeHours: 26,
  generatedAt: '2026-11-25T05:00:00.000Z',
});

const ok = (n: number) =>
  Array.from({ length: n }, (_, i) => row(`ok${i}@example.test`, 'ok', '2026-11-25T01:01:00Z'));
const recent = '2026-11-25T01:01:00Z';

describe('lateSourcesNote', () => {
  it('names the only late source and its last success', () => {
    const rows = [...ok(4), row('late@example.test', 'stale', '2026-11-22T02:01:00Z')];
    expect(
      lateSourcesNote({ dataTypes: ['onedrive'], lastSuccessAt: recent }, report(rows)),
    ).toEqual({
      text: '1 compte sur 5 en retard : OneDrive, late@example.test, dernière réussite le 22/11/2026 02:01 UTC',
      seeSources: false,
    });
  });

  it('counts several late sources and asks for the sources page', () => {
    const rows = [
      ...ok(2),
      row('a@example.test', 'stale', '2026-11-20T02:01:00Z'),
      row('b@example.test', 'missing', null),
      row('c@example.test', 'stale', '2026-11-21T02:01:00Z'),
    ];
    expect(
      lateSourcesNote({ dataTypes: ['onedrive'], lastSuccessAt: recent }, report(rows)),
    ).toEqual({ text: '3 comptes sur 5 en retard', seeSources: true });
  });

  it('leaves the plan note to lateNote when its own last success is too old', () => {
    const rows = [...ok(4), row('late@example.test', 'stale', '2026-11-22T02:01:00Z')];
    const old = '2026-11-22T02:01:00Z';
    expect(
      lateSourcesNote({ dataTypes: ['onedrive'], lastSuccessAt: old }, report(rows)),
    ).toBeUndefined();
    expect(
      lateSourcesNote({ dataTypes: ['onedrive'], lastSuccessAt: null }, report(rows)),
    ).toBeUndefined();
  });

  it('counts only the selected sources of a restricted plan, and does not guess without the selection', () => {
    const rows = [
      row('mine@example.test', 'stale', '2026-11-22T02:01:00Z'),
      row('other@example.test', 'stale', '2026-11-21T02:01:00Z'),
      ...ok(1),
    ];
    const plan = {
      dataTypes: ['onedrive'] as const,
      scope: 'selection' as const,
      lastSuccessAt: recent,
    };
    expect(lateSourcesNote({ ...plan, selection: ['mine@example.test'] }, report(rows))?.text).toBe(
      '1 compte sur 1 en retard : OneDrive, mine@example.test, dernière réussite le 22/11/2026 02:01 UTC',
    );
    expect(lateSourcesNote(plan, report(rows))).toBeUndefined();
  });

  it('ignores late sources of services the plan does not cover', () => {
    const rows = [row('late@example.test', 'stale', '2026-11-22T02:01:00Z')];
    expect(
      lateSourcesNote({ dataTypes: ['mail'], lastSuccessAt: recent }, report(rows)),
    ).toBeUndefined();
  });
});
