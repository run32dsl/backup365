import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenOf } from './App.js';
import { AccountsView } from './AccountsPage.js';
import { CredentialsView, Field, PasswordView } from './LoginPage.js';
import { createAccount, resetPassword } from './accounts.js';
import {
  LOGIN_HASH,
  authenticate,
  errorMessage,
  loadGate,
  lossMessage,
  requestedPage,
  withSession,
} from './session.js';

const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

describe('CredentialsView', () => {
  it('shows the first-start screen with a password confirmation', () => {
    const html = renderToString(<CredentialsView mode="setup" />);
    expect(html).toContain('Créer le compte administrateur');
    expect(html).toContain('name="confirm"');
    expect(html).toContain('autoComplete="new-password"');
  });

  it('shows the sober login screen, in French, with no prefilled value', () => {
    const html = renderToString(<CredentialsView mode="login" error="Nom incorrect" />);
    expect(html).toContain('Connexion');
    expect(html).toContain('Se connecter');
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('value=');
    expect(html).not.toContain('name="confirm"');
  });
});

describe('PasswordView', () => {
  it('explains the forced change after a reset', () => {
    expect(renderToString(<PasswordView forced />)).toContain('réinitialisé');
    expect(renderToString(<PasswordView forced={false} />)).not.toContain('réinitialisé');
  });
});

describe('AccountsView', () => {
  const accounts = [
    {
      id: 1,
      username: 'root',
      role: 'admin' as const,
      disabled: false,
      mustChangePassword: false,
      createdAt: '',
    },
    {
      id: 2,
      username: 'bob',
      role: 'operator' as const,
      disabled: true,
      mustChangePassword: false,
      createdAt: '',
    },
  ];
  it('lists accounts with their role and state, and escapes names', () => {
    const html = renderToString(
      <AccountsView state={[...accounts, { ...accounts[0]!, id: 3, username: '<img src=x>' }]} />,
    );
    expect(html).toContain('Administrateur');
    expect(html).toContain('Désactivé');
    expect(html).toContain('Réactiver');
    expect(html).not.toContain('<img');
  });
  it('shows loading and error states', () => {
    expect(renderToString(<AccountsView state="loading" />)).toContain('Chargement');
    expect(renderToString(<AccountsView state="error" />)).toContain('indisponibles');
  });
});

describe('screenOf', () => {
  it('knows the accounts and password screens', () => {
    expect(screenOf('#/accounts')).toBe('accounts');
    expect(screenOf('#/password')).toBe('password');
  });
});

describe('loadGate', () => {
  it('returns the session when /me answers 200', async () => {
    const fetchFn = vi.fn(() =>
      reply({ csrfToken: 't', user: { username: 'alice', role: 'operator' } }),
    ) as unknown as typeof fetch;
    await expect(loadGate(fetchFn)).resolves.toMatchObject({ status: 'ready' });
  });

  it('shows the login screen on 401, or the first-start screen when no account exists', async () => {
    const make = (needsSetup: boolean) =>
      vi.fn((url: string) =>
        url.endsWith('/me') ? reply({ error: 'unauthenticated' }, 401) : reply({ needsSetup }),
      ) as unknown as typeof fetch;
    await expect(loadGate(make(false))).resolves.toEqual({ status: 'login' });
    await expect(loadGate(make(true))).resolves.toEqual({ status: 'setup' });
  });

  it('reports an error on any other answer', async () => {
    const fetchFn = (() => reply({}, 503)) as typeof fetch;
    await expect(loadGate(fetchFn)).resolves.toEqual({ status: 'error' });
  });
});

describe('authenticate', () => {
  it('posts the credentials and returns the session', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      reply({ csrfToken: 't', user: { username: 'alice', role: 'admin' } }),
    );
    const out = await authenticate('login', 'alice', 'secret secret', fetchFn);
    expect(out).toMatchObject({ ok: true, value: { csrfToken: 't' } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/login');
    expect(init?.body).toBe(JSON.stringify({ username: 'alice', password: 'secret secret' }));
  });

  it('explains failures in French', async () => {
    const bad = (() => reply({ error: 'invalid_credentials' }, 401)) as typeof fetch;
    await expect(authenticate('login', 'a', 'b', bad)).resolves.toEqual({
      ok: false,
      message: 'Identifiant ou mot de passe incorrect.',
    });
    const locked = (() =>
      reply({ error: 'too_many_attempts', retryAfterSec: 30 }, 429)) as typeof fetch;
    const out = await authenticate('login', 'a', 'b', locked);
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('30 secondes') });
  });
});

