import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenOf } from './App.js';
import { AccountsView } from './AccountsPage.js';
import { CredentialsView, PasswordView } from './LoginPage.js';
import { authenticate, loadGate, withSession } from './session.js';

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
      message: 'Nom d’utilisateur ou mot de passe incorrect.',
    });
    const locked = (() =>
      reply({ error: 'too_many_attempts', retryAfterSec: 30 }, 429)) as typeof fetch;
    const out = await authenticate('login', 'a', 'b', locked);
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('30 secondes') });
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
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
