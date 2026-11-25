import type { StatusRow } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CoverageTiles,
  LatestEvents,
  NextBackup,
  coverageOf,
  launchedLabel,
  nextBackupAt,
  remainingLabel,
  runAll,
  tileName,
} from './HomeCoverage.js';
import type { PlanItem } from './plans.js';

const row = (workload: StatusRow['workload'], sourceId: string, state: StatusRow['state']) =>
  ({
    kind: workload === 'sharepoint' ? 'site' : 'mailbox',
    sourceId,
    displayName: sourceId,
    workload,
    lastSnapshotAt: null,
    ageHours: null,
    state,
  }) as StatusRow;

const plan = (id: string, rpoHours: 4 | 12 | 24 = 24): PlanItem =>
  ({ id, name: `Plan ${id}`, rpoHours, running: false }) as PlanItem;

describe('coverageOf', () => {
  it('counts distinct sources with a snapshot, per service', () => {
    const rows = [
      row('mail', 'a', 'ok'),
      row('mail', 'a', 'stale'),
      row('mail', 'b', 'missing'),
      row('onedrive', 'a', 'ok'),
      row('sharepoint', 's', 'stale'),
      row('contacts', 'a', 'ok'),
    ];
    expect(coverageOf(rows)).toEqual({ mail: 1, onedrive: 1, sharepoint: 1 });
  });
});

describe('CoverageTiles', () => {
  it('renders native links to Sources with the figure in the accessible name', () => {
    const html = renderToStaticMarkup(
      <CoverageTiles coverage={{ mail: 7, onedrive: 5, sharepoint: 13 }} />,
    );
    expect(html).toContain('href="#/sources"');
    expect(html).toContain(`aria-label="${tileName('Boîtes protégées', 7)}"`);
    expect(html).toContain('Couverture du tenant');
    expect(html).not.toContain('total');
  });
  it('shows zero, never an error, when nothing is protected', () => {
    const html = renderToStaticMarkup(
      <CoverageTiles coverage={{ mail: 0, onedrive: 0, sharepoint: 0 }} />,
    );
    expect(html).toContain('Boîtes protégées : 0');
  });
  it('is busy while loading', () => {
    expect(renderToStaticMarkup(<CoverageTiles coverage="loading" />)).toContain(
      'aria-busy="true"',
    );
  });
});

describe('next backup', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  it('takes the earliest slot of all plans', () => {
    const plans = [plan('a'), plan('b', 4)];
    const next = nextBackupAt(plans, now);
    expect(next && next.getTime() > now.getTime()).toBe(true);
    expect(next && next.getTime() - now.getTime() <= 4 * 3_600_000).toBe(true);
  });
  it('is null without plans', () => {
    expect(nextBackupAt([], now)).toBeNull();
  });
  it('formats the remaining time', () => {
    expect(remainingLabel(new Date('2026-11-25T06:42:00Z'), now)).toBe('20 h 42');
    expect(remainingLabel(new Date('2026-11-24T10:35:00Z'), now)).toBe('35 min');
  });
  it('offers the button to an administrator only', () => {
    const render = (admin: boolean) =>
      renderToStaticMarkup(
        <NextBackup plans={[plan('a')]} admin={admin} now={now} onLaunched={() => undefined} />,
      );
    expect(render(true)).toContain('Sauvegarder maintenant');
    expect(render(false)).not.toContain('Sauvegarder maintenant');
    expect(render(false)).toContain('réservé aux administrateurs');
  });
  it('shows the empty state without plans, and no button', () => {
    const html = renderToStaticMarkup(
      <NextBackup plans={[]} admin now={now} onLaunched={() => undefined} />,
    );
    expect(html).toContain('Aucun plan de protection n’est configuré.');
    expect(html).not.toContain('Sauvegarder maintenant');
  });
  it('disables the button while a backup runs', () => {
    const running = { ...plan('a'), running: true } as PlanItem;
    const html = renderToStaticMarkup(
      <NextBackup plans={[running]} admin now={now} onLaunched={() => undefined} />,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('Une sauvegarde est en cours.');
  });
});

describe('runAll', () => {
  it('runs every plan with the same trimmed reason and lists the failures', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { queued: false } })
      .mockResolvedValueOnce({ ok: false, message: 'Refusé' });
    const result = await runAll([plan('a'), plan('b')], 'Test', run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith('a', 'Test');
    expect(result).toEqual({ launched: 1, failures: ['« Plan b » : Refusé'] });
    expect(launchedLabel(1)).toBe('1 sauvegarde lancée');
  });
});

describe('LatestEvents', () => {
  it('has a caption, column headers and the link to the journal', () => {
    const items = [
      { seq: 1, at: '2026-11-24T09:12:00Z', actor: 'admin', action: 'plan.run' },
    ] as Parameters<typeof LatestEvents>[0]['items'];
    const html = renderToStaticMarkup(<LatestEvents items={items} onRetry={() => undefined} />);
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('href="#/audit"');
  });
  it('shows the empty and error states', () => {
    expect(renderToStaticMarkup(<LatestEvents items={[]} onRetry={() => undefined} />)).toContain(
      'Aucune exécution pour le moment.',
    );
    const html = renderToStaticMarkup(<LatestEvents items="error" onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Réessayer');
  });
});
