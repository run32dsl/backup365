import { createSign, generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { DEMO_OIDC_USERNAME, createDemoOidc } from './demo.js';
import { SESSION_COOKIE } from './auth-hook.js';
import {
  OIDC_CALLBACK_PATH,
  OidcError,
  OidcService,
  entraEndpoints,
  parseOidcConfig,
  type OidcConfig,
} from './oidc.js';
import { OIDC_COOKIE } from './oidc-routes.js';
import { SimulatedOidcProvider } from './oidc-simulated.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { TEST_PASSWORD, addAccount, testAuth } from './test-support.js';

const TENANT = '11111111-2222-4333-8444-555555555555';
const ADMIN_GROUP = 'aaaaaaaa-0000-4000-8000-000000000001';
const OPERATOR_GROUP = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER_GROUP = 'cccccccc-0000-4000-8000-000000000003';

const config: OidcConfig = {
  tenantId: TENANT,
  clientId: 'client-test',
  clientSecret: 'secret-test',
  redirectUri: `https://console.example.test${OIDC_CALLBACK_PATH}`,
  adminGroups: [ADMIN_GROUP],
  operatorGroups: [OPERATOR_GROUP],
};
const endpoints = entraEndpoints(TENANT);

function setup(identity: Record<string, unknown> = {}, now: () => number = Date.now) {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const provider = new SimulatedOidcProvider(
    config,
    endpoints,
    {
      oid: 'oid-1',
      preferred_username: 'claire@example.test',
      groups: [OPERATOR_GROUP],
      ...identity,
    },
    now,
  );
  const oidc = new OidcService(config, endpoints, provider.fetch, now);
  const app = buildApp({ version: '1', auth, audit, oidc });
  return { auth, audit, provider, oidc, app };
}

const cookieOf = (res: { headers: Record<string, unknown> }, name: string): string => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]);
  const found = raw.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(';')[0]! : '';
};

/** Parcours complet : /login, « écran Microsoft » simulé, retour sur /callback. */
async function signIn(
  app: FastifyInstance,
  provider: SimulatedOidcProvider,
  tweak: (callback: { code: string; state: string }) => { code: string; state: string } = (c) => c,
) {
  const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
  const flow = cookieOf(start, OIDC_COOKIE);
  const granted = provider.authorize(String(start.headers['location']))!;
  const { code, state } = tweak(granted);
  return app.inject({
    method: 'GET',
    url: `${OIDC_CALLBACK_PATH}?${new URLSearchParams({ code, state }).toString()}`,
    headers: { cookie: flow },
  });
}

async function entries(audit: SqliteAuditLog) {
  return (await audit.list({ limit: 100, offset: 0 })).items.reverse();
}

describe('parseOidcConfig', () => {
  const env = {
    BACKUP365_OIDC_TENANT_ID: TENANT,
    BACKUP365_OIDC_CLIENT_ID: 'client',
    BACKUP365_OIDC_CLIENT_SECRET: 'secret',
    BACKUP365_OIDC_REDIRECT_URI: `https://console.example.test${OIDC_CALLBACK_PATH}`,
    BACKUP365_OIDC_ADMIN_GROUPS: ADMIN_GROUP.toUpperCase(),
  };

  it('is disabled without any variable', () => {
    expect(parseOidcConfig({})).toBeUndefined();
  });

  it('reads the mapping, lower-casing group ids', () => {
    const parsed = parseOidcConfig({
      ...env,
      BACKUP365_OIDC_OPERATOR_GROUPS: `${OPERATOR_GROUP}, ${OTHER_GROUP}`,
    });
    expect(parsed?.adminGroups).toEqual([ADMIN_GROUP]);
    expect(parsed?.operatorGroups).toEqual([OPERATOR_GROUP, OTHER_GROUP]);
  });

  it('names missing variables without echoing any value', () => {
    const partial = { ...env, BACKUP365_OIDC_CLIENT_SECRET: undefined };
    expect(() => parseOidcConfig(partial)).toThrow('BACKUP365_OIDC_CLIENT_SECRET manquant');
  });

  it('refuses a configuration that maps no group, a bad group, a bad tenant or redirect', () => {
    const noGroups = { ...env, BACKUP365_OIDC_ADMIN_GROUPS: undefined };
    expect(() => parseOidcConfig(noGroups)).toThrow('aucun groupe');
    expect(() => parseOidcConfig({ ...env, BACKUP365_OIDC_ADMIN_GROUPS: 'admins' })).toThrow(
      'BACKUP365_OIDC_ADMIN_GROUPS invalide',
    );
    expect(() => parseOidcConfig({ ...env, BACKUP365_OIDC_TENANT_ID: 'contoso' })).toThrow('GUID');
    for (const uri of [
      'http://console.example.test/api/auth/oidc/callback',
      'https://console.example.test/other',
      'https://console.example.test/api/auth/oidc/callback?x=1',
      'not a url',
    ]) {
      expect(() => parseOidcConfig({ ...env, BACKUP365_OIDC_REDIRECT_URI: uri })).toThrow(
        'BACKUP365_OIDC_REDIRECT_URI invalide',
      );
    }
    expect(
      parseOidcConfig({
        ...env,
        BACKUP365_OIDC_REDIRECT_URI: `http://localhost:3000${OIDC_CALLBACK_PATH}`,
      }),
    ).toBeDefined();
  });
});

