import { describe, expect, it } from 'vitest';
import { detailLabel } from './auditLabels.js';
import { successSummary } from './sharepoint.js';

describe('SharePoint restore summary', () => {
  it('agrees restored, kept and error counts on success, and omits zeros', () => {
    expect(successSummary(3, 1, 0, '2 s')).toBe(
      '3 éléments restaurés en 2 s. 1 élément déjà présent a été conservé.',
    );
    expect(successSummary(1, 2, 1, '2 s')).toBe(
      '1 élément restauré en 2 s. 2 éléments déjà présents ont été conservés. 1 élément en erreur.',
    );
    expect(successSummary(0, 0, 2, '1 s')).toBe(
      'Aucun élément restauré en 1 s. 2 éléments en erreur.',
    );
  });

  it('uses the same agreement in the audit label', () => {
    const head = (skipped: number, errors: number) =>
      detailLabel(`outcome=succeeded;duration_ms=2000;skipped=${skipped};errors=${errors}`);
    expect(head(0, 0)).toBe('Réussie, 2 s');
    expect(head(0, 2)).toBe('Réussie, 2 s, 2 éléments en erreur');
    expect(head(1, 0)).toBe('Réussie, 2 s, 1 élément conservé');
    expect(head(1, 1)).toBe('Réussie, 2 s, 1 élément conservé, 1 élément en erreur');
    expect(head(3, 2)).toBe('Réussie, 2 s, 3 éléments conservés, 2 éléments en erreur');
  });
});
