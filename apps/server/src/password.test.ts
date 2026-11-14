import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password.js';
import { CHEAP_SCRYPT } from './test-support.js';

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('un mot de passe assez long', CHEAP_SCRYPT);
    expect(await verifyPassword('un mot de passe assez long', hash)).toBe(true);
    expect(await verifyPassword('un mot de passe assez lonG', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('uses a distinct random salt per hash and never stores the password', async () => {
    const a = await hashPassword('même mot de passe', CHEAP_SCRYPT);
    const b = await hashPassword('même mot de passe', CHEAP_SCRYPT);
    expect(a).not.toBe(b);
    expect(a).not.toContain('même');
    expect(a.startsWith('scrypt$16$1$1$')).toBe(true);
  });

  it('keeps the parameters in the hash, so the cost can change later', async () => {
    const hash = await hashPassword('un mot de passe assez long', { N: 32, r: 1, p: 1 });
    expect(hash.startsWith('scrypt$32$1$1$')).toBe(true);
    expect(await verifyPassword('un mot de passe assez long', hash)).toBe(true);
  });

  it('treats an unreadable or dangerous stored hash as a mismatch', async () => {
    for (const stored of [
      '',
      'texte',
      'scrypt$16$1$1$AAAA',
      'bcrypt$16$1$1$AAAA$AAAA',
      // Mémoire démesurée réclamée par une empreinte altérée.
      'scrypt$1073741824$8$1$AAAA$AAAA',
      'scrypt$15$1$1$AAAA$AAAA',
    ]) {
      expect(await verifyPassword('x', stored), stored).toBe(false);
    }
  });
});

describe('passwordProblem', () => {
  it('accepts 12 to 256 characters only', () => {
    expect(passwordProblem('a'.repeat(11))).toBe('password_too_short');
    expect(passwordProblem('a'.repeat(12))).toBeNull();
    expect(passwordProblem('a'.repeat(256))).toBeNull();
    expect(passwordProblem('a'.repeat(257))).toBe('password_too_long');
    expect(passwordProblem(42)).toBe('invalid_password');
  });
});