describe('connexion Microsoft', () => {
  it('is disabled without configuration: status says so, routes answer 404, local login stays', async () => {
    const { auth } = testAuth();
    const audit = SqliteAuditLog.open(':memory:');
    await addAccount(auth, 'local-admin', 'admin');
    const app = buildApp({ version: '1', auth, audit });
    expect((await app.inject('/api/auth/oidc/status')).json()).toEqual({ enabled: false });
    expect((await app.inject('/api/auth/oidc/login')).statusCode).toBe(404);
    expect((await app.inject(OIDC_CALLBACK_PATH)).statusCode).toBe(404);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'local-admin', password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('redirects to Entra with code flow, S256 PKCE, state and nonce, and binds a cookie', async () => {
    const { app } = setup();
    const res = await app.inject('/api/auth/oidc/login');
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers['location']));
    expect(url.origin + url.pathname).toBe(endpoints.authorization);
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(config.clientId);
    expect(q.get('redirect_uri')).toBe(config.redirectUri);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(q.get('nonce')).toBeTruthy();
    expect(JSON.stringify([...q])).not.toContain(config.clientSecret);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${OIDC_COOKIE}=${q.get('state')}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('signs in a known group: session, role, audit, and the mapping is by group', async () => {
    const { app, provider, audit, auth } = setup();
    const res = await signIn(app, provider);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    const session = cookieOf(res, SESSION_COOKIE);
    expect(session).not.toBe('');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: session } });
    expect(me.json()).toMatchObject({
      user: { username: 'claire@example.test', role: 'operator' },
    });
    expect(auth.accounts.findByUsername('claire@example.test')?.oidc).toBe(true);
    const log = await entries(audit);
    expect(log.at(-1)).toMatchObject({
      actor: 'claire@example.test',
      action: 'auth.login',
      reason: 'oidc',
    });
  });

  it('gives admin to a member of an admin group and refreshes the role at each sign-in', async () => {
    const { app, provider, auth } = setup({ groups: [OPERATOR_GROUP, ADMIN_GROUP] });
    await addAccount(auth, 'other-admin', 'admin');
    await signIn(app, provider);
    expect(auth.accounts.findByUsername('claire@example.test')?.role).toBe('admin');
    provider.identity = { ...provider.identity, groups: [OPERATOR_GROUP] };
    await signIn(app, provider);
    expect(auth.accounts.findByUsername('claire@example.test')?.role).toBe('operator');
  });

  it('refuses and audits a sign-in without a recognised group, and closes the open sessions', async () => {
    const { app, provider, audit, auth } = setup();
    const first = await signIn(app, provider);
    const session = cookieOf(first, SESSION_COOKIE);
    provider.identity = { ...provider.identity, groups: [OTHER_GROUP] };
    const res = await signIn(app, provider);
    expect(res.headers['location']).toBe('/?oidc_error=no_group');
    expect(cookieOf(res, SESSION_COOKIE)).toBe('');
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: session } })).statusCode,
    ).toBe(401);
    const last = (await entries(audit)).at(-1);
    expect(last).toMatchObject({
      actor: 'claire@example.test',
      action: 'auth.login_failed',
      reason: 'oidc_no_group',
    });
    // Sans aucun groupe (ni revendication) : même refus, et aucun compte n'est créé.
    const { app: app2, provider: p2, auth: a2 } = setup({ oid: 'oid-9', groups: undefined });
    expect((await signIn(app2, p2)).headers['location']).toBe('/?oidc_error=no_group');
    expect(a2.accounts.count()).toBe(0);
    expect(auth.accounts.findByUsername('claire@example.test')?.role).toBe('operator');
  });

  it('refuses a disabled Microsoft account', async () => {
    const { app, provider, auth } = setup();
    await signIn(app, provider);
    auth.accounts.update(auth.accounts.findByUsername('claire@example.test')!.id, {
      disabled: true,
    });
    expect((await signIn(app, provider)).headers['location']).toBe('/?oidc_error=disabled');
  });

  it('does not take over a local account that has the same name', async () => {
    const { app, provider, auth, audit } = setup();
    await addAccount(auth, 'claire@example.test', 'admin');
    const res = await signIn(app, provider);
    expect(res.headers['location']).toBe('/?oidc_error=account_conflict');
    expect(auth.accounts.findByUsername('claire@example.test')?.oidc).toBe(false);
    expect((await entries(audit)).at(-1)?.reason).toBe('oidc_account_conflict');
  });

  it('keeps the last admin as admin even if the groups say otherwise', async () => {
    const { app, provider, auth } = setup({ groups: [ADMIN_GROUP] });
    await signIn(app, provider);
    provider.identity = { ...provider.identity, groups: [OPERATOR_GROUP] };
    await signIn(app, provider);
    expect(auth.accounts.findByUsername('claire@example.test')?.role).toBe('admin');
  });

  it('has no local password: password login and admin reset/role change are refused', async () => {
    const { app, provider, auth } = setup();
    await addAccount(auth, 'boss', 'admin');
    await signIn(app, provider);
    const oidcAccount = auth.accounts.findByUsername('claire@example.test')!;
    for (const password of ['', 'x', TEST_PASSWORD, 'dummy-password-for-timing']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'claire@example.test', password },
      });
      expect(res.statusCode).toBe(401);
    }
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'boss', password: TEST_PASSWORD },
    });
    const headers = {
      cookie: cookieOf(adminLogin, SESSION_COOKIE),
      'x-csrf-token': (adminLogin.json() as { csrfToken: string }).csrfToken,
    };
    const reset = await app.inject({
      method: 'POST',
      url: `/api/accounts/${oidcAccount.id}/reset-password`,
      payload: { reason: 'test' },
      headers,
    });
    expect(reset.json()).toEqual({ error: 'managed_by_oidc' });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${oidcAccount.id}`,
      payload: { role: 'admin' },
      headers,
    });
    expect(patch.statusCode).toBe(409);
    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${oidcAccount.id}`,
      payload: { disabled: true },
      headers,
    });
    expect(disable.statusCode).toBe(200);
  });

  describe('callbacks refused before any provider call', () => {
    it('rejects a missing, foreign or reused state without contacting the provider', async () => {
      const { app, provider } = setup();
      const start = await app.inject('/api/auth/oidc/login');
      const flow = cookieOf(start, OIDC_COOKIE);
      const granted = provider.authorize(String(start.headers['location']))!;
      const call = (query: string, cookie?: string) =>
        app.inject({
          url: `${OIDC_CALLBACK_PATH}?${query}`,
          headers: cookie ? { cookie } : {},
        });
      const q = new URLSearchParams(granted).toString();
      // Sans cookie (lien forgé ouvert dans un autre navigateur), cookie d'un autre état, sans paramètres.
      expect((await call(q)).headers['location']).toBe('/?oidc_error=invalid_request');
      expect((await call(q, `${OIDC_COOKIE}=autre`)).headers['location']).toBe(
        '/?oidc_error=invalid_request',
      );
      expect((await call('')).headers['location']).toBe('/?oidc_error=invalid_request');
      expect(provider.calls).toEqual([]);
      // Le bon couple passe une fois, jamais deux.
      expect((await call(q, flow)).headers['location']).toBe('/');
      const again = await call(q, flow);
      expect(again.headers['location']).toBe('/?oidc_error=invalid_request');
    });

    it('burns the state on a provider error and refuses a replayed code', async () => {
      const { app, provider } = setup();
      const start = await app.inject('/api/auth/oidc/login');
      const flow = cookieOf(start, OIDC_COOKIE);
      const { state } = provider.authorize(String(start.headers['location']))!;
      const res = await app.inject({
        url: `${OIDC_CALLBACK_PATH}?error=access_denied&state=${state}`,
        headers: { cookie: flow },
      });
      expect(res.headers['location']).toBe('/?oidc_error=provider_error');
      const reuse = await app.inject({
        url: `${OIDC_CALLBACK_PATH}?code=x&state=${state}`,
        headers: { cookie: flow },
      });
      expect(reuse.headers['location']).toBe('/?oidc_error=invalid_request');
    });

    it('refuses an unknown code (the provider rejects it) without creating an account', async () => {
      const { app, provider, auth, audit } = setup();
      const res = await signIn(app, provider, (c) => ({ ...c, code: 'code-invente' }));
      expect(res.headers['location']).toBe('/?oidc_error=provider_error');
      expect(auth.accounts.count()).toBe(0);
      // Pas d'identité vérifiée : rien au journal (il ne se purge pas).
      expect((await entries(audit)).length).toBe(0);
    });
  });

  it('fails closed when the audit log is down', async () => {
    const { auth } = testAuth();
    const audit = SqliteAuditLog.open(':memory:');
    const provider = new SimulatedOidcProvider(config, endpoints, {
      oid: 'o',
      preferred_username: 'claire@example.test',
      groups: [OPERATOR_GROUP],
    });
    const oidc = new OidcService(config, endpoints, provider.fetch);
    const broken = {
      ...audit,
      record: () => Promise.reject(new Error('disk')),
    } as unknown as SqliteAuditLog;
    const app = buildApp({ version: '1', auth, audit: broken, oidc });
    const res = await signIn(app, provider);
    expect(res.headers['location']).toBe('/?oidc_error=unavailable');
    expect(cookieOf(res, SESSION_COOKIE)).toBe('');
  });
});

