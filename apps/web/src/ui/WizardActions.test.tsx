import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.js';
import { WIZARD_LABELS, WizardActions } from './WizardActions.js';

describe('WizardActions', () => {
  it('puts the back action first and the primary action last', () => {
    const html = renderToStaticMarkup(
      <WizardActions back={<Button variant="secondary">{WIZARD_LABELS.back}</Button>}>
        <Button>{WIZARD_LABELS.next}</Button>
      </WizardActions>,
    );
    expect(html).toContain('class="wizard-actions"');
    expect(html.indexOf('Précédent')).toBeLessThan(html.indexOf('Continuer'));
    expect(html).toContain('btn-secondary');
  });

  it('renders the primary action alone on the first step', () => {
    const html = renderToStaticMarkup(
      <WizardActions>
        <Button>{WIZARD_LABELS.next}</Button>
      </WizardActions>,
    );
    expect(html).not.toContain('Précédent');
    expect(html).toContain('Continuer');
  });

  it('uses one label to go forward and one to go back', () => {
    expect(WIZARD_LABELS).toEqual({ back: 'Précédent', next: 'Continuer' });
  });
});
