import { describe, expect, it } from 'vitest';
import { BASE_LOCK_MS, MAX_FAILURES, MAX_LOCK_MS, SESSION_IDLE_MS, sameToken } from './auth.js';
import { TEST_PASSWORD, addAccount, testAuth } from './test-support.js';

function clock() {
  const t = { now: 1_000_000 };
  return { t, now: () => t.now };
}

describe('AuthService.authenticate, verrouillage progressif', () => {
  it('locks an account after 5 failures, with a delay that doubles', async () => {
    const { t, now } = clock();
    const { auth } = testAuth(now);
    await addAccount(auth, 'alice');
    const attempt = (password: string, ip = '10.0.0.1') => auth.authenticate('alice', password, ip);

    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      expect(await attempt('mauvais')).toMatchObject({ ok: false, reason: 'bad_credentials' });
    }
    // 5e échec : verrou de 30 s, même avec le bon mot de passe.
    expect(await attempt('mauvais')).toMatchObject({ ok: false, reason: 'bad_credentials' });
    expect(await attempt(TEST_PASSWORD)).toMatchObject({
      ok: false,
      reason: 'locked',
      retryAfterSec: BASE_LOCK_MS / 1000,
    });
    t.now += BASE_LOCK_MS - 1;
    expect(await attempt(TEST_PASSWORD)).toMatchObject({ reason: 'locked' });
    t.now += 1;
    // Verrou levé : un nouvel échec double la temporisation.
    expect(await attempt('mauvais')).toMatchObject({ reason: 'bad_credentials' });
    expect(await attempt(TEST_PASSWORD)).toMatchObject({
      reason: 'locked',
      retryAfterSec: (2 * BASE_LOCK_MS) / 1000,
    });
    t.now += 2 * BASE_LOCK_MS;
    expect(await attempt(TEST_PASSWORD)).toMatchObject({ ok: true });
  });

  it('caps the delay and forgets old failures', async () => {
    const { t, now } = clock();
    const { auth } = testAuth(now);
    await addAccount(auth, 'alice');
    for (let i = 0; i < 30; i++) {
      t.now += MAX_LOCK_MS;
      await auth.authenticate('alice', 'mauvais', '10.0.0.1');
    }
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.0.1')).toMatchObject({
      reason: 'locked',
      retryAfterSec: MAX_LOCK_MS / 1000,
    });
    t.now += 2 * 60 * 60_000;
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.0.1')).toMatchObject({ ok: true });
  });

  it('throttles per IP across accounts, including names that do not exist', async () => {
    const { auth } = testAuth();
    await addAccount(auth, 'alice');
    for (let i = 0; i < MAX_FAILURES; i++) {
      await auth.authenticate(`inconnu${i}`, 'mauvais', '10.0.0.9');
    }
    // Un autre compte, depuis la même adresse, est freiné aussi.
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.0.9')).toMatchObject({
      reason: 'locked',
    });
    // Une autre adresse n'est pas freinée.
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.0.8')).toMatchObject({ ok: true });
  });

  it('throttles per account across IPs', async () => {
    const { auth } = testAuth();
    await addAccount(auth, 'alice');
    for (let i = 0; i < MAX_FAILURES; i++) {
      await auth.authenticate('Alice', 'mauvais', `10.0.1.${i}`);
    }
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.2.1')).toMatchObject({
      reason: 'locked',
    });
  });

  it('resets the account counter on success', async () => {
    const { auth } = testAuth();
    await addAccount(auth, 'alice');
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_FAILURES - 1; i++) {
        await auth.authenticate('alice', 'mauvais', `10.1.${round}.${i}`);
      }
      expect(await auth.authenticate('alice', TEST_PASSWORD, `10.2.${round}.1`)).toMatchObject({
        ok: true,
      });
    }
  });

  it('reports a disabled account without letting it in', async () => {
    const { auth } = testAuth();
    const account = await addAccount(auth, 'alice');
    auth.accounts.update(account.id, { disabled: true });
    expect(await auth.authenticate('alice', TEST_PASSWORD, '10.0.0.1')).toMatchObject({
      ok: false,
      reason: 'disabled',
    });
  });

  it('refuses an oversized password without hashing it', async () => {
    const { auth } = testAuth();
    await addAccount(auth, 'alice');
    expect(await auth.authenticate('alice', 'x'.repeat(5000), '10.0.0.1')).toMatchObject({
      reason: 'bad_credentials',
    });
  });
});

describe('AuthService, sessions', () => {
  it('expires a session after 8 hours of inactivity, not before, and slides on use', async () => {
    const { t, now } = clock();
    const { auth } = testAuth(now);
    const account = await addAccount(auth, 'alice');
    const { token } = auth.startSession(account);
    t.now += SESSION_IDLE_MS - 1;
    expect(auth.getSession(token)?.username).toBe('alice');
    t.now += SESSION_IDLE_MS - 1; // l'activité a remis le compteur à zéro
    expect(auth.getSession(token)?.username).toBe('alice');
    t.now += SESSION_IDLE_MS;
    expect(auth.getSession(token)).toBeUndefined();
  });

  it('ends a session on logout and rejects unknown or empty tokens', async () => {
    const { auth } = testAuth();
    const account = await addAccount(auth, 'alice');
    const { token } = auth.startSession(account);
    auth.endSession(token);
    expect(auth.getSession(token)).toBeUndefined();
    expect(auth.getSession('inconnu')).toBeUndefined();
    expect(auth.getSession(undefined)).toBeUndefined();
  });

  it('drops the session as soon as the account is disabled, and follows role changes', async () => {
    const { auth } = testAuth();
    const admin = await addAccount(auth, 'root', 'admin');
    const account = await addAccount(auth, 'alice');
    const { token } = auth.startSession(account);
    expect(auth.getSession(token)?.role).toBe('operator');
    auth.accounts.update(account.id, { role: 'admin' });
    expect(auth.getSession(token)?.role).toBe('admin');
    auth.accounts.update(account.id, { disabled: true });
    expect(auth.getSession(token)).toBeUndefined();
    expect(admin.id).not.toBe(account.id);
  });

  it('gives each session its own unguessable tokens', async () => {
    const { auth } = testAuth();
    const account = await addAccount(auth, 'alice');
    const a = auth.startSession(account);
    const b = auth.startSession(account);
    expect(a.token).not.toBe(b.token);
    expect(a.csrfToken).not.toBe(b.csrfToken);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
  });
});

describe('sameToken', () => {
  it('compares tokens of any length without throwing', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });
});
