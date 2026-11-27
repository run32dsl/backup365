import type { StatusReport } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONDITIONAL_WRITES } from './status/StorageCheck.js';
import { StatusView } from './StatusView.js';

const report: StatusReport = {
  generatedAt: '2026-11-26T12:00:00.000Z',
  maxAgeHours: 26,
  alertCount: 0,
  rows: [],
};
const view = (storage?: StatusReport['storage']) =>
  renderToStaticMarkup(<StatusView state={storage ? { ...report, storage } : report} />);
/** Texte affiché par la seule section « Stockage », sans balises. */
const storageText = (storage: StatusReport['storage']) =>
  (
    view(storage).split('<section class="status-section" aria-labelledby="storage-title">')[1] ?? ''
  ).replace(/<[^>]+>/gu, ' ');

const STATES = ['supported', 'ignored', 'not_probed', null] as const;
const JARGON = /écritures conditionnelles|S3|bucket|identifiants/iu;

describe('Sources page: storage section in product words (issues #567, #576)', () => {
  it('never shows the technical terms, in any of the four states', () => {
    for (const text of Object.values(CONDITIONAL_WRITES)) expect(text).not.toMatch(JARGON);
    for (const conditionalWrites of STATES) {
      const text = storageText({ conditionalWrites });
      expect(text).toContain('Stockage');
      expect(text).not.toMatch(JARGON);
      expect(text).not.toMatch(/not_probed|supported|ignored/u);
    }
  });

  it('shows a compliant storage with an icon + text pill, without a warning', () => {
    const html = view({ conditionalWrites: 'supported' });
    expect(html).toContain('<h2 id="storage-title" tabindex="-1">Stockage</h2>');
    expect(html).toMatch(/<span aria-hidden="true">✔<\/span> À jour/u);
    expect(html).toContain(CONDITIONAL_WRITES.supported);
    expect(html).not.toContain('alert-warning');
  });

  it('explains the blocked storage in an untitled error, the header banner saying the rest (#616)', () => {
    const html = storageText({ conditionalWrites: 'ignored' });
    // SDK 7.3.0 (issue #609) : Atlas refuse d'écrire sur ce stockage, plus de conseil d'attendre.
    expect(html).toContain(CONDITIONAL_WRITES.ignored);
    expect(html).toContain('aucune sauvegarde ni restauration n’y est faite');
    expect(html).not.toContain('Ne restaurez pas une source pendant sa sauvegarde');
    expect(html).not.toContain(CONDITIONAL_WRITES.ignoredTitle);
    expect(html).not.toContain('Prévenez l’exploitant du serveur');
    const page = view({ conditionalWrites: 'ignored' });
    const section = page.slice(page.indexOf('<h2 id="storage-title"'));
    expect(section).toContain('alert-error');
    expect(section).not.toContain('alert-title');
    expect(section).not.toContain('alert-warning');
  });

  it('says the title and the course of action once on the page (#616)', () => {
    const page = view({ conditionalWrites: 'ignored' });
    expect(page.split(CONDITIONAL_WRITES.ignoredTitle)).toHaveLength(2);
    expect(page.split(CONDITIONAL_WRITES.action)).toHaveLength(2);
    expect(page.split(CONDITIONAL_WRITES.ignored)).toHaveLength(2);
  });

  it('puts a blocked storage first, in red, even before failed plans (issue #612)', () => {
    const failing: StatusReport = {
      ...report,
      rows: [
        {
          kind: 'mailbox',
          sourceId: 'a',
          displayName: 'Boîte A',
          workload: 'mail',
          lastSnapshotAt: null,
          ageHours: null,
          state: 'missing',
        },
      ],
      plans: { counts: { compliant: 0, late: 0, failed: 1 }, pending: 0, nonCompliant: [] },
      services: [
        {
          service: 'mail',
          hasPlan: true,
          lastSnapshotAt: null,
          ageHours: null,
          state: 'missing',
          retentionDays: 30,
          scope: { kind: 'all' },
          awaitingFirstRun: false,
        },
      ],
      storage: { conditionalWrites: 'ignored' },
    };
    const html = renderToStaticMarkup(<StatusView state={failing} />);
    // Premier `Alert` : une erreur, titrée par le stockage ; les compteurs passent dans le corps.
    const first = html.slice(html.indexOf('<div class="alert'));
    expect(first).toMatch(
      /^<div class="alert alert-error" role="alert">.*?<strong[^>]*>Sauvegardes et restaurations bloquées sur ce stockage<\/strong>/u,
    );
    const banner = first.slice(0, first.indexOf('</div>', first.indexOf('</strong>')));
    expect(banner.indexOf(CONDITIONAL_WRITES.action)).toBeLessThan(
      banner.indexOf('1 plan en échec et 1 sauvegarde en échec.'),
    );
    expect(banner).toContain(CONDITIONAL_WRITES.before);
    // La section « Stockage » précède « Services ».
    expect(html.indexOf('storage-title')).toBeGreaterThan(0);
    expect(html.indexOf('storage-title')).toBeLessThan(html.indexOf('services-title'));
    expect(html).not.toMatch(/stockage à vérifier/iu);
    // Stockage accepté : la section reste en bas, le bandeau garde ses compteurs.
    const fine = renderToStaticMarkup(
      <StatusView state={{ ...failing, storage: { conditionalWrites: 'supported' } }} />,
    );
    expect(fine).toContain('>1 plan en échec et 1 sauvegarde en échec</strong>');
    expect(fine.indexOf('storage-title')).toBeGreaterThan(fine.indexOf('services-title'));
  });

  it('titles the banner with the storage when it is the only problem', () => {
    const html = view({ conditionalWrites: 'ignored' });
    expect(html).toContain(
      `>Sauvegardes et restaurations bloquées sur ce stockage</strong>${CONDITIONAL_WRITES.action}`,
    );
    expect(view({ conditionalWrites: 'supported' })).not.toContain('alert-error');
  });

  it('explains the pending and unknown checks without a code', () => {
    expect(view({ conditionalWrites: 'not_probed' })).toContain(CONDITIONAL_WRITES.notProbedTitle);
    const unknown = view({ conditionalWrites: null });
    expect(unknown).toContain(CONDITIONAL_WRITES.unknown);
    expect(unknown).toContain(CONDITIONAL_WRITES.unknownLabel);
  });

  it('shows no storage section when the server sends none (other role, no storage)', () => {
    expect(view()).not.toContain('Stockage');
  });
});
