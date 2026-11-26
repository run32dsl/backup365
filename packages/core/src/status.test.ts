import { describe, expect, it } from 'vitest';
import type { BackupCatalog } from './catalog.js';
import { FakeBackupCatalog } from './fake-catalog.js';
import { nextRunAt } from './protection-plan.js';
import {
  backupState,
  buildServiceSummaries,
  buildStatusReport,
  lateBackups,
  serviceOfRow,
  type StatusRow,
} from './status.js';

const now = new Date('2026-11-12T12:00:00Z');

describe('lateBackups', () => {
  const row = (over: Partial<StatusRow>): StatusRow => ({
    kind: 'mailbox',
    sourceId: 'a',
    displayName: 'Boîte A',
    workload: 'mail',
    lastSnapshotAt: '2026-11-01T00:00:00Z',
    ageHours: 276,
    state: 'stale',
    ...over,
  });

  it('keeps only stale rows and maps them to a service', () => {
    const late = lateBackups([
      row({}),
      row({ workload: 'onedrive', displayName: 'Compte' }),
      row({ kind: 'site', workload: 'sharepoint', displayName: 'Site' }),
      row({ state: 'ok' }),
      row({ state: 'missing', lastSnapshotAt: null, ageHours: null }),
    ]);
    expect(late.map((l) => [l.service, l.name])).toEqual([
      ['mail', 'Boîte A'],
      ['onedrive', 'Compte'],
      ['sharepoint', 'Site'],
    ]);
  });
});

describe('backupState', () => {
  it('is ok under the threshold and at the threshold', () => {
    expect(backupState('2026-11-12T00:00:00Z', now, 26)).toEqual({ state: 'ok', ageHours: 12 });
    expect(backupState('2026-11-11T10:00:00Z', now, 26)).toEqual({ state: 'ok', ageHours: 26 });
  });
  it('is stale just past the threshold', () => {
    expect(backupState('2026-11-11T09:59:59Z', now, 26).state).toBe('stale');
  });
  it('is missing without snapshot or with an unreadable date', () => {
    expect(backupState(null, now, 26)).toEqual({ state: 'missing', ageHours: null });
    expect(backupState('pas une date', now, 26).state).toBe('missing');
  });
  it('treats a future snapshot as age zero', () => {
    expect(backupState('2026-11-12T13:00:00Z', now, 26)).toEqual({ state: 'ok', ageHours: 0 });
  });
  it('follows a custom threshold', () => {
    expect(backupState('2026-11-12T00:00:00Z', now, 6).state).toBe('stale');
  });
});

