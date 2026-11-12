import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { main as auditVerifyMain, runAuditVerify } from './audit-verify.js';
import { tryOpenAuditLog } from './sqlite/open-audit-log.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

async function seeded() {
  const audit = SqliteAuditLog.open(':memory:');
  const base = { resource: 'mailboxes' };
  await audit.record({
    ...base,
    at: '2026-01-01T10:00:00.000Z',
    actor: 'alice',
    action: 'list.view',
  });
  await audit.record({
    ...base,
    at: '2026-01-02T10:00:00.000Z',
    actor: 'bob',
    action: 'access.denied',
    reason: 'x',
  });
  await audit.record({
    ...base,
    at: '2026-01-03T10:00:00.000Z',
    actor: 'alice',
    action: 'item.open',
  });
  return { audit, app: buildApp({ version: '1', audit }) };
}

type AuditBody = { total: number; limit: number; items: { seq: number }[] };

describe('GET /api/audit', () => {
  it('lists entries newest first with their hashes', async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(res.statusCode).toBe(200);
    const body = res.json<AuditBody>();
    expect(body).toMatchObject({ total: 3, limit: 50 });
    expect(body.items.map((i) => i.seq)).toEqual([3, 2, 1]);
    expect(res.body).toContain('"hash"');
  });

  it('filters by actor, action and date, and paginates', async () => {
    const { app } = await seeded();
    const get = async (qs: string) =>
      (await app.inject({ method: 'GET', url: `/api/audit?${qs}` })).json<AuditBody>();
    expect((await get('actor=alice')).items.map((i) => i.seq)).toEqual([3, 1]);
    expect((await get('action=access.denied')).items.map((i) => i.seq)).toEqual([2]);
    expect((await get('from=2026-01-02T00:00:00Z&to=2026-01-03T00:00:00Z')).total).toBe(1);
    const page = await get('limit=1&offset=1');
    expect(page).toMatchObject({ total: 3, limit: 1 });
    expect(page.items.map((i) => i.seq)).toEqual([2]);
  });

  it.each(['action=nope', 'from=hier', 'limit=0', 'limit=101', 'offset=-1', 'actor='])(
    'rejects invalid parameters (%s)',
    async (qs) => {
      const { app } = await seeded();
      expect((await app.inject({ method: 'GET', url: `/api/audit?${qs}` })).statusCode).toBe(400);
    },
  );

  it('answers 400 on a date Ajv accepts but JavaScript rejects', async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: 'GET', url: '/api/audit?from=2026-12-31T23:59:60Z' });
    expect(res.statusCode).toBe(400);
  });

  it('answers 503 without audit log', async () => {
    const res = await buildApp({ version: '1' }).inject({ method: 'GET', url: '/api/audit' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'audit_unavailable' });
  });
});

describe('audit verification command', () => {
  it('exits 0 on an intact chain', async () => {
    const { audit } = await seeded();
    const lines: string[] = [];
    expect(await runAuditVerify(audit, (l) => lines.push(l))).toBe(0);
    expect(lines[0]).toContain('intact');
    expect(lines[0]).toContain('3');
  });

  it('exits 1 and names the altered entry', async () => {
    const lines: string[] = [];
    const broken = {
      verify: () => Promise.resolve({ ok: false as const, entries: 1, brokenAt: 2, reason: 'r' }),
    };
    expect(await runAuditVerify(broken as never, (l) => lines.push(l))).toBe(1);
    expect(lines[0]).toContain('ALTÉRÉ');
    expect(lines[0]).toContain('2');
  });

  it('exits 2 without creating a database when the journal is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b365-'));
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(m));
    try {
      expect(await auditVerifyMain({ BACKUP365_DATA_DIR: dir })).toBe(2);
      expect(existsSync(join(dir, 'audit.sqlite'))).toBe(false);
      expect(errors.join('')).not.toContain(dir);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('tryOpenAuditLog', () => {
  it('returns an error instead of throwing on an unusable path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'b365-'));
    try {
      const file = join(dir, 'not-a-folder');
      writeFileSync(file, '');
      const opened = tryOpenAuditLog(join(file, 'audit.sqlite'));
      expect(opened.audit).toBeUndefined();
      expect(opened.error).toBeInstanceOf(Error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
