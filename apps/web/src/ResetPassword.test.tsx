import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResetReasonForm, TemporaryPasswordStep, TemporaryPasswordView } from './ResetPassword.js';

describe('réinitialisation : étape 2', () => {
  it('summarises the account, asks for a reason and says it is audited without the password', () => {
    const html = renderToStaticMarkup(<ResetReasonForm username="jean.exemple" />);
    expect(html).toContain('jean.exemple');
    expect(html).toContain('Motif de la réinitialisation (obligatoire)');
    expect(html).toContain('affiché une seule fois');
    expect(html).toContain('Ce motif sera inscrit au journal d’audit.');
    expect(html).not.toContain('Chaque consultation');
    expect(html).not.toContain('alert-info');
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
    const html = renderToStaticMarkup(
      <TemporaryPasswordView username="jean.exemple" password={password} />,
    );
    expect(html).toContain(password);
    expect(html).toContain('aria-label="Mot de passe temporaire"');
    // Hors de l'ordre de tabulation : le focus initial est sur «\u202FCopier\u202F» (e2e).
    expect(html).not.toContain('tabindex');
    expect(html).toContain('Affiché une seule fois. Il ne pourra plus être consulté.');
    expect(html).toContain('>Copier</button>');
    expect(html).toContain('J’ai transmis le mot de passe');
    expect(html).toContain('<dt>Compte</dt><dd>jean.exemple</dd>');
    expect(html.match(/jean\.exemple/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Terminer/);
    expect(html).toMatch(/<button[^>]*btn-primary[^>]*>Terminer/);
  });

  it('wraps the checkbox in a label.choice carrying the text, so a click on the text checks it', () => {
    const html = renderToStaticMarkup(
      <TemporaryPasswordView username="jean.exemple" password={password} />,
    );
    expect(html).toMatch(
      /<label class="choice"><input type="checkbox"[^>]*\/>J’ai transmis le mot de passe<\/label>/,
    );
  });

  it('enables Terminer once the box is checked, and reports a copy', () => {
    const html = renderToStaticMarkup(
      <TemporaryPasswordView username="jean.exemple" password={password} handed copied />,
    );
    expect(html).not.toMatch(/disabled[^>]*>Terminer/);
    expect(html).toContain('>Copié</button>');
  });

  it('is the same step after a creation and after a reset: one component, closed by the box', () => {
    const step = renderToStaticMarkup(
      <TemporaryPasswordStep
        username="jean.exemple"
        password={password}
        onHanded={() => undefined}
        onDone={() => undefined}
      />,
    );
    const view = renderToStaticMarkup(
      <TemporaryPasswordView username="jean.exemple" password={password} />,
    );
    expect(step).toBe(view);
    expect(step).toContain('<dt>Compte</dt><dd>jean.exemple</dd>');
    expect(step.match(/jean\.exemple/g)).toHaveLength(1);
    expect(step).toMatch(/<button[^>]*disabled=""[^>]*>Terminer/);
  });

  it('explains a failed copy and keeps the text selectable', () => {
    const html = renderToStaticMarkup(
      <TemporaryPasswordView username="jean.exemple" password={password} copyFailed />,
    );
    expect(html).toContain(
      'Copie impossible. Sélectionnez le mot de passe et copiez-le manuellement.',
    );
    expect(html).toContain(password);
  });
});
