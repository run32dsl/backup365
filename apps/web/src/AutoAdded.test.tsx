import type { StatusReport } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusView } from './StatusView.js';

const base: StatusReport = {
  generatedAt: '2026-11-12T12:00:00.000Z',
  maxAgeHours: 26,
  alertCount: 0,
  rows: [],
};
const html = (report: StatusReport) => renderToStaticMarkup(<StatusView state={report} />);

describe('Sources : ajoutés automatiquement (issue #545)', () => {
  it('lists, per plan, the accounts and sites taken at its last run', () => {
    const page = html({
      ...base,
      autoAdded: [
        {
          planId: 'p',
          plan: 'Toute l’organisation',
          at: '2026-11-12T02:10:00Z',
          items: [
            { id: 'u-1', name: 'Sophie Bernard' },
            { id: 'site-x', name: null },
          ],
        },
      ],
    });
    expect(page).toContain('<h2>Ajoutés automatiquement</h2>');
    expect(page).toContain('Toute l’organisation</a>');
    expect(page).toContain('12/11/2026 02:10');
    expect(page).toContain('<li>Sophie Bernard</li>');
    expect(page).toContain('site-x (nom connu après sa première sauvegarde)');
  });

  it('says when nothing was added, shows an error when unknown, nothing for other roles', () => {
    expect(html({ ...base, autoAdded: [] })).toContain(
      'Aucun compte ni site ajouté à la dernière exécution',
    );
    expect(html({ ...base, autoAdded: null })).toContain('Éléments ajoutés indisponibles');
    expect(html(base)).not.toContain('Ajoutés automatiquement');
  });
});
