import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type AdminIo } from './admin.js';
import { verifyPassword } from './password.js';
import { SqliteAccountStore } from './sqlite/sqlite-account-store.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { CHEAP_SCRYPT, TEST_PASSWORD } from './test-support.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b365-admin-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(argv: string[], stdin = `${TEST_PASSWORD}\n`) {
  const out: string[] = [];
  const err: string[] = [];
  const io: AdminIo = {
    readStdin: () => stdin,
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
    hashParams: CHEAP_SCRYPT,
  };
  return main(argv, { BACKUP365_DATA_DIR: dir }, io).then((code) => ({ code, out, err }));
}

const create = (name: string) => ['create-admin', '--username', name, '--password-stdin'];

describe('admin.js create-admin', () => {
  it('creates an administrator whose password verifies, and records the event', async () => {
    const res = await run(create('e2e-admin'));
    expect(res.code).toBe(0);
    const store = SqliteAccountStore.open(join(dir, 'accounts.sqlite'));
    const account = store.findByUsername('e2e-admin')!;
    expect(account).toMatchObject({ role: 'admin', disabled: false, mustChangePassword: false });
    expect(await verifyPassword(TEST_PASSWORD, account.passwordHash)).toBe(true);
    store.close();
    const audit = SqliteAuditLog.open(join(dir, 'audit.sqlite'));
    expect((await audit.list({ limit: 10, offset: 0 })).items[0]).toMatchObject({
      actor: 'cli',
      action: 'account.create',
      target: 'e2e-admin',
    });
    audit.close();
  });

  it('strips the final newline of stdin only', async () => {
    await run(create('a-admin'), 'mot de passe  avec espaces \r\n');
    const store = SqliteAccountStore.open(join(dir, 'accounts.sqlite'));
    const hash = store.findByUsername('a-admin')!.passwordHash;
    expect(await verifyPassword('mot de passe  avec espaces ', hash)).toBe(true);
    store.close();
  });

  it('refuses a name already taken (case ignored) with exit code 1', async () => {
    expect((await run(create('e2e-admin'))).code).toBe(0);
    const again = await run(create('E2E-Admin'));
    expect(again.code).toBe(1);
    expect(again.err.join()).toContain('déjà pris');
  });

  it('refuses a weak password and an invalid name, without writing anything', async () => {
    expect((await run(create('e2e-admin'), 'court\n')).code).toBe(1);
    expect((await run(create('a b'))).code).toBe(1);
    const store = SqliteAccountStore.open(join(dir, 'accounts.sqlite'));
    expect(store.count()).toBe(0);
    store.close();
  });

  it('prints the usage and exits 2 for anything else, and never takes the password as an argument', async () => {
    for (const argv of [
      [],
      ['create-admin'],
      ['create-admin', '--username', 'x-admin'],
      ['delete', '--username', 'x', '--password-stdin'],
    ]) {
      expect((await run(argv)).code, argv.join(' ')).toBe(2);
    }
    expect(
      (await run(['create-admin', '--username', 'x-admin', '--password', 'secret secret secret']))
        .code,
    ).toBe(2);
  });

  it('never prints the password', async () => {
    const res = await run(create('e2e-admin'));
    expect([...res.out, ...res.err].join('\n')).not.toContain(TEST_PASSWORD);
  });
});
