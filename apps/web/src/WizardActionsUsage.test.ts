import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('barre d’actions des parcours', () => {
  it('OneDrive et SharePoint n’utilisent plus dialog-actions hors dialogues', () => {
    for (const f of ['OneDrivePage.tsx', 'SharePointPage.tsx']) {
      const src = read(f);
      expect(src).toContain('<WizardActions');
      // Seule la boîte « Versions » de OneDrive garde dialog-actions.
      const count = (src.match(/dialog-actions/g) ?? []).length;
      expect(count).toBe(f === 'OneDrivePage.tsx' ? 1 : 0);
      expect(src).not.toContain('wizard-actions');
    }
  });

  it('l’assistant de plan utilise WizardActions', () => {
    const src = read('PlansPage.tsx');
    expect(src).toContain('<WizardActions');
    expect(src).not.toContain('className="button-row wizard-actions"');
  });
});