describe('buildStatusReport', () => {
  const catalog = new FakeBackupCatalog({
    mailboxes: [
      { id: 'a', displayName: 'Boîte A' },
      { id: 'b', displayName: 'Boîte B' },
    ],
    snapshots: {
      a: [
        { id: 's1', workload: 'mail', createdAt: '2026-11-12T06:00:00Z' },
        { id: 's2', workload: 'mail', createdAt: '2026-11-10T06:00:00Z' },
        { id: 's3', workload: 'onedrive', createdAt: '2026-11-09T06:00:00Z' },
      ],
      b: [{ id: 's4', workload: 'mail', createdAt: '2026-11-12T08:00:00Z' }],
    },
  });

  it('reports one row per mailbox and workload, with the latest snapshot', async () => {
    const report = await buildStatusReport(catalog, ['mail', 'onedrive'], 26, now);
    expect(report.rows.map((r) => [r.sourceId, r.workload, r.state, r.ageHours])).toEqual([
      ['a', 'mail', 'ok', 6],
      ['a', 'onedrive', 'stale', 78],
      ['b', 'mail', 'ok', 4],
      ['b', 'onedrive', 'missing', null],
    ]);
  });

  it('counts stale and missing rows as alerts', async () => {
    const report = await buildStatusReport(catalog, ['mail', 'onedrive'], 26, now);
    expect(report.alertCount).toBe(2);
    expect(report.maxAgeHours).toBe(26);
    expect(report.generatedAt).toBe('2026-11-12T12:00:00.000Z');
  });

  it('reports one row per backed-up team, never one per mailbox (#34)', async () => {
    const withTeams = new FakeBackupCatalog({
      mailboxes: [{ id: 'a', displayName: 'Boîte A' }],
      teams: [{ id: 't1', displayName: 'Équipe Voirie' }],
      snapshots: { t1: [{ id: 'tm1', workload: 'teams', createdAt: '2026-11-12T02:00:00Z' }] },
    });
    const report = await buildStatusReport(withTeams, ['teams'], 26, now);
    expect(report.rows.map((r) => [r.kind, r.sourceId, r.workload, r.state])).toEqual([
      ['team', 't1', 'teams', 'ok'],
    ]);
    expect(serviceOfRow(report.rows[0]!)).toBe('teams');
  });

  it('picks the latest snapshot whatever the order and ignores unreadable dates', async () => {
    const messy = {
      listMailboxes: () => Promise.resolve([{ id: 'a', displayName: 'A' }]),
      listSnapshots: () =>
        Promise.resolve([
          { id: '1', workload: 'mail', createdAt: '2026-11-01T00:00:00Z' },
          { id: '2', workload: 'mail', createdAt: 'illisible' },
          { id: '3', workload: 'mail', createdAt: '2026-11-12T06:00:00Z' },
        ]),
      getSnapshotDetail: () => Promise.resolve(null),
      listSites: () => Promise.resolve([]),
      listSiteSnapshots: () => Promise.resolve([]),
    } as unknown as BackupCatalog;
    const report = await buildStatusReport(messy, ['mail'], 26, now);
    expect(report.rows[0]).toMatchObject({ lastSnapshotAt: '2026-11-12T06:00:00Z', state: 'ok' });
  });

  it('has no alert and no row without mailbox', async () => {
    const empty = new FakeBackupCatalog({ mailboxes: [], snapshots: {} });
    await expect(buildStatusReport(empty, ['mail'], 26, now)).resolves.toMatchObject({
      alertCount: 0,
      rows: [],
    });
  });

  it('reports backed-up SharePoint sites when sharepoint is tracked, and only then', async () => {
    const withSites = new FakeBackupCatalog({
      mailboxes: [{ id: 'a', displayName: 'Boîte A' }],
      sites: [
        { id: 'x,1', displayName: 'Site X' },
        { id: 'y,2', displayName: 'Site Y' },
        { id: 'z,3', displayName: 'Site Z' },
      ],
      snapshots: {
        'x,1': [{ id: 'p1', workload: 'sharepoint', createdAt: '2026-11-12T06:00:00Z' }],
        'y,2': [{ id: 'p2', workload: 'sharepoint', createdAt: '2026-11-01T06:00:00Z' }],
      },
    });
    const report = await buildStatusReport(withSites, ['mail', 'sharepoint'], 26, now);
    expect(report.rows.map((r) => [r.kind, r.sourceId, r.workload, r.state])).toEqual([
      ['mailbox', 'a', 'mail', 'missing'],
      ['site', 'x,1', 'sharepoint', 'ok'],
      ['site', 'y,2', 'sharepoint', 'stale'],
      ['site', 'z,3', 'sharepoint', 'missing'],
    ]);
    expect(report.alertCount).toBe(3);
    const without = await buildStatusReport(withSites, ['mail'], 26, now);
    expect(without.rows.map((r) => r.kind)).toEqual(['mailbox']);
  });
});

