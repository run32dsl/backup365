import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CredentialsView } from './LoginPage.js';
import { MICROSOFT_LABEL, loadOidcEnabled, oidcErrorMessage } from './session.js';

describe('connexion avec un compte Microsoft', () => {
  it('shows the button under the local form only when configured, never on first start', () => {
    const on = renderToString(<CredentialsView mode="login" microsoft />);
    expect(on).toContain(MICROSOFT_LABEL);
    expect(on).toContain('href="/api/auth/oidc/login"');
    expect(on).toContain('Se connecter'); // le formulaire local reste
    expect(renderToString(<CredentialsView mode="login" />)).not.toContain(MICROSOFT_LABEL);
    expect(renderToString(<CredentialsView mode="setup" microsoft />)).not.toContain(
      MICROSOFT_LABEL,
    );
  });

  it('shows a Microsoft refusal as an error alert titled «\u202FAccès refusé\u202F»', () => {
    const message = oidcErrorMessage('?oidc_error=no_group') ?? '';
    const html = renderToString(<CredentialsView mode="login" microsoft refusal={message} />);
    expect(html).toContain('class="alert alert-error" role="alert"');
    expect(html).toContain('✖');
    expect(html).toContain('Accès refusé');
    expect(html).toContain('aucun groupe autorisé');
    expect(renderToString(<CredentialsView mode="login" />)).not.toContain('Accès refusé');
  });

  it('puts the product name above a card and separates the two buttons with «\u202Fou\u202F»', () => {
    const html = renderToString(<CredentialsView mode="login" microsoft />);
    expect(html).toContain('backup365');
    expect(html).toContain('Console de sauvegarde Microsoft 365');
    expect(html).toContain('class="auth-or" aria-hidden="true">ou<');
    expect(html.indexOf('Se connecter<')).toBeLessThan(html.indexOf('auth-or'));
    expect(html.indexOf('auth-or')).toBeLessThan(html.indexOf(MICROSOFT_LABEL));
  });

  it('reads the refusal code from the address, in French', () => {
    expect(oidcErrorMessage('?oidc_error=no_group')).toContain('aucun groupe autorisé');
    expect(oidcErrorMessage('?oidc_error=inconnu')).toContain('a échoué');
    expect(oidcErrorMessage('')).toBeUndefined();
  });

  it('treats a status error as disabled', async () => {
    const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
    expect(await loadOidcEnabled(() => reply({ enabled: true }))).toBe(true);
    expect(await loadOidcEnabled(() => reply({ enabled: false }))).toBe(false);
    expect(await loadOidcEnabled(() => reply({}, 503))).toBe(false);
    expect(await loadOidcEnabled(() => Promise.reject(new Error('réseau')))).toBe(false);
  });
});
