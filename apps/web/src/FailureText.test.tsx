import type { DataType, FailureCause } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunsView } from './activities/RunsPage.js';
import { groupRuns, type RunItem } from './activities/runs.js';
import { FAILURE_TEXT, failureText, lowerFirst } from './failureText.js';
import { runSummary } from './LatestEventRow.js';
import { complianceView, failureBanner, type PlanItem } from './plans.js';
import { AdminProvider } from './role.js';

const CAUSES = Object.keys(FAILURE_TEXT) as FailureCause[];

const plan = (cause: FailureCause, dataTypes: DataType[] = ['mail']): PlanItem => ({
  id: 'p1',
  name: 'Boîte direction, quotidien',
  scope: 'all',
  dataTypes,
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
function runLines(cause: FailureCause, admin: boolean, dataTypes: DataType[] = ['mail']) {
  const html = renderToStaticMarkup(
    <AdminProvider value={admin}>
      <RunsView
        state={{ items: [run(cause)], limit: 20 }}
        filter={{ planId: '', result: '' }}
        planTypes={new Map([['p1', dataTypes]])}
      />
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
    expect(banner.cause).toBe('Des dossiers ou des mails n’ont pas pu être sauvegardés.');
    expect(banner.advice.replace(/\u202f/g, ' ')).toBe(
      'Vérifiez l’autorisation de l’application Microsoft 365 et l’accès au stockage, puis relancez le plan ; si l’échec se répète, prévenez l’exploitant du serveur.',
    );
  });
});

describe('la cause backup_errors nomme ce que le plan sauvegarde (#632)', () => {
  const CASES: [string, DataType[], string][] = [
    ['messagerie seule', ['mail', 'contacts', 'calendar'], 'Des dossiers ou des mails'],
    ['contacts seuls', ['contacts'], 'Des dossiers ou des mails'],
    ['OneDrive seul', ['onedrive'], 'Des dossiers ou des fichiers'],
    ['OneDrive et SharePoint', ['onedrive', 'sharepoint'], 'Des dossiers ou des fichiers'],
    ['mixte', ['mail', 'sharepoint'], 'Des éléments'],
  ];
  for (const admin of [true, false]) {
    it.each(CASES)(
      `%s : même phrase sur Plans, Activités et l’Accueil (${admin ? 'administrateur' : 'opérateur'})`,
      (_, types, head) => {
        const expected = `${head} n’ont pas pu être sauvegardés.`;
        const p = plan('backup_errors', types);
        expect(failureText('backup_errors', admin, types).cause).toBe(expected);
        // Bandeau et colonne « État » de Plans de protection.
        const banner = failureBanner(p, admin);
        expect(banner.cause).toBe(expected);
        const note = complianceView(p).note ?? '';
        expect(note.startsWith(`${expected.replace(/\.$/, '')} · `)).toBe(true);
        // Activités › Sauvegardes, bureau et carte.
        const { desktop, mobile } = runLines('backup_errors', admin, types);
        expect(desktop[0]).toBe(expected);
        expect(mobile[0]).toBe(expected);
        // Conduite à tenir inchangée.
        expect(banner.advice).toBe(FAILURE_TEXT.backup_errors[admin ? 'admin' : 'operator']);
        // Accueil › Derniers événements : la même phrase en minuscule après « cause : ».
        const summary = runSummary(groupRuns([run('backup_errors')])[0]!, false, types);
        expect(summary.replace(/[\u00a0\u202f]/g, ' ')).toContain(
          `cause : ${lowerFirst(expected)}`,
        );
        if (head !== 'Des dossiers ou des fichiers') {
          for (const line of [banner.cause, note, ...desktop, ...mobile, summary]) {
            expect(line).not.toContain('fichiers');
          }
        }
      },
    );
  }

  it('keeps the file sentence when the plan content is unknown', () => {
    expect(failureText('backup_errors', true).cause).toBe(FAILURE_TEXT.backup_errors.cause);
    expect(failureText('no_result', true, ['mail']).cause).toBe(FAILURE_TEXT.no_result.cause);
  });
});
