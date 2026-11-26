import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoBackupError } from './status.js';
import { PlansPage } from './PlansPage.js';
import { StatusPage, loadStatus } from './StatusPage.js';
import { StatusView } from './StatusView.js';

const report: StatusReport = {
  generatedAt: '2026-11-12T12:00:00.000Z',
  maxAgeHours: 26,
  alertCount: 0,
  rows: [],
};

describe('StatusPage', () => {
  it('shows its title and the loading state first', () => {
    const html = renderToString(<StatusPage />);
    expect(html).toContain('<main tabindex="-1"');
    expect(html).toContain('<h1>État des sources</h1>');
    expect(html).toContain('État de la protection de chaque service Microsoft 365.');
    expect(html).toContain('Chargement de l’état des sauvegardes');
  });

  it('loads the report', async () => {
    expect(await loadStatus(() => Promise.resolve(report))).toBe(report);
  });

  it('turns a missing backup into the empty state', async () => {
    expect(await loadStatus(() => Promise.reject(new NoBackupError('no_backup_found')))).toBe(
      'empty',
    );
  });

  it('turns any other failure into the error state', async () => {
    expect(await loadStatus(() => Promise.reject(new Error('HTTP 500')))).toBe('error');
  });
});

describe('Sources views structure', () => {
  const inOrder = (html: string, marks: string[]) => {
    const at = marks.map((m) => html.indexOf(m));
    return at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1]!));
  };

  it('puts h1, then the view selector, then the content, on both admin views', () => {
    const plans = renderToString(<PlansPage route={{ page: 'list' }} admin />);
    expect(plans).toContain('<h1>Plans de protection</h1>');
    expect(inOrder(plans, ['<h1>', 'aria-label="Vue des sources"', 'Créer un plan'])).toBe(true);
    const status = renderToString(<StatusPage />);
    expect(status).not.toContain('<h1>Sources</h1>');
    expect(inOrder(status, ['<h1>', 'aria-label="Vue des sources"', 'État de la protection'])).toBe(
      true,
    );
  });

  it('has no selector and no creation button for the operator', () => {
    const html = renderToString(<PlansPage route={{ page: 'list' }} admin={false} />);
    expect(html).not.toContain('Vue des sources');
    expect(html).not.toContain('Créer un plan');
  });
});

describe('Sources cards on mobile', () => {
  const full: StatusReport = {
    ...report,
    rows: [
      {
        kind: 'mailbox',
        sourceId: 'p',
        displayName: 'Paul Moreau',
        workload: 'onedrive',
        lastSnapshotAt: '2026-11-21T11:46:00Z',
        ageHours: 72,
        state: 'stale',
      },
    ],
    services: [
      {
        service: 'mail',
        hasPlan: true,
        lastSnapshotAt: '2026-11-24T11:46:00Z',
        ageHours: 3,
        state: 'ok',
        retentionDays: 365,
        scope: { kind: 'all' },
        awaitingFirstRun: false,
      },
    ],
    plans: {
      counts: { compliant: 0, late: 0, failed: 1 },
      nonCompliant: [
        {
          id: 'd',
          name: 'Boîte direction',
          rpoHours: 24,
          state: 'failed',
          lastSuccessAt: null,
          lastRun: null,
        },
      ],
    },
  };
  const html = renderToString(<StatusView state={full} />);
  const cls = (header: string) =>
    new RegExp(`<th[^>]*class="([^"]*)"[^>]*>${header}<`).exec(html)?.[1] ?? '';

  it('titles each card with the service, plan or source name, the state pill unlabelled below', () => {
    for (const header of ['Service', 'Plan', 'Source'])
      expect(cls(header).split(' ')).toContain('card-title');
    expect(html).toMatch(/<th scope="row" role="rowheader" class="card-title">/);
    expect(html).toMatch(/<td[^>]*data-label="Plan"[^>]*class="card-title"/);
    expect(html).toMatch(/<td[^>]*data-label="Source"[^>]*class="card-title address"/);
    expect(html.match(/data-label="État" class="card-nolabel"/g)).toHaveLength(3);
  });

  it('keeps a source address whole, the age on one line', () => {
    const row = { ...full.rows[0]!, displayName: 'paul.moreau@exemple.test' };
    const withAddress = renderToString(<StatusView state={{ ...full, rows: [row] }} />);
    expect(withAddress).toContain(
      '<span class="addr"><span class="addr-local">paul.moreau@</span><span class="addr-domain">exemple.test</span>',
    );
    expect(cls('Ancienneté').split(' ')).toContain('nowrap');
  });

  it('folds the other values into one unlabelled muted line', () => {
    for (const header of [
      'Dernière sauvegarde',
      'Conservation',
      'Périmètre',
      'Dernière exécution \\(UTC\\)',
      'Contenu',
      'Dernière sauvegarde \\(UTC\\)',
      'Ancienneté',
    ])
      expect(cls(header).split(' ')).toContain('card-hidden');
    const only = [...html.matchAll(/<td[^>]*class="card-only">([^<]*)</g)].map((m) => m[1]);
    expect(only).toEqual([
      'il\u00a0y\u00a0a\u00a03\u00a0h · 24/11/2026 11:46 UTC · conservés 1 an · toutes les boîtes',
      'Dernière exécution : aucune',
      'OneDrive · 21/11/2026 11:46 UTC · il\u00a0y\u00a0a\u00a03\u00a0jours',
    ]);
  });
});
