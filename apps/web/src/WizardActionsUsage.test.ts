import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { screen } from './testSources.js';

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('barre d’actions des parcours', () => {
  it('OneDrive et SharePoint n’utilisent plus dialog-actions hors dialogues', () => {
    for (const f of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      const src = screen(f);
      expect(src).toContain('<WizardActions');
      // Seule la boîte «\u202FVersions\u202F» de OneDrive garde dialog-actions.
      const count = (src.match(/dialog-actions/g) ?? []).length;
      expect(count).toBe(f === 'OneDrivePage.tsx' ? 1 : 0);
      expect(src).not.toContain('wizard-actions');
    }
  });

  it('la boîte Versions met Fermer avant l’action principale, sans primary-first', () => {
    const src = read('onedrive/VersionsDialog.tsx');
    expect(src.indexOf('onClick={onClose}')).toBeLessThan(src.indexOf('Choisir cette version\n'));
    expect(screen('OneDrivePage.tsx')).not.toContain('primary-first');
    for (const f of ['RestoreAction.tsx', 'charte.css']) {
      expect(read(f)).not.toContain('primary-first');
    }
  });

  it('l’assistant de plan utilise WizardActions', () => {
    const src = screen('PlansPage.tsx');
    expect(src).toContain('<WizardActions');
    expect(src).not.toContain('className="button-row wizard-actions"');
  });

  it('la barre du plan reste pleine largeur, comme OneDrive et SharePoint', () => {
    const css = read('charte.css');
    expect(css).toMatch(/\.wizard > :not\(\.wizard-actions\) \{\s*max-width: 40rem;/);
    expect(css).not.toMatch(/\.wizard \{\s*max-width/);
  });
});
