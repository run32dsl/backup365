import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('barre d’actions des parcours', () => {
  it('OneDrive et SharePoint n’utilisent plus dialog-actions hors dialogues', () => {
    for (const f of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      const src = read(f);
      expect(src).toContain('<WizardActions');
      // Seule la boîte «\u202FVersions\u202F» de OneDrive garde dialog-actions.
      const count = (src.match(/dialog-actions/g) ?? []).length;
      expect(count).toBe(f === 'OneDrivePage.tsx' ? 1 : 0);
      expect(src).not.toContain('wizard-actions');
    }
  });

  it('la boîte Versions met Fermer avant l’action principale, sans primary-first', () => {
    const src = read('OneDrivePage.tsx');
    expect(src.indexOf('onClick={onClose}')).toBeLessThan(src.indexOf('Choisir cette version\n'));
    for (const f of ['OneDrivePage.tsx', 'RestoreAction.tsx', 'charte.css']) {
      expect(read(f)).not.toContain('primary-first');
    }
  });

  it('l’assistant de plan utilise WizardActions', () => {
    const src = read('PlansPage.tsx');
    expect(src).toContain('<WizardActions');
    expect(src).not.toContain('className="button-row wizard-actions"');
  });

  it('la barre du plan reste pleine largeur, comme OneDrive et SharePoint', () => {
    const css = read('charte.css');
    expect(css).toMatch(/\.wizard > :not\(\.wizard-actions\) \{\s*max-width: 40rem;/);
    expect(css).not.toMatch(/\.wizard \{\s*max-width/);
  });
});
