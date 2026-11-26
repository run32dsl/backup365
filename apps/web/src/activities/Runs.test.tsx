import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { navEntries, screenOf } from '../app/routing.js';
import { RunsView } from './RunsPage.js';
import {
  completeRuns,
  countLabel,
  durationLabel,
  fetchRuns,
  groupRuns,
  parseRunsHash,
  runsHash,
  volumeLabel,
  type RunItem,
} from './runs.js';

const run = (over: Partial<RunItem>): RunItem => ({
  id: 1,
  // Un plan par numéro : des exécutions distinctes, que le regroupement (#571) ne fusionne pas.
  planId: `p${over.id ?? 1}`,
  planName: 'Boîtes de la direction',
  itemId: 'camille@exemple.fr',
  startedAt: '2026-11-18T02:00:00.000Z',
  finishedAt: '2026-11-18T02:14:00.000Z',
  durationMs: 14 * 60_000,
  result: 'success',
  itemsSaved: 1284,
  sourceBytes: 3_200_000_000,
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const all = { planId: '', result: '' } as const;

describe('historique des exécutions', () => {
  it('shows start, duration, result, copied items and source size of a run', () => {
    const html = renderToStaticMarkup(
      <RunsView
        state={{ items: [run({})], limit: 20 }}
        filter={all}
        names={new Map([['camille@exemple.fr', 'Camille Test']])}
      />,
    );
    expect(html).toContain('<time dateTime="2026-11-18T02:00:00.000Z">18/11/2026 02:00</time>');
    const t = text(html);
    for (const part of [
      'Boîtes de la direction',
      'Camille Test',
      '14 min',
      'Réussie',
      '1 284',
      '3,2 Go',
      'Seules les 20 dernières exécutions sont affichées.',
    ]) {
      expect(t).toContain(part);
    }
    const headers = [...html.matchAll(/<th scope="col" role="columnheader"[^>]*>([^<]+)</g)];
    expect(headers.map((m) => m[1])).toEqual([
      'Début (UTC)',
      'Plan',
      'Résultat',
      'Durée',
      'Éléments copiés',
      'Taille source',
      'Détail',
    ]);
    expect(t).not.toContain('Cause');
  });

  it('mobile card: plan name as title, the pill, then one unlabelled line without dashes (#568)', () => {
    const items = [
      run({}),
      run({ id: 2, result: 'running', durationMs: null, itemsSaved: null, sourceBytes: null }),
      run({ id: 3, result: 'failed', failureCause: 'backup_errors', itemsSaved: null }),
    ];
    const html = renderToStaticMarkup(
      <RunsView
        state={{ items, limit: 20 }}
        filter={all}
        names={new Map([['camille@exemple.fr', 'Camille Test']])}
      />,
    );
    const rows = html.split('<tr role="row"').slice(2);
    expect(rows).toHaveLength(3);
    const cell = (row: string, cls: string) =>
      text(row.match(new RegExp(`<td[^>]*class="${cls}"[^>]*>(.*?)</td>`))?.[1] ?? '')
        .replace(/[\u00a0\u202f]/g, ' ')
        .trim();
    // Seules ces trois cellules s'affichent dans la carte : les autres sont card-hidden.
    for (const row of rows) {
      const shown = [...row.matchAll(/<td[^>]*class="([^"]*)"/g)]
        .map((m) => m[1] ?? '')
        .filter((c) => !c.includes('card-hidden'));
      expect(shown).toEqual([
        'keep-words card-title run-plan',
        'card-nolabel run-result',
        'card-only',
      ]);
    }
    const [ok, running, failed] = rows as [string, string, string];
    expect(cell(ok, 'keep-words card-title run-plan')).toContain('Boîtes de la direction');
    expect(ok).toMatch(/class="cell-secondary table-only"/);
    expect(cell(ok, 'card-nolabel run-result')).toBe('✔ Réussie');
    expect(ok).toMatch(/class="card-nolabel run-result"><div><span class="badge /);
    expect(cell(ok, 'card-only')).toBe(
      'Camille Test · 18/11/2026 02:00 UTC · 14 min · 1 284 éléments copiés · 3,2 Go',
    );
    expect(cell(running, 'card-only')).toBe('Camille Test · 18/11/2026 02:00 UTC');
    const detail = cell(failed, 'card-only');
    expect(detail).toContain('Des dossiers ou des fichiers n’ont pas pu être sauvegardés.');
    expect(detail).toContain('Vérifier l’autorisation');
    // La cause libellée du tableau de bureau est masquée dans la carte.
    expect(failed).toMatch(/<span class="table-only"><span class="cell-secondary">Cause/);
    for (const row of rows) {
      expect(cell(row, 'card-only')).not.toMatch(/—|\s:/);
    }
  });

  it('explains a failure, an interruption and an unknown cause in French, never a raw code', () => {
    const html = renderToStaticMarkup(
      <RunsView
        state={{
          items: [
            run({ id: 3, result: 'failed', failureCause: 'backup_errors', itemsSaved: null }),
            run({ id: 4, result: 'interrupted', failureCause: 'interrupted', sourceBytes: null }),
            run({ id: 5, result: 'failed', failureCause: 'unknown' }),
          ],
          limit: 20,
        }}
        filter={all}
      />,
    );
    const t = text(html);
    expect(t).toContain('En échec');
    expect(t).toContain('Cause : des dossiers ou des fichiers n’ont pas pu être sauvegardés.');
    expect(t).toContain('À faire : vérifier l’autorisation de l’application Microsoft 365');
    expect(t).toContain('Interrompue');
    expect(t).toContain('À faire : rien, la prochaine exécution reprendra la sauvegarde.');
    expect(t).toContain('raison non identifiée');
    expect(t).toContain('(exécution n° 5)');
    expect(t).toContain('non communiquée');
    expect(t).not.toMatch(/backup_errors|interrupted|unknown/);
  });

  it('groups the per-source results of one run into one event, « En échec » if one source failed (#571)', () => {
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((box, i) =>
      run({ id: 10 + i, planId: 'p1', itemId: box, itemsSaved: i, sourceBytes: null }),
    );
    boxes[2] = {
      ...boxes[2]!,
      result: 'failed',
      failureCause: 'backup_errors',
      finishedAt: '2026-11-18T02:20:00.000Z',
      durationMs: 20 * 60_000,
    };
    const later = run({ id: 20, planId: 'p1', startedAt: '2026-11-19T02:00:00.000Z' });
    const events = groupRuns([later, ...boxes]);
    expect(events).toHaveLength(2);
    const [, event] = events as [unknown, (typeof events)[number]];
    expect(event.runs).toHaveLength(5);
    expect(event.result).toBe('failed');
    expect(event.failureCause).toBe('backup_errors');
    expect(event.id).toBe(12);
    expect(event.itemsSaved).toBe(0 + 1 + 3 + 4 + 2);
    expect(event.sourceBytes).toBeNull();
    expect(event.durationMs).toBe(20 * 60_000);
    // Toutes réussies : l'exécution est réussie, sans cause.
    const ok = groupRuns(boxes.filter((b) => b.result === 'success'))[0]!;
    expect(ok.result).toBe('success');
    expect(ok.failureCause).toBeUndefined();
    // Une source encore en cours : pas de durée ni de fin.
    const open = groupRuns([boxes[0]!, { ...boxes[1]!, result: 'running', durationMs: null }])[0]!;
    expect(open.result).toBe('running');
    expect(open.durationMs).toBeNull();
  });

  it('groups the sources a scheduler pass saves one after the other, each with its own start (#571)', () => {
    // Passage du planificateur : chaque boîte commence quand la précédente finit.
    const at = (s: number) => new Date(Date.UTC(2026, 10, 26, 9, 2, s)).toISOString();
    const pass = ['a', 'b', 'c'].map((box, i) =>
      run({
        id: 3 - i,
        planId: 'p1',
        itemId: box,
        startedAt: at(2 - i),
        finishedAt: at(3 - i),
        durationMs: 1000,
      }),
    );
    // Même plan une heure plus tôt : une autre exécution ; une boîte déjà vue en ouvre une aussi.
    const earlier = run({
      id: 0,
      planId: 'p1',
      itemId: 'a',
      startedAt: '2026-11-26T08:00:00.000Z',
    });
    const events = groupRuns([...pass, earlier]);
    expect(events.map((e) => e.runs.length)).toEqual([3, 1]);
    expect(events[0]?.startedAt).toBe(at(0));
    expect(events[0]?.durationMs).toBe(3000);
    const twice = groupRuns([pass[0]!, { ...pass[1]!, itemId: 'a' }]);
    expect(twice).toHaveLength(2);
  });

  it('chains a source that starts within 60 s of the previous end, not later nor before (#571)', () => {
    const end = '2026-11-26T09:00:00.000Z';
    const first = run({
      id: 1,
      planId: 'p1',
      itemId: 'a',
      startedAt: '2026-11-26T08:59:00.000Z',
      finishedAt: end,
    });
    const next = (startedAt: string) => run({ id: 2, planId: 'p1', itemId: 'b', startedAt });
    const sizes = (startedAt: string) =>
      groupRuns([next(startedAt), first]).map((e) => e.runs.length);
    expect(sizes('2026-11-26T09:01:00.000Z')).toEqual([2]);
    expect(sizes('2026-11-26T09:01:01.000Z')).toEqual([1, 1]);
    expect(sizes('2026-11-26T08:59:30.000Z')).toEqual([1, 1]);
    // Un autre plan intercalé ne coupe pas l'exécution.
    const other = run({ id: 9, planId: 'p2', startedAt: '2026-11-26T09:00:30.000Z' });
    expect(
      groupRuns([next('2026-11-26T09:00:40.000Z'), other, first]).map((e) => e.runs.length),
    ).toEqual([2, 1]);
  });

  it('drops the oldest run of a full list: its other sources may be past the limit (#571)', () => {
    const items = [
      run({ id: 3, planId: 'p1', startedAt: '2026-11-26T09:00:00.000Z' }),
      run({ id: 2, planId: 'p2', itemId: 'a' }),
      run({ id: 1, planId: 'p2', itemId: 'b' }),
    ];
    expect(completeRuns(items, 3).map((e) => e.planId)).toEqual(['p1']);
    expect(completeRuns(items, 20).map((e) => e.planId)).toEqual(['p1', 'p2']);
    expect(completeRuns(items.slice(1), 2)).toHaveLength(1);
  });

  it('shows one run of five mailboxes as one line that says « 5 boîtes » (#571)', () => {
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((box, i) =>
      run({ id: 10 + i, planId: 'p1', itemId: box, itemsSaved: null, sourceBytes: null }),
    );
    const html = renderToStaticMarkup(
      <RunsView state={{ items: boxes, limit: 20 }} filter={all} boxPlans={new Set(['p1'])} />,
    );
    const rows = html.split('<tr role="row"').slice(2);
    expect(rows).toHaveLength(1);
    const t = text(html).replace(/[\u00a0\u202f]/g, ' ');
    expect(t).toContain('5 boîtes');
    expect(t).toContain('5 boîtes · 18/11/2026 02:00 UTC · 14 min · 0 élément copié');
    expect(t).not.toMatch(/\b[a-e]\b · /);
  });

  it('keeps the caption for screen readers only, the intro already says the order (#580)', () => {
    const html = renderToStaticMarkup(
      <RunsView state={{ items: [run({})], limit: 20 }} filter={all} />,
    );
    expect(html).toContain(
      '<caption class="sr-only">Dernières exécutions, de la plus récente à la plus ancienne</caption>',
    );
  });

  it('puts the plan name in its own block and marks the elastic « Résultat » column (#580)', () => {
    const html = renderToStaticMarkup(
      <RunsView state={{ items: [run({})], limit: 20 }} filter={all} />,
    );
    expect(html).toContain('<span class="run-plan-name">Boîtes de la direction</span>');
    expect(html).toMatch(/<th scope="col" role="columnheader" class="[^"]*run-result">Résultat/);
  });

  it('shows a running run with dashes instead of counters', () => {
    const html = renderToStaticMarkup(
      <RunsView
        state={{
          items: [
            run({ result: 'running', durationMs: null, itemsSaved: null, sourceBytes: null }),
          ],
          limit: 20,
        }}
        filter={all}
      />,
    );
    expect(text(html)).toContain('En cours');
    const cell = (label: string) =>
      new RegExp(`data-label="${label}"[^>]*>(?:<span>)?(?:<span aria-hidden="true">)?—<`);
    for (const label of ['Durée', 'Éléments copiés', 'Taille source']) {
      expect(html).toMatch(cell(label));
    }
  });

  it('renders the loading, error and empty states', () => {
    const loading = renderToStaticMarkup(<RunsView state="loading" filter={all} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Chargement des exécutions…');
    const error = renderToStaticMarkup(<RunsView state="error" filter={all} />);
    expect(error).toContain('role="alert"');
    expect(error).toContain('Réessayer');
    const empty = { items: [], limit: 20 };
    expect(
      renderToStaticMarkup(<RunsView state={empty} filter={{ planId: 'p1', result: '' }} />),
    ).toContain('Ce plan n’a pas encore été exécuté.');
    expect(
      renderToStaticMarkup(<RunsView state={empty} filter={{ planId: '', result: 'failed' }} />),
    ).toContain('Aucune exécution ne correspond à ces filtres.');
    expect(renderToStaticMarkup(<RunsView state={empty} filter={all} />)).not.toContain('<table');
  });

  it('formats durations, counts and sizes the French way', () => {
    expect(durationLabel(20_000)).toBe('moins\u00a0d’une\u00a0minute');
    expect(durationLabel(65 * 60_000)).toBe('1 h 05');
    expect(durationLabel(null)).toBe('—');
    expect(countLabel(1284)).toBe('1 284');
    expect(countLabel(null)).toBe('—');
    expect(volumeLabel(3_860_000_000)).toBe('3,9 Go');
    expect(volumeLabel(840_000_000)).toBe('840 Mo');
    expect(volumeLabel(null)).toBeNull();
  });

  it('asks the server with the plan and result filters', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], limit: 20 }))),
    );
    await fetchRuns({ planId: 'p 1', result: 'failed' }, fetchFn as unknown as typeof fetch);
    await fetchRuns(all, fetchFn as unknown as typeof fetch);
    expect(fetchFn.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/runs?planId=p+1&result=failed',
      '/api/runs',
    ]);
  });

  it('routes #/activites, with an optional plan, under the « Activités » entry', () => {
    expect(parseRunsHash('#/activites')).toBe('');
    expect(parseRunsHash(runsHash('p/1'))).toBe('p/1');
    expect(parseRunsHash('#/audit')).toBeNull();
    expect(screenOf(runsHash('p1'))).toBe('runs');
    const entry = navEntries('runs', false).find((e) => e.label === 'Activités');
    expect(entry).toMatchObject({ href: '#/activites', current: true });
    expect(navEntries('audit', false).find((e) => e.label === 'Activités')?.current).toBe(true);
  });
});
