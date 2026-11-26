import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { navEntries, screenOf } from '../app/routing.js';
import { RunsView } from './RunsPage.js';
import {
  countLabel,
  durationLabel,
  fetchRuns,
  parseRunsHash,
  runsHash,
  volumeLabel,
  type RunItem,
} from './runs.js';

const run = (over: Partial<RunItem>): RunItem => ({
  id: 1,
  planId: 'p1',
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
    ]);
    expect(t).not.toContain('Cause');
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
