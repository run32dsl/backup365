import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunItem } from './activities/runs.js';
import { ConfigurationNotice, interruptedSentence } from './ConfigurationBlock.js';
import { OverviewView } from './Home.js';
import { HomeCoverage, homeReading, listedEvents, withListedBackup } from './HomeCoverage.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
import type { PlanItem } from './plans.js';

const noop = () => undefined;
const unlinked = { microsoft: { connected: false }, workloads: ['mail'] };
const linked = { microsoft: { connected: true }, workloads: ['mail'] };

// Fin bornée par le catalogue, comme le serveur la rend : 03:51, avant la dernière exécution.
const CAPPED = '2026-11-27T03:51:00.000Z';
const plan = (id: string, name: string): PlanItem => ({
  id,
  name,
  scope: 'all',
  dataTypes: ['mail'],
  rpoHours: 24,
  retentionDays: 365,
  createdAt: '2026-11-01T08:00:00.000Z',
  compliance: { state: 'compliant', lastSuccessAt: CAPPED, lastRestorePointAt: CAPPED },
  running: false,
  lastRun: { status: 'success', startedAt: CAPPED, finishedAt: CAPPED, noSnapshotReason: null },
});
const plans = [plan('a', 'Boîtes mail, quotidien'), plan('b', 'Messagerie Direction')];

const overview: Overview = {
  state: 'failed',
  plans: { total: 3, operational: 2, running: 0, queued: 0, failed: 1, late: 0, waiting: 0 },
  lastBackupAt: CAPPED,
  lastBackupPlan: 'Boîtes mail, quotidien',
  lastFailure: { plan: 'Comptes', at: '2026-11-27T01:00:00.000Z' },
  lateBackups: [],
};

const run = (over: Partial<RunItem> & Pick<RunItem, 'id' | 'planId' | 'planName'>): RunItem => ({
  itemId: `box-${over.id}`,
  startedAt: '2026-11-27T03:40:00.000Z',
  finishedAt: '2026-11-27T03:50:00.000Z',
  durationMs: 600_000,
  result: 'success',
  itemsSaved: 12,
  sourceBytes: 1024,
  ...over,
});

/**
 * Une réussite de « Messagerie Direction » qui finit après celle de « Boîtes mail, quotidien »,
 * puis la plus récente, de « Comptes » ; ces deux-là ont copié `itemsSaved` éléments.
 */
const eventsOf = (itemsSaved: number, newest: RunItem['result'] = 'success'): RunItem[] => [
  run({
    id: 3,
    planId: 'c',
    planName: 'Comptes',
    result: newest,
    itemsSaved,
    startedAt: '2026-11-27T03:55:00.000Z',
    finishedAt: '2026-11-27T03:56:00.000Z',
  }),
  run({
    id: 2,
    planId: 'b',
    planName: 'Messagerie Direction',
    startedAt: '2026-11-27T03:52:00.000Z',
    finishedAt: '2026-11-27T03:53:00.000Z',
    itemsSaved,
  }),
  run({ id: 1, planId: 'a', planName: 'Boîtes mail, quotidien' }),
];

/** L'accueil d'un administrateur tel que `Home` l'assemble, avec la même lecture `homeReading`. */
function home(events: RunItem[], connected: boolean) {
  const config = connected ? linked : unlinked;
  const data: HomeData = { coverage: { mail: 5, onedrive: 0, sharepoint: 0 }, plans, events };
  const reading = homeReading(true, overview, config, data);
  const { listed, since } = reading;
  const part = (node: ReactElement) => renderToStaticMarkup(node);
  return {
    notice: part(<ConfigurationNotice config={config} plans={plans} listed={listed} />),
    cards: part(
      <OverviewView
        state={reading.overview}
        admin
        onRetry={noop}
        interruptedSince={since}
        onShowConnection={noop}
      />,
    ),
    table: part(
      <HomeCoverage
        overview={overview}
        data={data}
        admin
        connected={connected}
        interrupted={since !== null}
        now={new Date('2026-11-27T04:30:00.000Z')}
        onLaunched={noop}
        onRetryEvents={noop}
      />,
    ),
  };
}

const lastCard = (cards: string) => cards.slice(cards.indexOf('id="overview-last"'));
const rows = (table: string) =>
  [
    ...table.matchAll(
      /<tr><td class="table-only"><time dateTime="([^"]+)">([^<]+)<\/time>.*?<\/tr>/gu,
    ),
  ].map((m) => ({ at: m[1]!, label: m[2]!, html: m[0] }));

describe('Home: one last backup for the cards and « Derniers événements » (#608)', () => {
  for (const itemsSaved of [0, 12]) {
    it(`the card gives the time and plan of the newest « Réussie » row (${itemsSaved} copied)`, () => {
      const { cards, table } = home(eventsOf(itemsSaved, 'failed'), true);
      const ok = rows(table).find((r) => r.html.includes('Réussie'))!;
      expect(ok.label).toBe('27/11/2026 03:52 UTC');
      expect(ok.html).toContain('Messagerie Direction');
      const card = lastCard(cards);
      expect(card).toContain(`<time dateTime="${ok.at}">${ok.label}</time>`);
      expect(card).toContain('Plan : Messagerie Direction');
      expect(card).not.toContain('03:51');
    });

    it(`the interruption date is the newest row, in the banner and the card (${itemsSaved} copied)`, () => {
      const { notice, cards, table } = home(eventsOf(itemsSaved), false);
      const listed = rows(table);
      const newest = Math.max(...listed.map((r) => Date.parse(r.at)));
      expect(new Date(newest).toISOString()).toBe('2026-11-27T03:55:00.000Z');
      const sentence = interruptedSentence(new Date(newest).toISOString());
      expect(sentence.replace(/\s/gu, ' ')).toBe(
        'Aucune sauvegarde ne part depuis le 27/11/2026 03:55 UTC.',
      );
      expect(notice).toContain(sentence);
      expect(cards).toContain(sentence);
      expect(lastCard(cards)).toContain('Plan : Comptes');
    });
  }

  it('keeps the server answer when no row is « Réussie »', () => {
    const failed = eventsOf(0, 'failed').map((r) => ({ ...r, result: 'failed' as const }));
    expect(withListedBackup(overview, listedEvents(failed))).toBe(overview);
    expect(withListedBackup(overview, [])).toBe(overview);
  });
});
