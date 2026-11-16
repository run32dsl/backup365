import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResetReasonForm, TemporaryPasswordView } from './ResetPassword.js';

describe('réinitialisation : étape 2', () => {
  it('summarises the account, asks for a reason and says it is audited without the password', () => {
    const html = renderToStaticMarkup(<ResetReasonForm username="jean.exemple" />);
    expect(html).toContain('jean.exemple');
    expect(html).toContain('Motif (obligatoire)');
    expect(html).toContain('affiché une seule fois');
    expect(html).toContain('Cette action sera journalisée (sans le mot de passe).');
    expect(html).toContain('>Réinitialiser</button>');
    expect(html).toContain('>Annuler</button>');
  });

  it('shows the missing-reason error linked to the field', () => {
    const html = renderToStaticMarkup(
      <ResetReasonForm username="jean.exemple" error="Indiquez un motif." />,
    );
    expect(html).toContain('Indiquez un motif.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby');
  });
});

describe('réinitialisation : étape 3', () => {
  const password = 'Tz7k-Qp3m-Vx9d-Lw2h';

  it('shows the password once, in a labelled box, with Copier and the confirmation box', () => {
    const html = renderToStaticMarkup(<TemporaryPasswordView password={password} />);
    expect(html).toContain(password);
    expect(html).toContain('aria-label="Mot de passe temporaire"');
    expect(html).toContain('Affiché une seule fois. Il ne pourra plus être consulté.');
    expect(html).toContain('>Copier</button>');
    expect(html).toContain('J’ai transmis le mot de passe');
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Terminer/);
  });

  it('enables Terminer once the box is checked, and reports a copy', () => {
    const html = renderToStaticMarkup(<TemporaryPasswordView password={password} handed copied />);
    expect(html).not.toMatch(/aria-disabled="true"[^>]*>Terminer/);
    expect(html).toContain('>Copié</button>');
  });

  it('explains a failed copy and keeps the text selectable', () => {
    const html = renderToStaticMarkup(<TemporaryPasswordView password={password} copyFailed />);
    expect(html).toContain(
      'Copie impossible. Sélectionnez le mot de passe et copiez-le manuellement.',
    );
    expect(html).toContain(password);
  });
});
