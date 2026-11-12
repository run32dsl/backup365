import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fetchStatus } from './status.js';
import { StatusView } from './StatusView.js';

const report: StatusReport = {
  generatedAt: '2026-11-12T12:00:00.000Z',
  maxAgeHours: 26,
  alertCount: 2,
  rows: [
    {
      mailboxId: 'a',
      displayName: 'Boîte A',
      workload: 'mail',
      lastSnapshotAt: '2026-11-12T06:00:00Z',
      ageHours: 6,
      state: 'ok',
    },
    {
      mailboxId: 'a',
      displayName: 'Boîte A',
      workload: 'onedrive',
      lastSnapshotAt: '2026-11-09T06:00:00Z',
      ageHours: 78,
      state: 'stale',
    },
    {
      mailboxId: 'b',
      displayName: 'Boîte B',
      workload: 'mail',
      lastSnapshotAt: null,
      ageHours: null,
      state: 'missing',
    },
  ],
};

describe('StatusView', () => {
  it('puts the alert count first, then one row per mailbox and workload', () => {
    const html = renderToString(<StatusView state={report} />);
    expect(html.indexOf('2 élément(s) en alerte')).toBeLessThan(html.indexOf('<table'));
    expect(html).toContain('ancien');
    expect(html).toContain('absent');
    expect(html).toContain('2026-11-09T06:00:00Z');
    expect(html.match(/<tr/g)).toHaveLength(4);
  });

  it('says so when there is no alert', () => {
    const html = renderToString(<StatusView state={{ ...report, alertCount: 0, rows: [] }} />);
    expect(html).toContain('Aucune alerte');
    expect(html).toContain('Aucune boîte sauvegardée');
  });

  it('shows loading and error states', () => {
    expect(renderToString(<StatusView state="loading" />)).toContain('Chargement');
    expect(renderToString(<StatusView state="error" />)).toContain('indisponible');
  });
});

describe('fetchStatus', () => {
  it('parses the response and rejects on non-2xx', async () => {
    const ok = (() => Promise.resolve(Response.json(report))) as typeof fetch;
    await expect(fetchStatus(ok)).resolves.toEqual(report);
    const ko = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchStatus(ko)).rejects.toThrow('HTTP 503');
  });
});
