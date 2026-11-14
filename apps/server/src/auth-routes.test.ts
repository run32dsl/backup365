import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { buildApp } from './app.js';
import { TEST_PASSWORD, addAccount, sessionFor, testAuth } from './test-support.js';

function setup() {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const app = buildApp({ version: '1', auth, audit });
  return { auth, audit, app };
}

async function entries(audit: SqliteAuditLog) {
  return (await audit.list({ limit: 100, offset: 0 })).items.reverse();
}

const post = (app: FastifyInstance, url: string, payload: unknown, headers = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

function loginBody(res: { json: () => unknown }) {
  return res.json() as { csrfToken: string; user: { username: string; role: string } };
}

describe('sans session', () => {
  it('answers 401 on every API route except health and the login routes', async () => {
    const { app } = setup();
    for (const [method, url] of [
      ['GET', '/api/audit'],
      ['GET', '/api/mailboxes'],
      ['GET', '/api/snapshots/x'],
      ['GET', '/api/search?q=a'],
      ['GET', '/api/status'],
      ['GET', '/api/mails/a/b'],
      ['POST', '/api/mails/a/b/export'],
      ['GET', '/api/accounts'],
      ['POST', '/api/accounts'],
      ['GET', '/api/auth/me'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/auth/password'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/auth/setup-status')).statusCode).toBe(200);
  });

  it('answers 401 whatever the method, including HEAD, OPTIONS and unknown routes', async () => {
    const { app } = setup();
    for (const [method, url] of [
      ['HEAD', '/api/audit'],
      ['OPTIONS', '/api/audit'],
      ['PUT', '/api/inconnu'],
      ['DELETE', '/api/accounts/1'],
      ['PATCH', '/api/accounts/1'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('refuses a forged, garbled or expired cookie', async () => {
    const { app } = setup();
    for (const cookie of ['b365_session=forge', 'b365_session=', 'autre=1', ';;=;']) {
      const res = await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie } });
      expect(res.statusCode, cookie).toBe(401);
    }
  });

  it('answers 503 on the whole API (health excepted) when accounts are unavailable', async () => {
    const app = buildApp({ version: '1', audit: SqliteAuditLog.open(':memory:') });
    expect((await app.inject('/api/audit')).statusCode).toBe(503);
    expect((await app.inject('/api/auth/login')).statusCode).toBe(503);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });
});

describe('premier démarrage', () => {
  it('creates the first administrator once, signs them in, and closes the route', async () => {
    const { app, audit } = setup();
    expect((await app.inject('/api/auth/setup-status')).json()).toEqual({ needsSetup: true });
    const res = await post(app, '/api/auth/setup', { username: 'root', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(201);
    expect(loginBody(res).user).toEqual({ username: 'root', role: 'admin' });
    expect(String(res.headers['set-cookie'])).toContain('b365_session=');
    expect((await app.inject('/api/auth/setup-status')).json()).toEqual({ needsSetup: false });
    const again = await post(app, '/api/auth/setup', {
      username: 'autre',
      password: TEST_PASSWORD,
    });
    expect(again.statusCode).toBe(409);
    expect((await entries(audit)).map((e) => [e.actor, e.action])).toEqual([
      ['root', 'account.create'],
      ['root', 'auth.login'],
    ]);
  });

  it('creates only one administrator when two requests race', async () => {
    const { app, auth } = setup();
    const body = { username: 'root', password: TEST_PASSWORD };
    const results = await Promise.all([
      post(app, '/api/auth/setup', body),
      post(app, '/api/auth/setup', { ...body, username: 'root2' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(auth.accounts.count()).toBe(1);
  });

  it.each([
    [{ username: 'ab', password: TEST_PASSWORD }],
    [{ username: 'a b c', password: TEST_PASSWORD }],
    [{ username: 'root', password: 'court' }],
    [{ username: 'root' }],
  ])('rejects invalid input %j', async (body) => {
    const { app, auth } = setup();
    expect((await post(app, '/api/auth/setup', body)).statusCode).toBe(400);
    expect(auth.accounts.count()).toBe(0);
  });

  it('refuses without an audit log (no access without a trace)', async () => {
    const { auth } = testAuth();
    const app = buildApp({ version: '1', auth });
    const res = await post(app, '/api/auth/setup', { username: 'root', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(503);
    expect(auth.accounts.count()).toBe(0);
  });
});

describe('POST /api/auth/login', () => {
  it('follows the interface contract and sets a hardened cookie', async () => {
    const { app, auth } = setup();
    await addAccount(auth, 'alice');
    const res = await post(app, '/api/auth/login', { username: 'alice', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(200);
    const body = loginBody(res);
    expect(body).toEqual({
      csrfToken: expect.any(String),
      user: { username: 'alice', role: 'operator' },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^b365_session=[\w-]{40,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain(body.csrfToken);
  });

  it('marks the cookie Secure when the request arrives over HTTPS (behind a trusted proxy)', async () => {
    const { auth } = testAuth();
    const app = buildApp({
      version: '1',
      auth,
      audit: SqliteAuditLog.open(':memory:'),
      trustProxy: '127.0.0.1',
    });
    await addAccount(auth, 'alice');
    const res = await post(
      app,
      '/api/auth/login',
      { username: 'alice', password: TEST_PASSWORD },
      { 'x-forwarded-proto': 'https' },
    );
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });

  it('ignores X-Forwarded-Proto when no proxy is trusted', async () => {
    const { app, auth } = setup();
    await addAccount(auth, 'alice');
    const res = await post(
      app,
      '/api/auth/login',
      { username: 'alice', password: TEST_PASSWORD },
      { 'x-forwarded-proto': 'https' },
    );
    expect(String(res.headers['set-cookie'])).not.toContain('Secure');
  });

  it('answers the same 401 for a wrong password, an unknown user and a disabled account', async () => {
    const { app, auth } = setup();
    await addAccount(auth, 'alice');
    const bob = await addAccount(auth, 'bob');
    auth.accounts.update(bob.id, { disabled: true });
    const bodies = [];
    for (const [username, password] of [
      ['alice', 'mauvais mot de passe'],
      ['inconnu', TEST_PASSWORD],
      ['bob', TEST_PASSWORD],
    ] as const) {
      const res = await post(app, '/api/auth/login', { username, password });
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      bodies.push(res.body);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('limits simultaneous guesses: 20 parallel wrong passwords, only 5 reach scrypt', async () => {
    const { app, auth } = setup();
    await addAccount(auth, 'alice');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(app, '/api/auth/login', { username: 'alice', password: 'mauvais mot de passe' }),
      ),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(15);
  });

  it('does not let a client pick its address with X-Forwarded-For (trusted proxy)', async () => {
    const { auth } = testAuth();
    const app = buildApp({
      version: '1',
      auth,
      audit: SqliteAuditLog.open(':memory:'),
      trustProxy: '127.0.0.1',
    });
    // Le proxy de confiance ajoute l'adresse réelle à la fin ; le client forge le début.
    for (let i = 0; i < 5; i++) {
      await post(
        app,
        '/api/auth/login',
        { username: `inconnu${i}`, password: 'mauvais mot de passe' },
        { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.7` },
      );
    }
    const res = await post(
      app,
      '/api/auth/login',
      { username: 'autre', password: 'mauvais mot de passe' },
      { 'x-forwarded-for': '10.9.9.200, 203.0.113.7' },
    );
    expect(res.statusCode).toBe(429);
  });

  it('never echoes a password back, even from a truncated JSON body', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":"alice","password":"SecretDansUnCorpsTronque',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('SecretDansUnCorpsTronque');
  });

  it('answers 429 with Retry-After after 5 failures', async () => {
    const { app, auth } = setup();
    await addAccount(auth, 'alice');
    for (let i = 0; i < 5; i++) {
      await post(app, '/api/auth/login', { username: 'alice', password: 'mauvais mot de passe' });
    }
    const res = await post(app, '/api/auth/login', { username: 'alice', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('does not write one audit line per locked request: 1000 locked requests, one event', async () => {
    const { app, auth, audit } = setup();
    await addAccount(auth, 'alice');
    for (let i = 0; i < 5; i++) {
      await post(app, '/api/auth/login', { username: 'alice', password: 'mauvais mot de passe' });
    }
    for (let i = 0; i < 1000; i++) {
      const res = await post(app, '/api/auth/login', { username: 'alice', password: 'x' });
      expect(res.statusCode).toBe(429);
    }
    const log = await entries(audit);
    expect(log.filter((e) => e.reason === 'locked')).toHaveLength(1);
    expect(log).toHaveLength(6);
  });

  it('counts wrong current passwords on /api/auth/password in the lockout, and audits them once', async () => {
    const { app, auth, audit } = setup();
    await addAccount(auth, 'alice');
    const login = await post(app, '/api/auth/login', {
      username: 'alice',
      password: TEST_PASSWORD,
    });
    const headers = {
      cookie: String(login.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': loginBody(login).csrfToken,
    };
    const body = { currentPassword: 'faux faux faux faux', newPassword: 'nouveau mot de passe' };
    for (let i = 0; i < 5; i++) {
      expect((await post(app, '/api/auth/password', body, headers)).statusCode).toBe(403);
    }
    for (let i = 0; i < 50; i++) {
      const res = await post(
        app,
        '/api/auth/password',
        { ...body, currentPassword: TEST_PASSWORD },
        headers,
      );
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('30');
    }
    const failures = (await entries(audit)).filter((e) => e.action === 'auth.login_failed');
    expect(failures.map((e) => e.reason).sort()).toEqual([
      ...Array(5).fill('password_change_failed'),
      'password_change_locked',
    ]);
    expect(JSON.stringify(failures)).not.toContain('faux faux');
  });

  it('records success and failure in the audit log, never the password nor an invented name', async () => {
    const { app, auth, audit } = setup();
    await addAccount(auth, 'alice');
    await post(app, '/api/auth/login', { username: 'alice', password: 'mauvais mot de passe' });
    // Un mot de passe saisi par erreur dans le champ du nom ne doit pas finir au journal.
    await post(app, '/api/auth/login', {
      username: 'secret-tapé-au-mauvais-endroit',
      password: 'x',
    });
    await post(app, '/api/auth/login', { username: 'alice', password: TEST_PASSWORD });
    const log = await entries(audit);
    expect(log.map((e) => [e.actor, e.action, e.reason])).toEqual([
      ['alice', 'auth.login_failed', 'bad_credentials'],
      ['anonymous', 'auth.login_failed', 'bad_credentials'],
      ['alice', 'auth.login', undefined],
    ]);
    const text = JSON.stringify(log);
    expect(text).not.toContain('mauvais mot de passe');
    expect(text).not.toContain(TEST_PASSWORD);
    expect(text).not.toContain('secret-tapé');
  });

  it('refuses without an audit log, and without a session being created', async () => {
    const { auth } = testAuth();
    const app = buildApp({ version: '1', auth });
    await addAccount(auth, 'alice');
    const res = await post(app, '/api/auth/login', { username: 'alice', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(503);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

async function signedIn(role: 'admin' | 'operator' = 'operator') {
  const t = setup();
  await addAccount(t.auth, 'alice', role);
  const res = await post(t.app, '/api/auth/login', { username: 'alice', password: TEST_PASSWORD });
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  const { csrfToken } = loginBody(res);
  return { ...t, cookie, csrfToken, headers: { cookie, 'x-csrf-token': csrfToken } };
}

describe('session, /me et déconnexion', () => {
  it('returns the user and the CSRF token on /me', async () => {
    const t = await signedIn();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: t.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      csrfToken: t.csrfToken,
      user: { username: 'alice', role: 'operator' },
    });
  });

  it('logs out: the cookie is cleared, the session is dead, the audit has the event', async () => {
    const t = await signedIn();
    const res = await post(t.app, '/api/auth/logout', undefined, t.headers);
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    const after = await t.app.inject({ method: 'GET', url: '/api/audit', headers: t.headers });
    expect(after.statusCode).toBe(401);
    expect((await entries(t.audit)).at(-1)).toMatchObject({
      actor: 'alice',
      action: 'auth.logout',
    });
  });
});

describe('jeton CSRF', () => {
  it('refuses POST, PUT, PATCH and DELETE without or with a wrong token, accepts the right one', async () => {
    const t = await signedIn('admin');
    const target = sessionFor(t.auth, 'cible', 'operator').account;
    const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', headers: Record<string, string>) =>
      t.app.inject({
        method,
        url: `/api/accounts/${target.id}/reset-password`,
        headers: { cookie: t.cookie, ...headers },
        payload: { password: 'un autre mot de passe' },
      });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const none = await send(method, {});
      expect(none.statusCode, method).toBe(403);
      expect(none.json()).toEqual({ error: 'csrf_invalid' });
      expect((await send(method, { 'x-csrf-token': 'faux' })).statusCode, method).toBe(403);
    }
    expect((await send('POST', { 'x-csrf-token': t.csrfToken })).statusCode).toBe(204);
  });

  it('does not require the token on reads', async () => {
    const t = await signedIn();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { cookie: t.cookie },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('does not accept the token of another session', async () => {
    const t = await signedIn('admin');
    const other = sessionFor(t.auth, 'autre', 'admin');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: t.cookie, 'x-csrf-token': other.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("l'acteur réel dans le journal", () => {
  it("replaces 'anonymous' in the entries of the data routes, and logs reads of the audit log", async () => {
    const t = await signedIn();
    await t.app.inject({ method: 'GET', url: '/api/audit', headers: t.headers });
    const last = (await entries(t.audit)).at(-1);
    expect(last).toMatchObject({
      actor: 'alice',
      action: 'list.view',
      resource: 'audit',
      count: expect.any(Number),
    });
    expect((await entries(t.audit)).some((e) => e.actor === 'anonymous')).toBe(false);
  });
});

describe('changement de son mot de passe', () => {
  it('forces the change after a reset, then lets the user in', async () => {
    const t = await signedIn('admin');
    const target = await addAccount(t.auth, 'bob');
    const reset = await post(
      t.app,
      `/api/accounts/${target.id}/reset-password`,
      { password: 'mot de passe provisoire' },
      t.headers,
    );
    expect(reset.statusCode).toBe(204);

    const login = await post(t.app, '/api/auth/login', {
      username: 'bob',
      password: 'mot de passe provisoire',
    });
    expect(login.statusCode).toBe(200);
    expect(loginBody(login).user).toEqual({
      username: 'bob',
      role: 'operator',
      mustChangePassword: true,
    });
    const headers = {
      cookie: String(login.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': loginBody(login).csrfToken,
    };
    // Tant que le mot de passe provisoire n'est pas changé, rien d'autre ne passe.
    const blocked = await t.app.inject({ method: 'GET', url: '/api/audit', headers });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: 'password_change_required' });

    const wrong = await post(
      t.app,
      '/api/auth/password',
      { currentPassword: 'faux faux faux faux', newPassword: 'nouveau mot de passe' },
      headers,
    );
    expect(wrong.statusCode).toBe(403);
    const weak = await post(
      t.app,
      '/api/auth/password',
      { currentPassword: 'mot de passe provisoire', newPassword: 'court' },
      headers,
    );
    expect(weak.statusCode).toBe(400);
    const same = await post(
      t.app,
      '/api/auth/password',
      { currentPassword: 'mot de passe provisoire', newPassword: 'mot de passe provisoire' },
      headers,
    );
    expect(same.statusCode).toBe(400);
    const ok = await post(
      t.app,
      '/api/auth/password',
      { currentPassword: 'mot de passe provisoire', newPassword: 'nouveau mot de passe' },
      headers,
    );
    expect(ok.statusCode).toBe(204);

    expect((await t.app.inject({ method: 'GET', url: '/api/audit', headers })).statusCode).toBe(
      200,
    );
    const again = await post(t.app, '/api/auth/login', {
      username: 'bob',
      password: 'nouveau mot de passe',
    });
    expect(again.statusCode).toBe(200);
    expect(loginBody(again).user).toEqual({ username: 'bob', role: 'operator' });
  });

  it('kills the sessions of an account whose password was reset', async () => {
    const t = await signedIn('admin');
    const victim = sessionFor(t.auth, 'victime', 'operator');
    await post(
      t.app,
      `/api/accounts/${victim.account.id}/reset-password`,
      { password: 'mot de passe provisoire' },
      t.headers,
    );
    const res = await t.app.inject({ method: 'GET', url: '/api/status', headers: victim.headers });
    expect(res.statusCode).toBe(401);
  });
});
