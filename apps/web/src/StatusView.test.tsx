import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView } from './StatusView.js';

const report: StatusReport = {
  generatedAt: '2026-11-12T12:00:00.000Z',
  maxAgeHours: 26,
  alertCount: 2,
  rows: [
    {
      kind: 'mailbox',
      sourceId: 'a',
      displayName: 'Boîte A',
      workload: 'mail',
      lastSnapshotAt: '2026-11-12T06:00:00Z',
      ageHours: 6,
      state: 'ok',
    },
    {
      kind: 'mailbox',
      sourceId: 'a',
      displayName: 'Boîte A',
      workload: 'onedrive',
      lastSnapshotAt: '2026-11-09T06:00:00Z',
      ageHours: 78,
      state: 'stale',
    },
    {
      kind: 'mailbox',
      sourceId: 'b',
      displayName: 'Boîte B',
      workload: 'mail',
      lastSnapshotAt: null,
      ageHours: null,
      state: 'missing',
    },
    {
      kind: 'site',
      sourceId: 'x,1',
      displayName: 'Site X',
      workload: 'sharepoint',
      lastSnapshotAt: '2026-11-12T06:00:00Z',
      ageHours: 6,
      state: 'ok',
    },
  ],
};

describe('StatusView', () => {
  it('puts the alert count first, then one row per mailbox and workload', () => {
    const html = renderToString(<StatusView state={report} />);
    expect(html.indexOf('2 élément(s) en alerte')).toBeLessThan(html.indexOf('<table'));
    expect(html).toContain('Avertissement');
    expect(html).toContain('Échec');
    expect(html).toContain('À jour');
    expect(html).toContain('2026-11-09T06:00:00Z');
    expect(html).toContain('Site X');
    expect(html).toContain('site SharePoint');
    expect(html.match(/<tr/g)).toHaveLength(5);
  });

  it('says so when there is no alert', () => {
    const html = renderToString(<StatusView state={{ ...report, alertCount: 0, rows: [] }} />);
    expect(html).toContain('Aucune alerte');
    expect(html).toContain('Aucune boîte ni site sauvegardé');
  });

  describe('plan compliance', () => {
    const plans = {
      counts: { compliant: 2, late: 1, failed: 1 },
      nonCompliant: [
        {
          id: 'p1',
          name: 'Direction',
          rpoHours: 4 as const,
          state: 'late' as const,
          lastSuccessAt: null,
        },
        {
          id: 'p2',
          name: 'Finance',
          rpoHours: 24 as const,
          state: 'failed' as const,
          lastSuccessAt: '2026-11-10T06:00:00Z',
        },
      ],
    };

    it('shows the count per state and the non-compliant plans', () => {
      const html = renderToString(<StatusView state={{ ...report, plans }} />);
      expect(html).toContain('Plans de protection');
      expect(html).toContain('Conforme</span> <strong>2</strong>');
      expect(html).toContain('En retard</span> <strong>1</strong>');
      expect(html).toContain('En échec</span> <strong>1</strong>');
      expect(html).toContain('Direction');
      expect(html).toContain('Finance');
      expect(html).toContain('2026-11-10T06:00:00Z');
    });

    it('lists no table when every plan is compliant', () => {
      const all = { counts: { compliant: 3, late: 0, failed: 0 }, nonCompliant: [] };
      const html = renderToString(<StatusView state={{ ...report, plans: all }} />);
      expect(html).toContain('Conforme</span> <strong>3</strong>');
      expect(html).not.toContain('Plans non conformes');
    });

    it('says so when there is no plan', () => {
      const none = { counts: { compliant: 0, late: 0, failed: 0 }, nonCompliant: [] };
      const html = renderToString(<StatusView state={{ ...report, plans: none }} />);
      expect(html).toContain('Aucun plan de protection.');
    });

    it('shows an error when the plans are unavailable, and nothing without the field', () => {
      expect(renderToString(<StatusView state={{ ...report, plans: null }} />)).toContain(
        'Conformité des plans indisponible',
      );
      expect(renderToString(<StatusView state={report} />)).not.toContain('Plans de protection');
    });
  });

  it('shows loading and error states', () => {
    expect(renderToString(<StatusView state="loading" />)).toContain('Chargement');
    expect(renderToString(<StatusView state="error" />)).toContain('indisponible');
  });

  it('asks for a first Atlas backup when none exists yet', () => {
    expect(renderToString(<StatusView state="empty" />)).toContain(
      'Aucune sauvegarde trouvée : lancez une première sauvegarde Atlas',
    );
  });
});

describe('fetchStatus', () => {
  it('parses the response and rejects on non-2xx', async () => {
    const ok = (() => Promise.resolve(Response.json(report))) as typeof fetch;
    await expect(fetchStatus(ok)).resolves.toEqual(report);
    const ko = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchStatus(ko)).rejects.toThrow('HTTP 503');
    const none = (() =>
      Promise.resolve(
        Response.json({ error: 'no_backup_found' }, { status: 503 }),
      )) as typeof fetch;
    await expect(fetchStatus(none)).rejects.toBeInstanceOf(NoBackupError);
  });
});
