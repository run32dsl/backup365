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
import { RunsView } from './activities/RunsPage.js';
import { fetchRuns, mailOnlyTypes, type RunItem } from './activities/runs.js';
import { AdminProvider } from './role.js';
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
  /** Rendu d'Activités › Sauvegardes pour les mêmes exécutions, plans et boîtes. */
  const activities = (
    items: RunItem[],
    plans: readonly PlanItem[],
    names: ReadonlyMap<string, string> = new Map(),
  ) =>
    renderToStaticMarkup(
      <AdminProvider value>
        <RunsView
          state={{ items, limit: LATEST_RESULTS }}
          filter={{ planId: '', result: '' }}
          names={names}
          boxPlans={new Set(plans.filter((p) => mailOnlyTypes(p.dataTypes)).map((p) => p.id))}
          planTypes={new Map(plans.map((p) => [p.id, p.dataTypes]))}
        />
      </AdminProvider>,
    );
  const headersOf = (html: string) =>
    [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  /** Lignes du corps du tableau (la première `<tr role="row">` est celle des en-têtes). */
  const rowsOf = (html: string) =>
    [...html.matchAll(/<tr role="row">(.*?)<\/tr>/g)].map((m) => m[1]!).slice(1);
  /** `[en-tête, texte]` de chaque cellule ; balises remplacées par `|`, espaces insécables par ` `. */
  const cellsOf = (row: string) =>
    [...row.matchAll(/<td[^>]*data-label="([^"]+)"[^>]*>(.*?)<\/td>/g)].map(
      (m) => [m[1]!, m[2]!.replace(/<[^>]+>/g, '|').replace(/[\u00a0\u202f]/g, ' ')] as const,
    );

  it('has the columns of Activités › Sauvegardes, a caption and the link to Activités (#636)', () => {
    const plans = [{ ...plan('p1'), dataTypes: ['onedrive', 'mail'] }] as PlanItem[];
    const html = renderToStaticMarkup(
      <LatestEvents items={[runItem()]} plans={plans} onRetry={() => undefined} />,
    );
    expect(html).toContain('<caption');
    const headers = headersOf(html);
    expect(headers).toEqual(headersOf(activities([runItem()], plans)));
    // Les six colonnes du bureau ; « Détail » est la ligne de la carte mobile.
    expect(headers).toEqual([
      'Début (UTC)',
      'Plan',
      'Résultat',
      'Durée',
      'Éléments copiés',
      'Taille source',
      'Détail',
    ]);
    expect(html).toContain('href="#/activites"');
  });
  it('shows the demo failure of « Boîte direction, quotidien » exactly as Activités, desk and card (#636)', () => {
    const plans = [
      { ...plan('p-dir'), name: 'Boîte direction, quotidien', dataTypes: ['mail'] },
      { ...plan('p-mail'), name: 'Boîtes mail, quotidien', dataTypes: ['mail'] },
    ] as PlanItem[];
    const names = new Map([['marc.lefevre@exemple.fr', 'marc.lefevre@exemple.fr']]);
    const failed = runItem({
      id: 9,
      planId: 'p-dir',
      planName: 'Boîte direction, quotidien',
      itemId: 'marc.lefevre@exemple.fr',
      startedAt: '2026-11-27T20:24:00Z',
      finishedAt: '2026-11-27T20:24:30Z',
      durationMs: 30_000,
      result: 'failed',
      itemsSaved: null,
      sourceBytes: null,
      failureCause: 'backup_errors',
    });
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((box, i) =>
      runItem({
        id: 20 + i,
        planId: 'p-mail',
        planName: 'Boîtes mail, quotidien',
        itemId: `${box}@exemple.fr`,
        startedAt: '2026-11-27T20:25:00Z',
        finishedAt: '2026-11-27T20:25:20Z',
        durationMs: 20_000,
        itemsSaved: 52,
        sourceBytes: null,
      }),
    );
    const items = [...boxes, failed];
    const home = renderToStaticMarkup(
      <LatestEvents items={items} plans={plans} names={names} onRetry={() => undefined} />,
    );
    const homeRows = rowsOf(home);
    expect(homeRows).toHaveLength(2);
    // Même balisage, cellule par cellule, colonne « Détail » (la carte mobile) comprise.
    expect(homeRows).toEqual(rowsOf(activities(items, plans, names)));
    const cells = Object.fromEntries(cellsOf(homeRows[1]!));
    expect(cells['Début (UTC)']).toBe('|27/11/2026 20:24|');
    expect(cells['Plan']).toContain('Boîte direction, quotidien');
    expect(cells['Plan']).toContain('marc.lefevre');
    expect(cells['Résultat']).toContain('Des dossiers ou des mails n’ont pas pu être sauvegardés.');
    expect(cells['Résultat']).toContain('Vérifiez l’autorisation');
    // Carte : source · date UTC · durée · éléments copiés · volume, puis cause et conduite.
    expect(cells['Détail']).toMatch(
      /^\|?marc\.lefevre@exemple\.fr · 27\/11\/2026 20:24 UTC · moins d’une minute\|/,
    );
    expect(Object.fromEntries(cellsOf(homeRows[0]!))['Détail']).toMatch(
      /^\|?5 boîtes · 27\/11\/2026 20:25 UTC · moins d’une minute · 260 éléments copiés/,
    );
    // Plus aucun résumé : ni « UTC » dans une date, ni « cause : », ni plan entre guillemets.
    for (const row of homeRows) {
      for (const [label, text] of cellsOf(row)) {
        expect(text).not.toContain('cause :');
        expect(text).not.toContain('«');
        if (label !== 'Détail') expect(text).not.toContain('UTC');
      }
    }
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
    expect(rowsOf(html)).toHaveLength(LATEST_RUNS);
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
    expect(html).toContain('En cours');
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
