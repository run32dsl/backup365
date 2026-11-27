import type { StatusRow } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CoverageTiles,
  LATEST_RESULTS,
  LATEST_RUNS,
  LatestEvents,
  NextBackup,
  HomeCoverage,
  coverageOf,
  nextBackupAt,
  remainingLabel,
  tileName,
} from './HomeCoverage.js';
import {
  launchedLabel,
  runAll,
  runAllTitle,
  RunAllOutcome,
  type RunAllResult,
} from './RunAllDialog.js';
import { runSummary, runTypeLabel } from './LatestEventRow.js';
import { fetchRuns, groupRuns, type RunItem } from './activities/runs.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
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
  it('binds the arrow to « Sources » with a no-break space, never alone on a line (#582)', () => {
    const html = renderToStaticMarkup(
      <CoverageTiles coverage={{ mail: 5, onedrive: 5, sharepoint: 3 }} />,
    );
    expect(html.match(/Voir dans Sources\u00a0→/g)).toHaveLength(3);
    expect(html).not.toContain('Sources →');
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
    expect(result).toEqual({ launched: 1, failures: ['«\u202FPlan b\u202F» : refusé'] });
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
    expect(result.failures[0]).toBe('« Plan b » : une sauvegarde est déjà en cours pour ce plan.');
    expect(result.failures.join()).not.toMatch(/run_in_progress|req-9|409/u);
  });
});

