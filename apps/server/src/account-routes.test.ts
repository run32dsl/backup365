import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';
import type { Role } from './sqlite/sqlite-account-store.js';

function setup(role: Role = 'admin') {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const session = sessionFor(auth, 'root', role);
  const app = withHeaders(buildApp({ version: '1', auth, audit }), session.headers);
  return { auth, audit, app, session };
}

const send = (
  app: FastifyInstance,
  method: 'POST' | 'PATCH' | 'GET',
  url: string,
  payload?: object,
) => app.inject({ method, url, ...(payload ? { payload } : {}) });

const log = async (audit: SqliteAuditLog) =>
  (await audit.list({ limit: 100, offset: 0 })).items.reverse();

describe('gestion des comptes', () => {
  it('is reserved to administrators', async () => {
    const { app } = setup('operator');
    expect((await send(app, 'GET', '/api/accounts')).statusCode).toBe(403);
    const body = { username: 'bob', password: 'un mot de passe long', role: 'operator' };
    expect((await send(app, 'POST', '/api/accounts', body)).statusCode).toBe(403);
    expect((await send(app, 'PATCH', '/api/accounts/1', { disabled: true })).statusCode).toBe(403);
    expect(
      (await send(app, 'POST', '/api/accounts/1/reset-password', { reason: 'Oubli' })).statusCode,
    ).toBe(403);
  });

  it('creates an account that must change its password, and lists accounts without hashes', async () => {
    const { app, audit } = setup();
    const created = await send(app, 'POST', '/api/accounts', {
      username: 'bob',
      password: 'un mot de passe long',
      role: 'operator',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      username: 'bob',
      role: 'operator',
      disabled: false,
      mustChangePassword: true,
    });
    const list = await send(app, 'GET', '/api/accounts');
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(list.body).not.toContain('scrypt');
    expect(list.body).not.toContain('passwordHash');
    expect(created.body).not.toContain('scrypt');
    expect((await log(audit)).at(0)).toMatchObject({
      actor: 'root',
      action: 'account.create',
      target: 'bob',
      reason: 'role:operator',
    });
  });

  it('refuses a taken name (case ignored), a weak password and an unknown role', async () => {
    const { app } = setup();
    const ok = { username: 'bob', password: 'un mot de passe long', role: 'operator' };
    expect((await send(app, 'POST', '/api/accounts', ok)).statusCode).toBe(201);
    expect((await send(app, 'POST', '/api/accounts', { ...ok, username: 'BOB' })).statusCode).toBe(
      409,
    );
    expect(
      (await send(app, 'POST', '/api/accounts', { ...ok, username: 'carl', password: 'court' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await send(app, 'POST', '/api/accounts', { ...ok, username: 'carl', role: 'root' }))
        .statusCode,
    ).toBe(400);
  });

  it('disables, re-enables and changes the role, recording each change', async () => {
    const { app, audit, auth } = setup();
    const bob = sessionFor(auth, 'bob', 'operator');
    const id = bob.account.id;
    const disabled = await send(app, 'PATCH', `/api/accounts/${id}`, { disabled: true });
    expect(disabled.json()).toMatchObject({ username: 'bob', disabled: true });
    // La session de bob s'arrête immédiatement.
    expect((await buildAppGet(app, bob.headers)).statusCode).toBe(401);
    expect(
      (await send(app, 'PATCH', `/api/accounts/${id}`, { disabled: false, role: 'admin' })).json(),
    ).toMatchObject({
      disabled: false,
      role: 'admin',
    });
    expect((await send(app, 'PATCH', '/api/accounts/9999', { disabled: true })).statusCode).toBe(
      404,
    );
    expect((await send(app, 'PATCH', `/api/accounts/${id}`, {})).statusCode).toBe(400);
    expect((await log(audit)).map((e) => [e.actor, e.action, e.target, e.reason])).toEqual([
      ['root', 'account.update', 'bob', 'disabled:true'],
      ['root', 'account.update', 'bob', 'role:admin,disabled:false'],
    ]);
  });

  it('protects the last administrator: no disabling, no demotion, through the API', async () => {
    const { app, session, auth } = setup();
    const id = session.account.id;
    for (const patch of [
      { disabled: true },
      { role: 'operator' },
      { role: 'operator', disabled: true },
    ]) {
      const res = await send(app, 'PATCH', `/api/accounts/${id}`, patch);
      expect(res.statusCode, JSON.stringify(patch)).toBe(409);
      expect(res.json()).toEqual({ error: 'last_admin' });
    }
    expect(auth.accounts.findById(id)).toMatchObject({ role: 'admin', disabled: false });
    // Un second administrateur actif lève l'interdiction.
    sessionFor(auth, 'second', 'admin');
    expect((await send(app, 'PATCH', `/api/accounts/${id}`, { role: 'operator' })).statusCode).toBe(
      200,
    );
  });

  it('does not count a disabled administrator as an administrator', async () => {
    const { app, session, auth } = setup();
    const other = sessionFor(auth, 'second', 'admin').account;
    auth.accounts.update(other.id, { disabled: true });
    const res = await send(app, 'PATCH', `/api/accounts/${session.account.id}`, { disabled: true });
    expect(res.statusCode).toBe(409);
  });

  it('refuses an audit-less change', async () => {
    const { auth } = testAuth();
    const session = sessionFor(auth, 'root', 'admin');
    const app = withHeaders(buildApp({ version: '1', auth }), session.headers);
    const res = await send(app, 'POST', '/api/accounts', {
      username: 'bob',
      password: 'un mot de passe long',
      role: 'operator',
    });
    expect(res.statusCode).toBe(503);
    expect(auth.accounts.count()).toBe(1);
  });

  it('resets with a server-generated password, never written to the audit log', async () => {
    const { app, audit, auth } = setup();
    const id = sessionFor(auth, 'bob', 'operator').account.id;
    const res = await send(app, 'POST', `/api/accounts/${id}/reset-password`, {
      reason: '  Oubli du mot de passe ',
    });
    expect(res.statusCode).toBe(200);
    const { password } = res.json<{ password: string }>();
    expect(password).toHaveLength(19);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(auth.accounts.findById(id)).toMatchObject({ mustChangePassword: true });
    const entries = await log(audit);
    expect(entries.at(-1)).toMatchObject({
      action: 'account.update',
      target: 'bob',
      reason: 'password_reset: Oubli du mot de passe',
    });
    expect(JSON.stringify(entries)).not.toContain(password);
    // Deux réinitialisations ne rendent pas le même mot de passe.
    const again = await send(app, 'POST', `/api/accounts/${id}/reset-password`, { reason: 'x' });
    expect(again.json<{ password: string }>().password).not.toBe(password);
  });

  it('requires a reason and ignores a password sent by the client', async () => {
    const { app, auth } = setup();
    const id = sessionFor(auth, 'bob', 'operator').account.id;
    const url = `/api/accounts/${id}/reset-password`;
    expect((await send(app, 'POST', url, {})).statusCode).toBe(400);
    expect((await send(app, 'POST', url, { reason: '   ' })).statusCode).toBe(400);
    const sent = await send(app, 'POST', url, {
      reason: 'Oubli',
      password: 'un mot de passe long',
    });
    expect(sent.json<{ password: string }>().password).not.toBe('un mot de passe long');
    const unknown = await send(app, 'POST', '/api/accounts/9999/reset-password', { reason: 'x' });
    expect(unknown.statusCode).toBe(404);
  });
});

function buildAppGet(app: FastifyInstance, headers: Record<string, string>) {
  return app.inject({ method: 'GET', url: '/api/accounts', headers });
}
