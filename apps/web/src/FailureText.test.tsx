import type { FailureCause } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunsView } from './activities/RunsPage.js';
import type { RunItem } from './activities/runs.js';
import { FAILURE_TEXT } from './failureText.js';
import { failureBanner, type PlanItem } from './plans.js';
import { AdminProvider } from './role.js';

const CAUSES = Object.keys(FAILURE_TEXT) as FailureCause[];

const plan = (cause: FailureCause): PlanItem => ({
  id: 'p1',
  name: 'Boîte direction, quotidien',
  scope: 'all',
  dataTypes: ['mail'],
  rpoHours: 24,
  retentionDays: 365,
  createdAt: '2026-11-01T08:00:00.000Z',
  compliance: { state: 'failed', lastSuccessAt: null, lastRestorePointAt: null },
  running: false,
  lastRun: {
    status: 'failed',
    startedAt: '2026-11-26T16:50:00.000Z',
    finishedAt: '2026-11-26T16:53:00.000Z',
    noSnapshotReason: null,
    failureCause: cause,
  },
});

const run = (cause: FailureCause): RunItem => ({
  id: 7,
  planId: 'p1',
  planName: 'Boîte direction, quotidien',
  itemId: 'boite@exemple.fr',
  startedAt: '2026-11-26T16:50:00.000Z',
  finishedAt: '2026-11-26T16:53:00.000Z',
  durationMs: 3 * 60_000,
  result: cause === 'interrupted' ? 'interrupted' : 'failed',
  itemsSaved: null,
  sourceBytes: null,
  failureCause: cause,
});

/** Lignes secondaires de la colonne « Résultat » (bureau) et de la carte (mobile). */
function runLines(cause: FailureCause, admin: boolean) {
  const html = renderToStaticMarkup(
    <AdminProvider value={admin}>
      <RunsView state={{ items: [run(cause)], limit: 20 }} filter={{ planId: '', result: '' }} />
    </AdminProvider>,
  );
  const cell = (cls: string) =>
    [
      ...(html.match(new RegExp(`<td[^>]*class="${cls}"[^>]*>(.*?)</td>`))?.[1] ?? '').matchAll(
        /<span class="cell-secondary">([^<]+)<\/span>/g,
      ),
    ].map((m) => m[1]);
  return { desktop: cell('card-nolabel run-result'), mobile: cell('card-only') };
}

describe('une seule cause et une seule conduite à tenir par échec (#602)', () => {
  for (const admin of [true, false]) {
    it.each(CAUSES)(
      `Plans et Activités disent la même chose pour %s (${admin ? 'administrateur' : 'opérateur'})`,
      (cause) => {
        const banner = failureBanner(plan(cause), admin);
        const { desktop, mobile } = runLines(cause, admin);
        expect(desktop.slice(0, 2)).toEqual([banner.cause, banner.advice]);
        expect(mobile).toEqual(desktop);
        // Une phrase : majuscule initiale, point final ; l'opérateur passe par un administrateur.
        for (const line of [banner.cause, banner.advice]) expect(line).toMatch(/^[A-ZÀ-Ý].*\.$/u);
        if (!admin) expect(banner.advice).not.toMatch(/Relancez|Vérifiez|Mettez/u);
      },
    );
  }

  it('gives the expected sentences for the demo failure (backup_errors)', () => {
    const banner = failureBanner(plan('backup_errors'), true);
    expect(banner.cause).toBe('Des dossiers ou des fichiers n’ont pas pu être sauvegardés.');
    expect(banner.advice.replace(/\u202f/g, ' ')).toBe(
      'Vérifiez l’autorisation de l’application Microsoft 365 et l’accès au stockage, puis relancez le plan ; si l’échec se répète, prévenez l’exploitant du serveur.',
    );
  });
});
