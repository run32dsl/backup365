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
    expect(html).toContain('<h2 id="storage-title">Stockage</h2>');
    expect(html).toMatch(/<span aria-hidden="true">✔<\/span> À jour/u);
    expect(html).toContain(CONDITIONAL_WRITES.supported);
    expect(html).not.toContain('alert-warning');
  });

  it('titles the warning after the consequence, says what to do and who to tell', () => {
    const html = view({ conditionalWrites: 'ignored' });
    expect(html).toContain('alert-warning');
    // SDK 7.3.0 (issue #609) : Atlas refuse d'écrire sur ce stockage, plus de conseil d'attendre.
    expect(html).toContain('Sauvegardes et restaurations bloquées sur ce stockage');
    expect(html).toContain('aucune sauvegarde ni restauration n’y est faite');
    expect(html).not.toContain('Ne restaurez pas une source pendant sa sauvegarde');
    expect(html).toContain('Prévenez l’exploitant du serveur');
  });

  it('adds « stockage à vérifier » to the summary banner at the top of the page', () => {
    const html = view({ conditionalWrites: 'ignored' });
    const summary = html.indexOf('Stockage à vérifier');
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(summary).toBeLessThan(html.indexOf('storage-title'));
    expect(view({ conditionalWrites: 'supported' })).not.toMatch(/stockage à vérifier/iu);
    const late: StatusReport = {
      ...report,
      plans: { counts: { compliant: 0, late: 1, failed: 0 }, pending: 0, nonCompliant: [] },
      storage: { conditionalWrites: 'ignored' },
    };
    const banner = renderToStaticMarkup(<StatusView state={late} />);
    expect(banner).toContain('>1 plan en retard</strong>');
    expect(banner).toContain(CONDITIONAL_WRITES.summary);
    expect(html).toContain(`>Stockage à vérifier</strong>${CONDITIONAL_WRITES.summaryAlone}`);
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
