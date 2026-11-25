import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoBackupError } from './status.js';
import { PlansPage } from './PlansPage.js';
import { StatusPage, loadStatus } from './StatusPage.js';

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
