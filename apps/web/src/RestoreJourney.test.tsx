import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_REASON_LENGTH } from './mail.js';
import {
  AUDIT_REMINDER,
  AuditReminder,
  REASON,
  REASON_EXAMPLES,
  RESTORE_BUTTONS,
  RESTORE_STEPS,
  RESULT_TITLES,
  RestoreResult,
  ReasonField,
  reasonLabel,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';
import { ResultList } from './ui/index.js';

const dir = new URL('./', import.meta.url);
const source = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const SCREENS = ['OneDrivePage.tsx', 'SharePointPage.tsx', 'RestoreAction.tsx'];

describe('restore journey', () => {
  it('uses the same three steps, all finished once the tracking starts', () => {
    expect(RESTORE_STEPS).toEqual(['Choisir', 'Motif', 'Récapitulatif']);
    expect([1, 2, 3, 4, 5].map(stepOf)).toEqual([1, 2, 3, 4, 4]);
  });

  it('renders one reason block, limited by the same constant', () => {
    const html = renderToStaticMarkup(
      <ReasonField placeholder={REASON_EXAMPLES.restore} value="" onChange={() => undefined} />,
    );
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
    ['ComponentsPage.tsx', 'de l’export'],
  ])('%s reuses the reason block and the audit reminder', (name) => {
    const text = source(name);
    expect(text).toContain('<ReasonField');
    expect(text).toContain('<AuditReminder');
    expect(text).not.toContain('counterMax');
  });

  it('keeps the audit reminder out of actions that do not touch a backed-up item', () => {
    expect(source('ResetPassword.tsx')).not.toContain('AuditReminder');
    expect(source('ResetPassword.tsx')).toContain('<ReasonField');
    expect(source('PlansPage.tsx')).not.toContain('AuditReminder');
  });

  it('shows the reminder in the restore dialog only on the input step', () => {
    const text = source('RestoreAction.tsx');
    expect(text).toContain('{job === null && <AuditReminder />}');
    expect(text.match(/<AuditReminder/g)).toHaveLength(1);
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
      <ReasonField
        of="de l’export"
        placeholder={REASON_EXAMPLES.export}
        value=""
        onChange={() => undefined}
      />,
    );
    expect(html).toContain(REASON.help);
    expect(html).toContain(`0 / ${MAX_REASON_LENGTH}`);
    expect(html).not.toContain('*');
    const plans = source('PlansPage.tsx');
    expect(plans).toMatch(/<ReasonField\s+of="du lancement"/);
    expect(plans).not.toContain('RUN_REASONS');
    expect(plans).not.toContain('id="run-reason"');
    expect(plans).not.toContain('AuditReminder');
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
    expect(html).toContain('alert-info');
    expect(html.indexOf('alert-info')).toBeLessThan(html.indexOf('role="progressbar"'));
    expect(html).toContain('Vous pouvez quitter cette page, la restauration continue.');
    expect(html).not.toContain('Restauration en cours');
    expect(renderToStaticMarkup(<RunningProgress detail="5 éléments à traiter" />)).toContain(
      '5 éléments à traiter. Vous pouvez quitter cette page, la restauration continue.',
    );
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      const text = source(name);
      expect(text).not.toContain('<p>Vous pouvez quitter cette page');
      // Le lien du journal d'audit figure à l'état en cours, terminé et échoué.
      expect(text.match(/\{B\.audit\}/g)?.length).toBeGreaterThanOrEqual(3);
    }
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

describe('reason examples', () => {
  const ACTIONS = Object.entries(REASON_EXAMPLES);

  it('gives each kind of action its own short example', () => {
    expect(new Set(Object.values(REASON_EXAMPLES)).size).toBe(ACTIONS.length);
    for (const [action, example] of ACTIONS) {
      expect(example.length, action).toBeLessThanOrEqual(40);
    }
  });

  it('keeps « suppression » out of every example except the restore one', () => {
    for (const [action, example] of ACTIONS) {
      if (action !== 'restore') expect(example, action).not.toMatch(/suppression/i);
    }
  });

  it('renders the example it receives as the placeholder', () => {
    for (const [action, example] of ACTIONS) {
      const html = renderToStaticMarkup(
        <ReasonField placeholder={example} value="" onChange={() => undefined} />,
      );
      expect(html, action).toContain(`placeholder="${example}"`);
    }
  });

  it('passes an explicit example at every use of ReasonField', () => {
    const files = readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    let uses = 0;
    for (const f of files) {
      for (const tag of source(f).match(/<ReasonField[\s\S]*?\/>/g) ?? []) {
        uses += 1;
        expect(tag, f).toMatch(/placeholder=\{[^}]*REASON_EXAMPLES\.\w+/);
      }
    }
    expect(uses).toBeGreaterThanOrEqual(9);
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
    expect(heads[0]).toContain('>Restauration en cours</h2>');
    expect(heads[1]).toContain('>Restauration terminée</h2>');
    expect(heads[2]).toContain('>Restauration échouée</h2>');
    expect(heads[1]).toContain('<dt>Emplacement</dt><dd>Images</dd>');
    expect(Object.values(RESULT_TITLES)).toHaveLength(3);
  });

  it('says « Restauration en cours » once in a running result, whatever the journey', () => {
    for (const detail of [undefined, '5 éléments à traiter']) {
      const html = renderToStaticMarkup(
        <RestoreResult status="running">
          <RunningProgress detail={detail} />
        </RestoreResult>,
      );
      expect(html.match(/Restauration en cours/g)).toHaveLength(1);
    }
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx', 'RestoreAction.tsx']) {
      expect(source(name)).toContain('<RunningProgress');
    }
    expect(source('OneDrivePage.tsx')).not.toContain('Restauration terminée');
  });

  it('is used by both OneDrive and SharePoint', () => {
    for (const name of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      expect(source(name)).toContain('<RestoreResult status={job.status}>');
    }
  });

  it.each(['running', 'succeeded', 'failed'] as const)(
    'shows no step indicator on the %s result',
    (status) => {
      const html = renderToStaticMarkup(
        <RestoreResult status={status}>
          <ResultList rows={[['Emplacement', 'Images']]} />
        </RestoreResult>,
      );
      expect(html).not.toContain('aria-current="step"');
      expect(html).not.toContain('<ol');
      expect(html).not.toContain('Toutes les étapes sont terminées');
    },
  );

  it.each(['OneDrivePage.tsx', 'SharePointPage.tsx'])(
    '%s hides the steps as soon as a job exists',
    (name) => {
      expect(source(name)).toMatch(/\{journey && !job && \(\s*<Steps/);
      expect(source(name)).not.toContain('{journey && <Steps');
    },
  );
});
