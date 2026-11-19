import type { StatusReport } from '@backup365/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, scopeLabel, sortRows } from './StatusView.js';
import { ageLabel } from './format.js';
import { complianceView, type PlanItem } from './plans.js';

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
  it('puts the summary banner first, then one row per mailbox and workload', () => {
    const html = renderToString(<StatusView state={report} />);
    expect(html.indexOf('1 sauvegarde en retard, 1 sauvegarde en échec')).toBeLessThan(
      html.indexOf('<table'),
    );
    expect(html).toContain('<h2 id="backups-title">Sauvegardes</h2>');
    expect(html).toContain('Une sauvegarde est en retard au-delà de 26 h.');
    expect(html).not.toContain('Avertissement');
    expect(html).not.toMatch(/Âge \(h\)|Objectif \(h\)/u);
    expect(html).toContain('il y a 3 jours');
    expect(html).toContain('En retard</span> <strong>1</strong>');
    expect(html).toContain('En échec</span> <strong>1</strong>');
    expect(html).toContain('À jour</span> <strong>2</strong>');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Afficher les 2 sauvegardes à jour');
    expect(html).toContain('09/11/2026 06:00');
    expect(html).toContain('Site X');
    expect(html).toContain('Messagerie');
    expect(html).toContain('Dernière sauvegarde (UTC)');
    expect(html).not.toMatch(/instantané|T\d\d:\d\d:\d\dZ/u);
    expect(html).toContain('Site SharePoint');
    expect(html).not.toMatch(/>(Type|Charge)</u);
    expect(html).toContain('>Contenu<');
    expect(html).toContain('OneDrive');
    expect(html).not.toMatch(/boîte/u);
    expect(html.match(/<tr/g)).toHaveLength(5);
  });

  it('shows one line per service, with the service without a plan greyed', () => {
    const services: NonNullable<StatusReport['services']> = [
      {
        service: 'mail',
        hasPlan: true,
        lastSnapshotAt: '2026-11-12T06:00:00Z',
        ageHours: 6,
        state: 'ok',
        retentionDays: 365,
        scope: { kind: 'all' },
      },
      {
        service: 'onedrive',
        hasPlan: false,
        lastSnapshotAt: null,
        ageHours: null,
        state: 'missing',
        retentionDays: null,
        scope: null,
      },
    ];
    const html = renderToString(<StatusView state={{ ...report, services }} />);
    expect(html).toContain('Sources');
    expect(html).toContain('365 jours');
    expect(html).toContain('Toutes les boîtes');
    expect(html.match(/row-muted/g)).toHaveLength(1);
  });

  describe('services (page « Sources »)', () => {
    type Entry = NonNullable<StatusReport['services']>[number];
    const entry = (over: Partial<Entry> = {}): Entry => ({
      service: 'mail',
      hasPlan: true,
      lastSnapshotAt: '2026-11-12T06:00:00Z',
      ageHours: 6,
      state: 'ok',
      retentionDays: 365,
      scope: { kind: 'all' },
      ...over,
    });
    const noPlan = entry({
      service: 'onedrive',
      hasPlan: false,
      lastSnapshotAt: null,
      ageHours: null,
      state: 'missing',
      retentionDays: null,
      scope: null,
    });
    /** Ligne du tableau « Sources » qui porte ce service. */
    const line = (services: Entry[], label: string): string => {
      const html = renderToString(<StatusView state={{ ...report, services }} />);
      const table = html.slice(html.indexOf('services-title'), html.indexOf('backups-title'));
      const found = table.split('<tr').find((tr) => tr.includes(`>${label}</td>`));
      if (found === undefined) throw new Error(`ligne ${label} absente`);
      return found;
    };

    it('says « Aucun plan » with a link to create one, and nothing to read in the journal', () => {
      const tr = line([noPlan], 'OneDrive');
      expect(tr).toContain('row-muted');
      expect(tr).toContain('Aucun plan');
      expect(tr).toContain(
        '<a class="state-link" href="#/plans" aria-label="Créer un plan pour OneDrive">Créer un plan</a>',
      );
      expect(tr).toContain('Jamais');
      expect(tr).not.toContain('#/audit');
      expect(tr).not.toContain('En échec');
    });

    it('links a late or failed service to the audit journal, not an up-to-date one', () => {
      const audit =
        '<a class="state-link" href="#/audit" aria-label="Voir dans le journal d’audit : Messagerie">Voir dans le journal d’audit</a>';
      expect(line([entry({ state: 'stale' })], 'Messagerie')).toContain(audit);
      expect(line([entry({ state: 'missing' })], 'Messagerie')).toContain(audit);
      const ok = line([entry()], 'Messagerie');
      expect(ok).not.toContain('#/audit');
      expect(ok).not.toContain('#/plans');
    });

    it('shows the relative time, then the exact date in a <time datetime>', () => {
      const tr = line([entry()], 'Messagerie');
      expect(tr).toContain('<time dateTime="2026-11-12T06:00:00Z">Il y a 6 h');
      expect(tr).toContain('<small class="state-note">12/11/2026 06:00 UTC</small></time>');
    });

    it('says « Jamais » without a readable date, never an empty date', () => {
      for (const over of [{ lastSnapshotAt: 'pas une date' }, { ageHours: null }]) {
        const tr = line([entry(over)], 'Messagerie');
        expect(tr).toContain('Jamais');
        expect(tr).not.toContain('<time');
      }
    });

    it('shows a service with a plan but no backup yet as failed, with the journal link', () => {
      const tr = line(
        [entry({ lastSnapshotAt: null, ageHours: null, state: 'missing' })],
        'Messagerie',
      );
      expect(tr).toContain('Jamais');
      expect(tr).toContain('En échec');
      expect(tr).toContain('#/audit');
      expect(tr).not.toContain('row-muted');
    });

    it('names the scope after the service: mailboxes, accounts, sites', () => {
      const selection = (count: number) => ({ kind: 'selection' as const, count });
      expect(scopeLabel(entry({ scope: selection(12) }))).toBe('12 boîtes');
      expect(scopeLabel(entry({ scope: selection(1) }))).toBe('1 boîte');
      expect(scopeLabel(entry({ service: 'onedrive', scope: selection(3) }))).toBe('3 comptes');
      expect(scopeLabel(entry({ service: 'onedrive' }))).toBe('Tous les comptes');
      expect(scopeLabel(entry({ service: 'sharepoint' }))).toBe('Tous les sites');
      expect(scopeLabel(entry({ service: 'sharepoint', scope: selection(2) }))).toBe(
        '2 éléments choisis',
      );
      expect(scopeLabel(noPlan)).toBe('');
    });
  });

  it('shows no services section when the server sends none, an error when it is null', () => {
    expect(renderToString(<StatusView state={report} />)).not.toContain('Sources');
    expect(renderToString(<StatusView state={{ ...report, services: null }} />)).toContain(
      'Synthèse des services indisponible',
    );
  });

  it('says so when there is no alert', () => {
    const ok = report.rows.filter((r) => r.state === 'ok');
    const html = renderToString(<StatusView state={{ ...report, alertCount: 0, rows: ok }} />);
    expect(html).toContain('alert-success');
    expect(html).toContain('Toutes les sauvegardes sont à jour');
  });

  it('shows no success banner without rows or when the plans are unknown', () => {
    const none = renderToString(<StatusView state={{ ...report, alertCount: 0, rows: [] }} />);
    expect(none).not.toContain('alert-success');
    expect(none).toContain('Aucune boîte ni site sauvegardé');
    const ok = report.rows.filter((r) => r.state === 'ok');
    const unknown = renderToString(<StatusView state={{ ...report, rows: ok, plans: null }} />);
    expect(unknown).not.toContain('alert-success');
  });

  it('shows the singular toggle, and no toggle without an up-to-date row', () => {
    const one = report.rows.slice(0, 2);
    expect(renderToString(<StatusView state={{ ...report, rows: one }} />)).toContain(
      'Afficher la sauvegarde à jour',
    );
    const bad = report.rows.filter((r) => r.state !== 'ok');
    expect(renderToString(<StatusView state={{ ...report, rows: bad }} />)).not.toContain(
      'aria-expanded',
    );
  });

  it('uses a warning banner for late backups only, an error banner otherwise', () => {
    const late = report.rows.filter((r) => r.state !== 'missing');
    const warning = renderToString(<StatusView state={{ ...report, rows: late }} />);
    expect(warning).toContain('alert-warning');
    expect(warning).toContain('1 sauvegarde en retard<');
    expect(renderToString(<StatusView state={report} />)).toContain('alert-error');
  });

  it('links a late or failed mail source to the search on its mailbox, not an up-to-date one', () => {
    const html = renderToString(<StatusView state={report} />);
    expect(html).toContain('<a href="#/search?mailbox=b">Boîte B</a>');
    expect(html).not.toContain('mailbox=a"');
    expect(html).not.toContain('mailbox=x');
    expect(html).not.toContain('<a href="#/plans">');
  });

  it('sorts the worst state first, then the oldest', () => {
    const sorted = sortRows(report.rows);
    expect(sorted.map((r) => r.state)).toEqual(['missing', 'stale', 'ok', 'ok']);
    const html = renderToString(<StatusView state={report} />);
    expect(html.indexOf('Boîte B')).toBeLessThan(html.indexOf('Boîte A'));
  });

  it('formats ages in plain words', () => {
    expect(ageLabel(3)).toBe('il y a 3 h');
    expect(ageLabel(75)).toBe('il y a 3 jours');
    expect(ageLabel(null)).toBe('jamais');
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
      expect(html).toContain('À jour</span> <strong>2</strong>');
      expect(html).toContain('1 plan en retard, 1 plan en échec');
      expect(html).not.toContain('Objectif');
      expect(html).toContain('Direction');
      expect(html).toContain('Finance');
      expect(html).toContain('10/11/2026 06:00');
    });

    it('links the banner and each plan name to the plans screen, with the new caption', () => {
      const html = renderToString(<StatusView state={{ ...report, plans }} />);
      expect(html).toContain('<a href="#/plans">Voir les plans de protection</a>');
      expect(html).toContain('<a href="#/plans">Direction</a>');
      expect(html).toContain('<a href="#/plans">Finance</a>');
      expect(html).toContain('>Plans en retard ou en échec</caption>');
      expect(html).not.toMatch(/non conforme/iu);
    });

    it('gives a plan the same pill label here and in the plans list', () => {
      const base = {
        id: 'p',
        name: 'P',
        selection: [],
        rpoHours: 4,
        rtoHours: null,
        retentionDays: 30,
        gdprJustification: '',
        createdAt: '2026-11-01T00:00:00Z',
        running: false,
        lastRun: null,
      } as unknown as PlanItem;
      for (const [state, label] of [
        ['compliant', 'À jour'],
        ['late', 'En retard'],
        ['failed', 'En échec'],
      ] as const) {
        const view = complianceView({
          ...base,
          compliance: { state, lastSuccessAt: '2026-11-10T06:00:00Z', lastRestorePointAt: 'x' },
        });
        expect(view.label).toBe(label);
        if (state === 'compliant') continue;
        const html = renderToString(
          <StatusView
            state={{
              ...report,
              plans: {
                counts: { compliant: 0, late: 0, failed: 0 },
                nonCompliant: [
                  { id: 'p', name: 'P', rpoHours: 4, state, lastSuccessAt: '2026-11-10T06:00:00Z' },
                ],
              },
            }}
          />,
        );
        expect(html).toContain(`${view.label}</span></td>`);
      }
    });

    it('lists no table when every plan is compliant', () => {
      const all = { counts: { compliant: 3, late: 0, failed: 0 }, nonCompliant: [] };
      const html = renderToString(<StatusView state={{ ...report, plans: all }} />);
      expect(html).toContain('À jour</span> <strong>3</strong>');
      expect(html).not.toContain('Voir les plans de protection');
      expect(html).not.toContain('Plans en retard ou en échec');
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
      const operator = renderToString(<StatusView state={report} />);
      expect(operator).not.toContain('Plans de protection');
      expect(operator).toContain('alert-error');
      expect(operator).toContain('>Sauvegardes</h2>');
    });
  });

  it('shows loading and error states', () => {
    expect(renderToString(<StatusView state="loading" />)).toContain('Chargement');
    expect(renderToString(<StatusView state="error" />)).toContain('indisponible');
  });

  it('explains the empty state without naming Atlas', () => {
    const html = renderToString(<StatusView state="empty" />);
    expect(html).toContain('Aucune sauvegarde pour l’instant.');
    expect(html).not.toContain('Atlas');
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
