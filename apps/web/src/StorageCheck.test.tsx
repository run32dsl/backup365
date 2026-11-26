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

describe('Sources page: conditional writes of the storage (issue #567)', () => {
  it('says the storage honours them, without a warning', () => {
    const html = view({ conditionalWrites: 'supported' });
    expect(html).toContain('<h2 id="storage-title">Stockage</h2>');
    expect(html).toContain(CONDITIONAL_WRITES.supported);
    expect(html).not.toContain('alert-warning');
  });

  it('warns clearly when the storage ignores them, with what to do', () => {
    const html = view({ conditionalWrites: 'ignored' });
    expect(html).toContain('alert-warning');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Le stockage ignore les écritures conditionnelles');
    expect(html).toContain('deux opérations simultanées sur une même source');
    expect(html).toContain('Évitez de lancer une restauration pendant une sauvegarde');
  });

  it('says why they could not be checked, and never shows a code', () => {
    const notProbed = view({ conditionalWrites: 'not_probed' });
    expect(notProbed).toContain('Écritures conditionnelles non vérifiées');
    expect(notProbed).not.toMatch(/not_probed|supported|ignored/u);
    expect(view({ conditionalWrites: null })).toContain(CONDITIONAL_WRITES.unknown);
  });

  it('shows no storage section when the server sends none (other role, no storage)', () => {
    expect(view()).not.toContain('Stockage');
  });
});
