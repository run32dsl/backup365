import { describe, expect, it } from 'vitest';
import { selectionLabel, WHOLE_SITE_SELECTION } from './selection.js';

describe('selectionLabel', () => {
  it('names the type then the name only, without path', () => {
    expect(selectionLabel({ kind: 'file', name: 'plan-a.pdf' })).toBe(
      'Sélection : fichier « plan-a.pdf »',
    );
    expect(selectionLabel({ kind: 'folder', name: '2025' })).toBe('Sélection : dossier « 2025 »');
    expect(selectionLabel({ kind: 'library', name: 'Documents partagés' })).toBe(
      'Sélection : bibliothèque « Documents partagés »',
    );
    expect(WHOLE_SITE_SELECTION).toBe('Sélection : le site entier');
  });

  it('appends the chosen version', () => {
    expect(
      selectionLabel({ kind: 'file', name: 'budget.xlsx', versionAt: '19/11/2026 21:16' }),
    ).toBe('Sélection : fichier « budget.xlsx », version du 19/11/2026 21:16 UTC');
  });
});
