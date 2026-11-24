import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert, alertRole } from './Alert.js';
import { EmptyState } from './EmptyState.js';
import { StatusPill } from './StatusPill.js';
import { Steps } from './Steps.js';

describe('Alert', () => {
  it('uses role alert for error and warning, status for information and success', () => {
    expect(alertRole('error')).toBe('alert');
    expect(alertRole('warning')).toBe('alert');
    expect(alertRole('info')).toBe('status');
    expect(alertRole('success')).toBe('status');
    expect(renderToStaticMarkup(<Alert tone="error">Oups</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert tone="success">Ok</Alert>)).toContain('role="status"');
  });

  it('pairs an icon with the text and offers an action', () => {
    const html = renderToStaticMarkup(
      <Alert tone="warning" action={<button>Réessayer</button>}>
        Avertissement : à voir.
      </Alert>,
    );
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
    expect(html).toContain('Avertissement : à voir.');
    expect(html).toContain('Réessayer');
  });

  it('renders the title in its own element, before the text, inside the same alert', () => {
    const html = renderToStaticMarkup(
      <Alert tone="warning" title="Sauvegardes inaccessibles">
        Prévenez un administrateur.
      </Alert>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('<strong class="alert-title">Sauvegardes inaccessibles</strong>');
    expect(html.indexOf('alert-title')).toBeLessThan(html.indexOf('Prévenez'));
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('alert-title'));
    expect(renderToStaticMarkup(<Alert tone="info">Ok</Alert>)).not.toContain('<strong');
  });
});

describe('EmptyState', () => {
  it('shows a sentence in a status region and at most one action', () => {
    const html = renderToStaticMarkup(
      <EmptyState action={<button>Ajouter</button>}>Aucun compte pour l’instant.</EmptyState>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Aucun compte pour l’instant.');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe('Steps', () => {
  const steps = ['Choisir', 'Vérifier', 'Confirmer'];
  it('is an ordered list with aria-current on the current step only', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={2} />);
    expect(html).toContain('<ol>');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Étape 2 sur 3 : Vérifier');
    expect(html).toMatch(/aria-current="step"[^>]*><span aria-hidden="true">●<\/span> Vérifier/);
  });

  it('marks finished steps with an icon and a text for screen readers', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={2} />);
    expect(html).toContain('✔');
    expect(html).toContain('(terminée)');
  });

  it('has a finished state: no current step, every step marked as done', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={4} />);
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('Étape ');
    expect(html).not.toContain('●');
    expect(html.match(/\(terminée\)/g)).toHaveLength(3);
    expect(html.match(/✔/g)).toHaveLength(3);
  });
});

describe('StatusPill', () => {
  it.each([
    ['compliant', '✔', 'À jour'],
    ['late', '⚠', 'En retard'],
    ['failed', '✖', 'En échec'],
    ['running', '↻', 'En cours'],
    ['pending', '◷', 'En attente'],
  ] as const)('%s pairs an icon with a text', (status, icon, label) => {
    const html = renderToStaticMarkup(<StatusPill status={status} />);
    expect(html).toContain(`<span aria-hidden="true">${icon}</span>`);
    expect(html).toContain(label);
  });

  it('accepts a custom label', () => {
    expect(renderToStaticMarkup(<StatusPill status="compliant" label="À jour" />)).toContain(
      'À jour',
    );
  });
});