describe('fournisseur simulé de la démo', () => {
  it('goes through the console itself and signs in the demo Microsoft account', async () => {
    const { auth } = testAuth();
    const audit = SqliteAuditLog.open(':memory:');
    const { service, provider } = createDemoOidc();
    const app = buildApp({ version: '1', auth, audit, oidc: service, oidcSimulated: provider });
    const start = await app.inject('/api/auth/oidc/login');
    const flow = cookieOf(start, OIDC_COOKIE);
    const authorize = String(start.headers['location']);
    expect(authorize.startsWith('/api/auth/oidc/demo-authorize?')).toBe(true);
    const consent = await app.inject(authorize);
    const back = String(consent.headers['location']);
    expect(back.startsWith(`${OIDC_CALLBACK_PATH}?code=`)).toBe(true);
    const res = await app.inject({ url: back, headers: { cookie: flow } });
    expect(res.headers['location']).toBe('/');
    expect(auth.accounts.findByUsername(DEMO_OIDC_USERNAME)?.role).toBe('operator');
    // Hors démo, la route d'autorisation simulée n'existe pas.
    const real = buildApp({ version: '1', auth, audit, oidc: service });
    expect((await real.inject('/api/auth/oidc/demo-authorize')).statusCode).toBe(401);
  });
});

