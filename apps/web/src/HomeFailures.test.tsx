import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunItem } from './activities/runs.js';
import { OverviewView } from './Home.js';
import { HomeCoverage, homeReading, listedFailures, listedEvents } from './HomeCoverage.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
import type { PlanItem } from './plans.js';

const noop = () => undefined;
const linked = { microsoft: { connected: true }, workloads: ['mail'] };

const plan = (id: string, name: string): PlanItem => ({
  id,
  name,
  scope: 'all',
  dataTypes: ['mail'],
  rpoHours: 24,
  retentionDays: 365,
  createdAt: '2026-11-01T08:00:00.000Z',
  compliance: { state: 'compliant', lastSuccessAt: null, lastRestorePointAt: null },
  running: false,
  lastRun: null,
});
const plans = [plan('a', 'Boîtes mail, quotidien'), plan('b', 'Boîte direction, quotidien')];

const run = (over: Partial<RunItem> & Pick<RunItem, 'id' | 'planId' | 'planName'>): RunItem => ({
  itemId: `box-${over.id}`,
  startedAt: '2026-11-27T16:55:00.000Z',
  finishedAt: '2026-11-27T16:56:00.000Z',
  durationMs: 60_000,
  result: 'success',
  itemsSaved: 12,
  sourceBytes: 1024,
  ...over,
});

const A = { planId: 'a', planName: 'Boîtes mail, quotidien' };
const B = { planId: 'b', planName: 'Boîte direction, quotidien' };

/**
 * « Boîte direction » en cours à 19:54 ; « Boîtes mail » en échec, partie à 18:55 et finie à
 * 19:10 (le serveur date l'échec de sa fin) ; `directionFailed` : l'exécution précédente de
 * « Boîte direction », à 17:55, a aussi échoué.
 */
const eventsOf = (directionFailed: boolean): RunItem[] => [
  run({ id: 5, ...B, startedAt: '2026-11-27T19:54:00.000Z', finishedAt: null, result: 'running' }),
  run({
    id: 4,
    ...A,
    startedAt: '2026-11-27T18:55:00.000Z',
    finishedAt: '2026-11-27T19:10:00.000Z',
    result: 'failed',
    failureCause: 'backup_errors',
  }),
  run({
    id: 3,
    ...B,
    startedAt: '2026-11-27T17:55:00.000Z',
    finishedAt: '2026-11-27T17:56:00.000Z',
    ...(directionFailed ? { result: 'failed' as const, failureCause: 'backup_errors' } : {}),
  }),
  run({ id: 2, ...A }),
];

const overviewOf = (failed: number): Overview => ({
  state: 'failed',
  plans: { total: 3, operational: 3 - failed, running: 1, queued: 0, failed, late: 0, waiting: 0 },
  lastBackupAt: '2026-11-27T16:56:00.000Z',
  lastBackupPlan: 'Boîtes mail, quotidien',
  lastFailure: { plan: 'Boîtes mail, quotidien', at: '2026-11-27T19:10:00.000Z' },
  lateBackups: [],
});

/** Texte d'un rendu : balises et espaces insécables ramenées à une espace. */
const text = (html: string) => html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');

/** L'accueil d'un administrateur tel que `Home` l'assemble (`homeReading`). */
function home(events: RunItem[], overview: Overview) {
  const data: HomeData = { coverage: { mail: 5, onedrive: 0, sharepoint: 0 }, plans, events };
  const reading = homeReading(true, overview, linked, data);
  return {
    card: text(
      renderToStaticMarkup(<OverviewView state={reading.overview} admin onRetry={noop} />),
    ),
    table: renderToStaticMarkup(
      <HomeCoverage
        overview={reading.overview}
        data={data}
        admin
        now={new Date('2026-11-27T20:00:00.000Z')}
        onLaunched={noop}
        onRetryEvents={noop}
      />,
    ),
  };
}

const rows = (table: string) =>
  [
    ...table.matchAll(
      /<tr role="row"><td [^>]*data-label="Début \(UTC\)"[^>]*><time dateTime="[^"]+">([^<]+)<\/time>.*?<\/tr>/gu,
    ),
    // La colonne « Début (UTC) » porte le fuseau dans son en-tête (#636).
  ].map((m) => ({ label: `${m[1]!} UTC`, html: m[0] }));

const failedRows = (table: string) => rows(table).filter((r) => r.html.includes('En échec'));

describe('Home: the « Sauvegarde » card cites only failures listed in « Derniers événements » (#634)', () => {
  it('cites the failed row, with its plan and the time of its « Heure » column', () => {
    const { card, table } = home(eventsOf(false), overviewOf(1));
    const [failed, ...others] = failedRows(table);
    expect(others).toEqual([]);
    expect(failed!.html).toContain('Boîtes mail, quotidien');
    expect(failed!.label).toBe('27/11/2026 18:55 UTC');
    expect(card).toContain(text('Échec de « Boîtes mail, quotidien » le 27/11/2026 18:55 UTC.'));
    // L'heure de fin du serveur n'est pas celle d'une ligne : la carte ne la cite pas.
    expect(card).not.toContain('19:10');
  });

  it('names each failed plan, as many as the « Plans » card counts', () => {
    const { card, table } = home(eventsOf(true), overviewOf(2));
    const failed = failedRows(table);
    expect(failed.map((r) => r.label)).toEqual(['27/11/2026 18:55 UTC', '27/11/2026 17:55 UTC']);
    expect(card).toContain(
      text(
        '2 plans en échec : « Boîtes mail, quotidien » le 27/11/2026 18:55 UTC, ' +
          '« Boîte direction, quotidien » le 27/11/2026 17:55 UTC.',
      ),
    );
    expect(card).toMatch(/En échec\s*2/u);
  });

  it('reads the last finished run of each plan, never a running one nor an older failure', () => {
    const later = [run({ id: 9, ...A, startedAt: '2026-11-27T19:30:00.000Z' }), ...eventsOf(true)];
    expect(listedFailures(listedEvents(later))).toEqual([
      { plan: 'Boîte direction, quotidien', at: '2026-11-27T17:55:00.000Z' },
    ]);
  });

  it('counts the failed plans the server knows beyond the list, and names the listed ones', () => {
    const { card } = home(eventsOf(false), overviewOf(3));
    expect(card).toContain(
      text('3 plans en échec, dont « Boîtes mail, quotidien » le 27/11/2026 18:55 UTC.'),
    );
    expect(card).toMatch(/En échec\s*3/u);
  });

  it('never counts fewer failed plans than the card names', () => {
    const { card } = home(eventsOf(true), overviewOf(1));
    expect(card).toContain(text('2 plans en échec : « Boîtes mail'));
    expect(card).toMatch(/En échec\s*2/u);
  });

  // L'échec du serveur est alors plus ancien que toutes les lignes listées : il reste dit.
  it('keeps the server answer when no failure is listed', () => {
    const { card } = home([run({ id: 1, ...A })], overviewOf(1));
    expect(card).toContain('le 27/11/2026 19:10 UTC.');
  });
});