describe('RunAllDialog result', () => {
  const partial: RunAllResult = {
    launched: 3,
    failures: ['« Boîtes mail, quotidien » : une sauvegarde est déjà en cours pour ce plan.'],
  };
  it('titles a partial launch and gives the tally and the plan not launched with its reason', () => {
    expect(runAllTitle(partial)).toBe('Lancement partiel');
    const html = renderToStaticMarkup(
      <RunAllOutcome result={partial} reason=" Ticket INC-1 " onClose={() => {}} />,
    );
    expect(html).toContain('3 sauvegardes lancées, 1 non lancée');
    expect(html).toContain(
      '« Boîtes mail, quotidien » : une sauvegarde est déjà en cours pour ce plan.',
    );
    expect(html).toContain('alert-warning');
    expect(html).toContain('<dt>Motif</dt><dd>Ticket INC-1</dd>');
  });
  it('titles a launch where nothing started « Lancement impossible »', () => {
    const none: RunAllResult = { launched: 0, failures: ['« A » : refusé', '« B » : refusé'] };
    expect(runAllTitle(none)).toBe('Lancement impossible');
    const html = renderToStaticMarkup(
      <RunAllOutcome result={none} reason="Test" onClose={() => {}} />,
    );
    expect(html).toContain('Aucune sauvegarde n’a été lancée.');
    expect(html).toContain('alert-error');
  });
  it('leaves only « Fermer »: no reason field, no future sentence, no launch or cancel', () => {
    const html = renderToStaticMarkup(
      <RunAllOutcome result={partial} reason="Test" onClose={() => {}} />,
    );
    expect(html).not.toMatch(/<textarea|<input|seront lancés|Lancer la sauvegarde|Annuler/u);
    expect(html.match(/<button/gu)).toHaveLength(1);
    expect(html).toContain('Fermer');
  });
  it('keeps an acronym capitalised after the colon', async () => {
    const result = await runAll([plan('a')], 'Test', () =>
      Promise.resolve({ ok: false, message: 'URL refusée.' } as Awaited<
        ReturnType<typeof runPlan>
      >),
    );
    expect(result.failures[0]).toBe('« Plan a » : URL refusée.');
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
  it('mobile card: plan name alone as title, the pill below, then « type · heure UTC · détails » (#568, #571)', () => {
    const plans = [{ ...plan('p1'), dataTypes: ['mail'] }] as PlanItem[];
    const html = renderToStaticMarkup(
      <LatestEvents
        items={[runItem(), runItem({ id: 2, startedAt: '' })]}
        plans={plans}
        onRetry={() => undefined}
      />,
    );
    const rows = html.split('<tr>').slice(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Heure, type et statut : colonnes du tableau seulement ; la carte n'a que la dernière.
      expect([...row.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1])).toEqual([
        'table-only',
        'table-only',
        'table-only',
        'card-title',
      ]);
      expect(row).not.toContain('data-label');
    }
    const card = (row: string) =>
      (row.match(/<td class="card-title">(.*?)<\/td>/)?.[1] ?? '')
        .replace(/[\u00a0\u202f]/g, ' ')
        .replace(/<[^>]+>/g, '|');
    const [first, noDate] = rows.map(card) as [string, string];
    // Tableau : le résumé avec le plan ; carte : le plan seul, sans guillemets ni durée.
    expect(first).toMatch(
      /^\|« Direction » · 1 boîte · 1 284 éléments copiés · 3,4 Go · 14 min\|\|Direction\|\|/,
    );
    // La pastille a son propre bloc, après le titre : jamais sur la ligne du titre.
    expect(rows[0]).toMatch(
      /<span class="card-only">Direction<\/span><span class="card-only card-pill"><span class="badge /,
    );
    expect(first).toMatch(
      /\|Boîtes mail · 24\/11\/2026 \d\d:\d\d UTC · 1 boîte · 1 284 éléments copiés · 3,4 Go · 14 min\|/,
    );
    expect(noDate).toContain('|Boîtes mail · 1 boîte · ');
    expect(noDate).not.toContain('—');
  });
  it('shows one event per plan run: five results of one run make one « En échec » line (#571)', () => {
    const plans = [{ ...plan('p1'), dataTypes: ['mail'] }] as PlanItem[];
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((box, i) =>
      runItem({ id: 10 + i, itemId: box, itemsSaved: null, sourceBytes: null, durationMs: 1000 }),
    );
    boxes[3] = { ...boxes[3]!, result: 'failed', failureCause: 'backup_errors' };
    const other = runItem({ id: 2, planId: 'p2', planName: 'Boîtes mail, quotidien' });
    const html = renderToStaticMarkup(
      <LatestEvents items={[...boxes, other]} plans={plans} onRetry={() => undefined} />,
    );
    const rows = html.split('<tr>').slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('En échec');
    expect(rows[0]).not.toContain('Réussie');
    expect(rows[0]?.replace(/[\u00a0\u202f]/g, ' ')).toContain(
      '« Direction » · 5 boîtes · cause : des dossiers ou des mails n’ont pas pu être sauvegardés.',
    );
    // Le plan ne sauvegarde que des boîtes mail : jamais de « fichiers » (#632).
    expect(rows[0]).not.toContain('fichiers');
    expect(rows[1]).toContain('Boîtes mail, quotidien');
  });
  it('keeps the five latest runs, not the five latest results', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      runItem({
        id: i + 1,
        itemId: `box-${i % 2}`,
        startedAt: `2026-11-2${Math.floor(i / 2)}T09:00:00Z`,
      }),
    );
    const html = renderToStaticMarkup(<LatestEvents items={items} onRetry={() => undefined} />);
    expect(html.split('<tr>').slice(2)).toHaveLength(LATEST_RUNS);
  });
  it('writes the status in words: running, failed', () => {
    const html = renderToStaticMarkup(
      <LatestEvents
        items={[
          runItem({ id: 2, result: 'running', finishedAt: null, durationMs: null }),
          runItem({
            id: 3,
            result: 'failed',
            failureCause: 'backup_errors',
            startedAt: '2026-11-23T09:12:00Z',
          }),
        ]}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('En cours');
    expect(html).toContain('En échec');
    expect(html).toContain('Sauvegarde</td>');
  });
  const summary = (items: RunItem[], boxes = false) =>
    runSummary(groupRuns(items)[0]!, boxes).replace(/[\u00a0\u202f]/g, ' ');
  it('sums up a run: plan, sources, copied items, volume and duration, or the cause', () => {
    expect(summary([runItem()], true)).toBe(
      '« Direction » · 1 boîte · 1 284 éléments copiés · 3,4 Go · 14 min',
    );
    expect(summary([runItem({ itemsSaved: 1, sourceBytes: null })])).toBe(
      '« Direction » · 1 source · 1 élément copié · 14 min',
    );
    expect(summary([runItem({ result: 'running' })])).toBe(
      '« Direction » · 1 source · sauvegarde en cours',
    );
    expect(summary([runItem({ result: 'interrupted' })])).toContain(
      'cause : la console a été arrêtée',
    );
    expect(runTypeLabel(runItem(), [])).toBe('Sauvegarde');
  });
  it('never sums up a successful run with its duration alone: sources and copied items, 0 included (#571)', () => {
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((box, i) =>
      runItem({
        id: i + 1,
        itemId: box,
        itemsSaved: null,
        sourceBytes: null,
        finishedAt: '2026-11-24T09:12:20Z',
        durationMs: 20_000,
      }),
    );
    expect(summary(boxes, true)).toBe(
      '« Direction » · 5 boîtes · 0 élément copié · moins d’une minute',
    );
  });
  it('asks the server for enough results to gather the 5 latest runs', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], limit: 20 }))),
    );
    await fetchRuns({ planId: '', result: '', limit: LATEST_RESULTS }, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/runs?limit=20');
  });
  it('shows the empty and error states', () => {
    const empty = renderToStaticMarkup(<LatestEvents items={[]} onRetry={() => undefined} />);
    expect(empty).toContain('Aucune exécution pour le moment.');
    // #600 : pas de lien vers une liste vide.
    expect(empty).not.toContain('Tout voir dans Activités');
    expect(
      renderToStaticMarkup(<LatestEvents items={[runItem()]} onRetry={() => undefined} />),
    ).toContain('Tout voir dans Activités');
    const html = renderToStaticMarkup(<LatestEvents items="error" onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Réessayer');
  });
});

