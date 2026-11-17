import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_REASON_LENGTH } from './mail.js';
import {
  AUDIT_REMINDER,
  AuditReminder,
  REASON,
  RESTORE_BUTTONS,
  RESTORE_STEPS,
  ReasonField,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';

const dir = new URL('./', import.meta.url);
const source = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const SCREENS = ['OneDrivePage.tsx', 'SharePointPage.tsx', 'RestoreAction.tsx'];

describe('restore journey', () => {
  it('uses the same three steps and keeps the tracking on the last one', () => {
    expect(RESTORE_STEPS).toEqual(['Choisir', 'Motif', 'Confirmation']);
    expect([1, 2, 3, 4].map(stepOf)).toEqual([1, 2, 3, 3]);
  });

  it('renders one reason block, limited by the same constant', () => {
    const html = renderToStaticMarkup(<ReasonField value="" onChange={() => undefined} />);
    expect(REASON.maxLength).toBe(MAX_REASON_LENGTH);
    expect(html).toContain('Motif de la restauration (obligatoire)');
    expect(html).toContain(`maxLength="${MAX_REASON_LENGTH}"`);
    expect(html).toContain('Ce motif sera inscrit au journal d’audit.');
  });

  it.each(SCREENS)('%s uses the shared reason block and has no field of its own', (name) => {
    const text = source(name);
    expect(text).toContain('ReasonField');
    expect(text).not.toContain('counterMax');
  });

  it('shows the audit reminder of the charter in an information alert', () => {
    const html = renderToStaticMarkup(<AuditReminder />);
    expect(html).toContain('alert-info');
    expect(html).toContain(AUDIT_REMINDER);
    expect(AUDIT_REMINDER).toBe(
      'Chaque consultation, export ou restauration est inscrite au journal d’audit.',
    );
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx', 'RestoreAction.tsx']) {
      expect(source(name)).toContain('<AuditReminder />');
    }
  });

  it('shows one progress indicator while a restoration runs', () => {
    const html = renderToStaticMarkup(<RunningProgress />);
    expect(html).toContain('role="progressbar"');
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      expect(source(name)).toContain('<RunningProgress');
    }
  });

  it('has no old wording, no missing glyph and no other audit sentence in the sources', () => {
    const banned = [
      'Ouvrir le journal d’audit',
      'Voir le journal d’audit',
      'Restaurer autre chose',
      'Lancer la restauration',
      'Restaurer la sélection',
      'ⓘ',
      'est tracée : motif, opérateur',
      'sont enregistrées : qui, quoi, quand, pourquoi',
    ];
    const files = readdirSync(dir).filter(
      (f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'),
    );
    for (const file of files) {
      const text = source(file);
      for (const phrase of banned) expect(text, `${file}: ${phrase}`).not.toContain(phrase);
    }
    expect(Object.values(RESTORE_BUTTONS)).not.toContain('Retour');
  });
});