describe('vérification du jeton (RS256 via JWKS)', () => {
  it('accepts a correctly signed token (control)', async () => {
    // Le nonce du jeton forgé doit être celui de la connexion : on le lit dans l'adresse.
    const { provider } = setup();
    let nonce = '';
    const service = new OidcService(config, endpoints, async (u, init) => {
      if (u === endpoints.token)
        return Response.json({ id_token: provider.sign(provider.claims(nonce)) });
      return provider.fetch(u, init);
    });
    const { url, state } = service.start();
    nonce = new URL(url).searchParams.get('nonce')!;
    await expect(service.finish('c', state)).resolves.toMatchObject({ role: 'operator' });
  });

  /** Service dont l'échange de code rend le jeton fabriqué par `forge(nonce)`. */
  async function outcome(
    forge: (provider: SimulatedOidcProvider, nonce: string) => string,
    now: () => number = Date.now,
  ) {
    const { provider } = setup({}, now);
    let nonce = '';
    const service = new OidcService(
      config,
      endpoints,
      async (u, init) =>
        u === endpoints.token
          ? Response.json({ id_token: forge(provider, nonce) })
          : provider.fetch(u, init),
      now,
    );
    const { url, state } = service.start();
    nonce = new URL(url).searchParams.get('nonce')!;
    return service.finish('c', state).then(
      () => 'ok',
      (err: unknown) => (err as OidcError).code,
    );
  }

  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

  it('refuses alg none, HS256, a bad signature and a foreign key', async () => {
    expect(
      await outcome((p, n) => `${b64({ alg: 'none', kid: p.kid })}.${b64(p.claims(n))}.`),
    ).toBe('invalid_token');
    expect(await outcome((p, n) => p.sign(p.claims(n), { alg: 'HS256' }))).toBe('invalid_token');
    expect(await outcome((p, n) => p.sign(p.claims(n), { kid: 'inconnue' }))).toBe('invalid_token');
    expect(
      await outcome((p, n) => {
        const t = p.sign(p.claims(n)).split('.');
        return `${t[0]}.${b64({ ...p.claims(n), groups: [ADMIN_GROUP] })}.${t[2]}`;
      }),
    ).toBe('invalid_token');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      await outcome((p, n) => {
        const head = b64({ alg: 'RS256', kid: p.kid });
        const body = b64(p.claims(n));
        const sig = createSign('RSA-SHA256')
          .update(`${head}.${body}`)
          .sign(privateKey)
          .toString('base64url');
        return `${head}.${body}.${sig}`;
      }),
    ).toBe('invalid_token');
    expect(await outcome(() => 'pas-un-jeton')).toBe('invalid_token');
  });

  it('refuses a wrong issuer, audience, nonce, or an expired / not yet valid token', async () => {
    expect(
      await outcome((p, n) => p.sign(p.claims(n, { iss: 'https://evil.example.test/v2.0' }))),
    ).toBe('invalid_token');
    expect(await outcome((p, n) => p.sign(p.claims(n, { aud: 'autre-client' })))).toBe(
      'invalid_token',
    );
    expect(await outcome((p) => p.sign(p.claims('autre-nonce')))).toBe('invalid_token');
    expect(
      await outcome((p, n) => p.sign(p.claims(n, { exp: Math.floor(Date.now() / 1000) - 3600 }))),
    ).toBe('invalid_token');
    expect(
      await outcome((p, n) => p.sign(p.claims(n, { nbf: Math.floor(Date.now() / 1000) + 3600 }))),
    ).toBe('invalid_token');
    expect(await outcome((p, n) => p.sign(p.claims(n, { exp: 'bientôt' })))).toBe('invalid_token');
  });

  it('accepts an audience list that contains the client, and refuses one without a user name', async () => {
    expect(await outcome((p, n) => p.sign(p.claims(n, { aud: ['x', config.clientId] })))).toBe(
      'ok',
    );
    expect(await outcome((p, n) => p.sign(p.claims(n, { preferred_username: undefined })))).toBe(
      'invalid_token',
    );
  });

  it('caches the JWKS and does not refetch it for every forged kid', async () => {
    const { provider } = setup();
    let nonce = '';
    const service = new OidcService(config, endpoints, async (u, init) =>
      u === endpoints.token
        ? Response.json({ id_token: provider.sign(provider.claims(nonce), { kid: 'inconnue' }) })
        : provider.fetch(u, init),
    );
    for (let i = 0; i < 3; i++) {
      const { url, state } = service.start();
      nonce = new URL(url).searchParams.get('nonce')!;
      await service.finish('c', state).catch(() => undefined);
    }
    expect(provider.calls.filter((c) => c === endpoints.jwks)).toHaveLength(1);
  });

  it('sends the PKCE verifier and the secret to the token endpoint only', async () => {
    const { provider } = setup();
    const bodies: string[] = [];
    const service = new OidcService(config, endpoints, async (u, init) => {
      if (u === endpoints.token) bodies.push(String(init?.body));
      return provider.fetch(u, init);
    });
    const { url, state } = service.start();
    const granted = provider.authorize(url)!;
    await service.finish(granted.code, state);
    expect(bodies).toHaveLength(1);
    const form = new URLSearchParams(bodies[0]);
    expect(form.get('code_verifier')).toMatch(/^[\w-]{64}$/);
    expect(form.get('client_secret')).toBe(config.clientSecret);
    expect(url).not.toContain(form.get('code_verifier')!);
  });
});