describe('buildServiceSummaries', () => {
  const row = (workload: StatusRow['workload'], lastSnapshotAt: string | null): StatusRow => ({
    kind: workload === 'sharepoint' ? 'site' : 'mailbox',
    sourceId: `${workload}-${String(lastSnapshotAt)}`,
    displayName: 'Source',
    workload,
    lastSnapshotAt,
    ...backupState(lastSnapshotAt, now, 26),
  });
  type Plan = Parameters<typeof buildServiceSummaries>[1][number];
  const plan = (over: Partial<Plan> = {}): Plan => ({
    id: 'plan-1',
    rpoHours: 24,
    createdAt: '2026-11-01T08:00:00Z',
    dataTypes: ['mail'],
    scope: 'all',
    selection: [],
    retentionDays: 30,
    ...over,
  });

  it('gives one line per service, in display order, even without row or plan', () => {
    expect(buildServiceSummaries([], [], 26, now)).toEqual(
      ['mail', 'onedrive', 'sharepoint', 'teams'].map((service) => ({
        service,
        hasPlan: false,
        lastSnapshotAt: null,
        ageHours: null,
        state: 'missing',
        retentionDays: null,
        scope: null,
        awaitingFirstRun: false,
      })),
    );
  });

  it('dates a service by its latest listed backup, never by a plan run, and none without backups', () => {
    const rows = [row('onedrive', '2026-11-19T11:58:00Z'), row('onedrive', '2026-11-17T11:58:00Z')];
    const [mail, drive] = buildServiceSummaries(rows, [plan({ dataTypes: ['onedrive'] })], 26, now);
    expect(drive?.lastSnapshotAt).toBe('2026-11-19T11:58:00Z');
    expect(mail?.lastSnapshotAt).toBeNull();
  });

  it('keeps the latest snapshot but the worst state of the service', () => {
    const rows = [
      row('onedrive', '2026-11-12T06:00:00Z'),
      row('onedrive', '2026-11-09T06:00:00Z'),
      row('mail', '2026-11-12T00:00:00Z'),
      row('sharepoint', '2026-11-12T06:00:00Z'),
      row('sharepoint', null),
    ];
    const [mail, onedrive, sharepoint] = buildServiceSummaries(rows, [], 26, now);
    expect(mail).toMatchObject({ state: 'ok', ageHours: 12 });
    expect(onedrive).toMatchObject({
      state: 'stale',
      lastSnapshotAt: '2026-11-12T06:00:00Z',
      ageHours: 6,
    });
    expect(sharepoint).toMatchObject({ state: 'missing', ageHours: 6 });
  });

  it('maps each plan workload to its own service', () => {
    const files = buildServiceSummaries(
      [],
      [plan({ dataTypes: ['onedrive', 'sharepoint', 'teams'] })],
      26,
      now,
    );
    expect(files.map((s) => s.hasPlan)).toEqual([false, true, true, true]);
    const mail = buildServiceSummaries([], [plan()], 26, now);
    expect(mail.map((s) => s.hasPlan)).toEqual([true, false, false, false]);
  });

  it('takes the longest retention among several plans', () => {
    const plans = [plan({ retentionDays: 30 }), plan({ retentionDays: 365 })];
    expect(buildServiceSummaries([], plans, 26, now)[0]?.retentionDays).toBe(365);
  });

  it('counts the distinct selected items, unless a plan covers everything', () => {
    const a = plan({ scope: 'selection', selection: ['a', 'b'] });
    const b = plan({ scope: 'selection', selection: ['b', 'c'] });
    expect(buildServiceSummaries([], [a, b], 26, now)[0]?.scope).toEqual({
      kind: 'selection',
      count: 3,
    });
    expect(buildServiceSummaries([], [a, plan()], 26, now)[0]?.scope).toEqual({ kind: 'all' });
  });

  describe('first run of a plan without any backup', () => {
    const created = '2026-11-12T08:00:00Z';
    const due = nextRunAt({ id: 'plan-1', rpoHours: 24 }, new Date(created));
    const mailOf = (plans: Plan[], at: Date) => buildServiceSummaries([], plans, 26, at)[0];

    it('awaits until the first scheduled run is due, then no longer', () => {
      const before = new Date(due.getTime() - 1);
      expect(mailOf([plan({ createdAt: created })], before)).toMatchObject({
        awaitingFirstRun: true,
        state: 'missing',
      });
      expect(mailOf([plan({ createdAt: created })], due)?.awaitingFirstRun).toBe(false);
    });

    it('does not await without a plan, with a backup, or while another plan is overdue', () => {
      expect(buildServiceSummaries([], [], 26, now)[0]?.awaitingFirstRun).toBe(false);
      const withBackup = buildServiceSummaries(
        [row('mail', '2026-11-12T06:00:00Z')],
        [plan({ createdAt: now.toISOString() })],
        26,
        now,
      );
      expect(withBackup[0]?.awaitingFirstRun).toBe(false);
      const plans = [plan({ createdAt: now.toISOString() }), plan({ id: 'old' })];
      expect(mailOf(plans, now)?.awaitingFirstRun).toBe(false);
    });
  });
});
