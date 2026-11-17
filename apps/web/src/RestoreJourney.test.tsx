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
  RESULT_TITLES,
  RestoreResult,
  ResultList,
  ReasonField,
  reasonLabel,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';

const dir = new URL('./', import.meta.url);
const source = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const SCREENS = ['OneDrivePage.tsx', 'SharePointPage.tsx', 'RestoreAction.tsx'];

describe('restore journey', () => {
  it('uses the same three steps, all finished once the tracking starts', () => {
    expect(RESTORE_STEPS).toEqual(['Choisir', 'Motif', 'Confirmation']);
    expect([1, 2, 3, 4, 5].map(stepOf)).toEqual([1, 2, 3, 4, 4]);
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

  it.each([
    ['MailPage.tsx', 'de l’export'],
    ['ResetPassword.tsx', 'de la réinitialisation'],
    ['ComponentsPage.tsx', 'de l’export'],
  ])('%s reuses the reason block and the audit reminder', (name) => {
    const text = source(name);
    expect(text).toContain('<ReasonField');
    expect(text).toContain('<AuditReminder');
    expect(text).not.toContain('counterMax');
  });

  it('labels every reason "Motif … (obligatoire)" with the same help and counter', () => {
    for (const of of [
      'de la restauration',
      'du lancement',
      'de la réinitialisation',
      'de l’export',
    ]) {
      expect(reasonLabel(of)).toBe(`Motif ${of} (obligatoire)`);
    }
    const html = renderToStaticMarkup(
      <ReasonField of="de l’export" value="" onChange={() => undefined} />,
    );
    expect(html).toContain(REASON.help);
    expect(html).toContain(`0 / ${MAX_REASON_LENGTH}`);
    expect(html).not.toContain('*');
    const plans = source('PlansPage.tsx');
    expect(plans).toContain("reasonLabel('du lancement')");
    expect(plans).toContain('help={REASON.help}');
    expect(plans).toContain('counterMax={REASON.maxLength}');
    expect(plans).toContain('Précision (facultatif)');
    expect(plans).toContain('<AuditReminder />');
  });

  it('keeps the word « journalisée » out of the screens', () => {
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const f of files) {
      const code = source(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toContain('journalisée');
    }
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

describe('restore result', () => {
  it('shows one h2 title per status, followed by the labelled summary', () => {
    const titles = ['running', 'succeeded', 'failed'] as const;
    const heads = titles.map((s) =>
      renderToStaticMarkup(
        <RestoreResult status={s}>
          <ResultList rows={[['Emplacement', 'Images']]} />
        </RestoreResult>,
      ),
    );
    expect(heads[0]).toContain('<h2 id="restore-result-title">Restauration en cours</h2>');
    expect(heads[1]).toContain('>Restauration terminée</h2>');
    expect(heads[2]).toContain('>Restauration échouée</h2>');
    expect(heads[1]).toContain('<dt>Emplacement</dt><dd>Images</dd>');
    expect(Object.values(RESULT_TITLES)).toHaveLength(3);
  });

  it('is used by both OneDrive and SharePoint', () => {
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      expect(source(name)).toContain('<RestoreResult status={job.status}>');
    }
  });
});