describe('maquette de l’issue #22', () => {
  it('labels the login field « Identifiant », never « Nom d’utilisateur »', () => {
    for (const mode of ['login', 'setup'] as const) {
      const html = renderToString(<CredentialsView mode={mode} />);
      expect(html).toContain('Identifiant');
      expect(html).not.toContain('utilisateur');
    }
    const accounts = renderToString(<AccountsView state={[]} />);
    expect(accounts).toContain('Identifiant');
    expect(accounts).not.toContain('Nom d’utilisateur');
  });

  it('offers Afficher / Masquer on password fields only', () => {
    const hidden = renderToString(
      <Field label="Mot de passe" name="password" type="password" autoComplete="off" />,
    );
    expect(hidden).toContain('type="password"');
    expect(hidden).toContain('aria-pressed="false"');
    expect(hidden).toContain('Afficher');
    const shown = renderToString(
      <Field label="Mot de passe" name="password" type="password" autoComplete="off" revealed />,
    );
    expect(shown).toContain('type="text"');
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).toContain('Masquer');
    const plain = renderToString(<Field label="Identifiant" name="username" autoComplete="off" />);
    expect(plain).not.toContain('Afficher');
    // Chaque mot de passe de chaque écran a son bouton.
    expect(renderToString(<CredentialsView mode="setup" />).match(/Afficher</g)).toHaveLength(2);
    expect(renderToString(<PasswordView forced />).match(/Afficher</g)).toHaveLength(3);
  });

  it('gives each lost session its message on the login screen', () => {
    expect(lossMessage('expired')).toBe('Votre session a expiré. Reconnectez-vous.');
    expect(lossMessage('invalid')).toBe('Votre session n’est plus valide. Reconnectez-vous.');
    const html = renderToString(<CredentialsView mode="login" notice={lossMessage('expired')} />);
    expect(html).toContain('<p role="status">Votre session a expiré. Reconnectez-vous.</p>');
    expect(renderToString(<CredentialsView mode="login" />)).not.toContain('expiré');
  });

  it('remembers the requested page, never the login anchor itself', () => {
    expect(requestedPage('#/audit')).toBe('#/audit');
    expect(requestedPage('#/mail/boite/message')).toBe('#/mail/boite/message');
    expect(requestedPage(LOGIN_HASH)).toBeNull();
    expect(LOGIN_HASH).toBe('#/connexion');
    expect(requestedPage('')).toBeNull();
    expect(requestedPage('#autre')).toBeNull();
  });

  it('sends the typed passwords to the unchanged account routes', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => reply({}));
    await createAccount('bob', 'un mot de passe long', 'operator', fetchFn);
    await resetPassword(2, 'un autre mot de passe', fetchFn);
    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.body])).toEqual([
      [
        '/api/accounts',
        JSON.stringify({ username: 'bob', password: 'un mot de passe long', role: 'operator' }),
      ],
      ['/api/accounts/2/reset-password', JSON.stringify({ password: 'un autre mot de passe' })],
    ]);
  });

  it('gives the account forms an Afficher / Masquer button on every password', () => {
    const html = renderToString(<AccountsView state={[]} />);
    expect(html.match(/Afficher</g)).toHaveLength(2);
    expect(html).toContain('Identifiant');
  });
});

describe('errorMessage', () => {
  it('uses the PO wording for a taken identifier', async () => {
    const res = await reply({ error: 'username_taken' }, 409);
    expect(await errorMessage(res)).toBe('Cet identifiant est déjà utilisé.');
  });
});

describe('withSession', () => {
  it('adds the CSRF token to requests that change state, not to reads', async () => {
    const base = vi.fn<typeof fetch>(() => reply({}));
    const wrapped = withSession(
      base,
      () => 'jeton',
      () => undefined,
    );
    await wrapped('/api/x');
    await wrapped('/api/x', { method: 'POST' });
    await wrapped('/api/x', { method: 'delete' });
    const sent = base.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-csrf-token'));
    expect(sent).toEqual([null, 'jeton', 'jeton']);
  });

  it('signals an expired session on a 401, except for the login routes', async () => {
    const expired = vi.fn();
    const wrapped = withSession((() => reply({}, 401)) as typeof fetch, () => null, expired);
    await wrapped('/api/audit');
    expect(expired).toHaveBeenCalledTimes(1);
    await wrapped('/api/auth/login', { method: 'POST' });
    await wrapped('/api/auth/me');
    await wrapped('/api/auth/logout', { method: 'POST' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith('expired');
  });

  it('signals an invalid session on a CSRF refusal, leaving the body readable', async () => {
    const lost = vi.fn();
    const refused = (() => reply({ error: 'csrf_invalid' }, 403)) as typeof fetch;
    const res = await withSession(refused, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(lost).toHaveBeenCalledExactlyOnceWith('invalid');
    await expect(res.json()).resolves.toEqual({ error: 'csrf_invalid' });
    // Les autres refus 403 ne ferment pas la session.
    const other = (() => reply({ error: 'password_change_required' }, 403)) as typeof fetch;
    await withSession(other, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(lost).toHaveBeenCalledTimes(1);
    // Un 403 sans corps JSON n'est pas un refus CSRF et ne casse pas la requête.
    const empty = (() => Promise.resolve(new Response('', { status: 403 }))) as typeof fetch;
    const res403 = await withSession(empty, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(res403.status).toBe(403);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
