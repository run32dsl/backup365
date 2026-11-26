import type { StatusRow } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CoverageTiles,
  LATEST_RUNS,
  LatestEvents,
  NextBackup,
  coverageOf,
  launchedLabel,
  nextBackupAt,
  remainingLabel,
  runAll,
  runSummary,
  runTypeLabel,
  tileName,
} from './HomeCoverage.js';
import { fetchRuns, type RunItem } from './activities/runs.js';
import { runPlan, type PlanItem } from './plans.js';

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
  it('runs every plan with the same reason and lists the failures', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { queued: false } })
      .mockResolvedValueOnce({ ok: false, message: 'Refusé' });
    const result = await runAll([plan('a'), plan('b')], 'Test', run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith('a', 'Test');
    expect(result).toEqual({ launched: 1, failures: ['«\u202FPlan b\u202F» : Refusé'] });
    expect(launchedLabel(1)).toBe('1 sauvegarde lancée');
  });
  it('sends the reason trimmed of its spaces in each request body', async () => {
    const bodies: unknown[] = [];
    const fetchFn = ((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(JSON.stringify({ queued: false })));
    }) as unknown as typeof fetch;
    const result = await runAll([plan('a'), plan('b')], '  Ticket INC-1 \n', (id, reason) =>
      runPlan(id, reason, fetchFn),
    );
    expect(bodies).toEqual([{ reason: 'Ticket INC-1' }, { reason: 'Ticket INC-1' }]);
    expect(result).toEqual({ launched: 2, failures: [] });
  });
  it('keeps a partial failure readable: plan name and message, no code or request id', async () => {
    const reply = (status: number, body: object) =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'x-request-id': 'req-9' } }),
      );
    const fetchFn = ((url: string) =>
      url.includes('/b/')
        ? reply(409, { error: 'run_in_progress' })
        : reply(200, { queued: false })) as unknown as typeof fetch;
    const result = await runAll([plan('a'), plan('b')], 'Test', (id, reason) =>
      runPlan(id, reason, fetchFn),
    );
    expect(result.launched).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('Une sauvegarde est déjà en cours pour ce plan.');
    expect(result.failures.join()).not.toMatch(/run_in_progress|req-9|409/u);
  });
});

const runItem = (over: Partial<RunItem> = {}): RunItem => ({
  id: 1,
  planId: 'p1',
  planName: 'Direction',
  itemId: 'box-a',
  startedAt: '2026-11-24T09:12:00Z',
  finishedAt: '2026-11-24T09:26:00Z',
  durationMs: 14 * 60_000,
  result: 'success',
  itemsSaved: 1284,
  sourceBytes: 3_400_000_000,
  ...over,
});

describe('LatestEvents', () => {
  it('has a caption, the Heure, Type, Statut and Résumé columns and the link to Activités', () => {
    const plans = [{ ...plan('p1'), dataTypes: ['onedrive', 'mail'] }] as PlanItem[];
    const html = renderToStaticMarkup(
      <LatestEvents items={[runItem()]} plans={plans} onRetry={() => undefined} />,
    );
    expect(html).toContain('<caption');
    const headers = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual(['Heure', 'Type', 'Statut', 'Résumé']);
    expect(html).toContain('24/11/2026');
    expect(html).toContain('Boîtes mail, OneDrive');
    expect(html).toContain('Réussie');
    expect(html).toContain('href="#/activites"');
  });
  it('writes the status in words: running, failed', () => {
    const html = renderToStaticMarkup(
      <LatestEvents
        items={[
          runItem({ id: 2, result: 'running', finishedAt: null, durationMs: null }),
          runItem({ id: 3, result: 'failed', failureCause: 'backup_errors' }),
        ]}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('En cours');
    expect(html).toContain('En échec');
    expect(html).toContain('Sauvegarde</td>');
  });
  it('sums up a run: plan, copied items, volume and duration, or the cause', () => {
    expect(runSummary(runItem())).toBe('« Direction » · 1 284 éléments copiés · 3,4 Go · 14 min');
    expect(runSummary(runItem({ itemsSaved: 1, sourceBytes: null }))).toBe(
      '« Direction » · 1 élément copié · 14 min',
    );
    expect(runSummary(runItem({ result: 'running' }))).toBe('« Direction » · sauvegarde en cours');
    expect(runSummary(runItem({ result: 'interrupted' }))).toContain(
      'cause : la console a été arrêtée',
    );
    expect(runTypeLabel(runItem(), [])).toBe('Sauvegarde');
  });
  it('asks the server for the 5 latest runs only', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], limit: 5 }))),
    );
    await fetchRuns({ planId: '', result: '', limit: LATEST_RUNS }, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/runs?limit=5');
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