describe('HomeCoverage follows the three cards (#578)', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const overview = (state: Overview['state'], total: number): Overview => ({
    state,
    plans: { total, operational: 0, running: 0, queued: 0, failed: 0, late: 0, waiting: 0 },
    lastBackupAt: null,
    lastBackupPlan: null,
    lastFailure: null,
    lateBackups: [],
  });
  // Données qu'affichaient les blocs du bas quand ils se chargeaient seuls.
  const data: HomeData = {
    coverage: { mail: 5, onedrive: 5, sharepoint: 3 },
    plans: [plan('p1')],
    events: [runItem(), runItem({ id: 2, result: 'running', finishedAt: null, durationMs: null })],
  };
  const render = (
    state: Overview | 'loading' | 'error',
    { admin = true, connected = true, home = data } = {},
  ) =>
    renderToStaticMarkup(
      <HomeCoverage
        overview={state}
        data={home}
        admin={admin}
        connected={connected}
        now={now}
        onLaunched={() => undefined}
        onRetryEvents={() => undefined}
      />,
    );

  it('no plan: no non-zero tile, no Sauvegarder maintenant, no event, only the no-plan line', () => {
    for (const admin of [true, false]) {
      const html = render(overview('unconfigured', 0), { admin });
      expect(html).not.toContain('Couverture du tenant');
      expect(html).not.toMatch(/protégée?s : [1-9]/);
      expect(html).not.toContain('Sauvegarder maintenant');
      expect(html).not.toContain('Prochaine sauvegarde dans');
      expect(html).not.toContain('Derniers événements');
      expect(html).not.toContain('<tr>');
      expect(html).toContain('Aucun plan de protection n’est configuré.');
    }
  });
  it('plans without a result: the empty state instead of tiles, no Réussie line', () => {
    const html = render(overview('pending', 1));
    expect(html).toContain('Aucune sauvegarde n’est encore terminée.');
    expect(html).not.toContain('coverage-tile');
    expect(html).not.toContain('Réussie');
    // Une première exécution en cours reste listée : elle ne contredit pas « En attente ».
    expect(html).toContain('sauvegarde en cours');
    const idle = render(overview('pending', 1), { home: { ...data, events: [runItem()] } });
    expect(idle).toContain('Aucune exécution pour le moment.');
    expect(idle).not.toContain('Réussie');
  });
  it('Microsoft 365 connection to configure: no next backup time, no Sauvegarder maintenant', () => {
    const html = render(overview('operational', 1), { connected: false });
    expect(html).not.toContain('Prochaine sauvegarde dans');
    expect(html).not.toContain('Sauvegarder maintenant');
    expect(html).toContain('connexion Microsoft 365 n’est pas configurée');
  });
  it('plans with results: tiles, next backup and events', () => {
    const html = render(overview('operational', 1));
    expect(html).toContain('Boîtes protégées : 5');
    expect(html).toContain('Sauvegarder maintenant');
    expect(html).toContain('Réussie');
    // #600 : pas de sigle technique sur l'accueil.
    expect(html).toContain('Calculée d’après la fréquence de vos plans.');
    expect(html).not.toContain('RPO');
  });
  it('nothing before the cards are known, nor after their error', () => {
    expect(render('loading')).toBe('');
    expect(render('error')).toBe('');
  });
});
