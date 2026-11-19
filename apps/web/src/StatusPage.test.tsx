import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoBackupError } from './status.js';
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
    expect(html).toContain('État détaillé');
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
