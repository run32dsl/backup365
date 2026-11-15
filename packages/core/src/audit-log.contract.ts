import { describe, expect, it } from 'vitest';
import { AUDIT_GENESIS_HASH, type AuditEvent, type AuditFilter, type AuditLog } from './audit.js';

/** Ce que l'adaptateur fournit en plus du port, pour simuler une attaque sur le stockage. */
export interface AuditLogHarness {
  log: AuditLog;
  /** Modifie l'acteur d'une entrée directement dans le stockage, en contournant le port. */
  alterActor(seq: number, actor: string): void | Promise<void>;
  /** Supprime une entrée directement dans le stockage, en contournant le port. */
  deleteEntry(seq: number): void | Promise<void>;
}

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    at: '2026-01-15T10:00:00.000Z',
    actor: 'alice',
    action: 'list.view',
    resource: 'mailboxes',
    ...over,
  };
}

const all: AuditFilter = { limit: 100, offset: 0 };

/** Tests de contrat du port `AuditLog`, à rejouer sur chaque adaptateur. */
export function auditLogContract(name: string, create: () => Promise<AuditLogHarness>): void {
  async function seeded(): Promise<AuditLogHarness> {
    const h = await create();
    await h.log.record(event());
    await h.log.record(
      event({
        at: '2026-01-16T10:00:00.000Z',
        actor: 'bob',
        action: 'item.open',
        resource: 'snapshot',
        target: 'snap-1',
      }),
    );
    await h.log.record(
      event({
        at: '2026-01-17T10:00:00.000Z',
        action: 'access.denied',
        resource: 'catalog',
        reason: 'catalog_unavailable',
      }),
    );
    await h.log.record(
      event({ at: '2026-01-18T10:00:00.000Z', action: 'item.export', resource: 'mail', count: 3 }),
    );
    return h;
  }
  const seqs = (page: { items: { seq: number }[] }) => page.items.map((i) => i.seq);

  describe(`AuditLog contract: ${name}`, () => {
    it('is valid when empty', async () => {
      const { log } = await create();
      expect(await log.verify()).toEqual({ ok: true, entries: 0 });
      expect(await log.list(all)).toEqual({ total: 0, items: [] });
    });

    it('appends entries chained by SHA-256', async () => {
      const { log } = await seeded();
      const page = await log.list(all);
      const entries = [...page.items].reverse();
      expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
      expect(entries[0]?.previousHash).toBe(AUDIT_GENESIS_HASH);
      for (const [i, e] of entries.entries()) {
        expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
        if (i > 0) expect(e.previousHash).toBe(entries[i - 1]?.hash);
      }
      expect(new Set(entries.map((e) => e.hash)).size).toBe(4);
    });

    it('stores every event field', async () => {
      const { log } = await seeded();
      const page = await log.list({ ...all, action: 'access.denied' });
      expect(page.items[0]).toMatchObject({
        at: '2026-01-17T10:00:00.000Z',
        actor: 'alice',
        action: 'access.denied',
        resource: 'catalog',
        reason: 'catalog_unavailable',
      });
      const open = (await log.list({ ...all, action: 'item.open' })).items[0];
      expect(open).toMatchObject({ target: 'snap-1' });
      expect(open).not.toHaveProperty('count');
      expect((await log.list({ ...all, action: 'item.export' })).items[0]).toMatchObject({
        count: 3,
      });
    });

    it('lists newest first and paginates', async () => {
      const { log } = await seeded();
      const first = await log.list({ ...all, limit: 3 });
      const second = await log.list({ ...all, limit: 3, offset: 3 });
      expect(first.total).toBe(4);
      expect([...seqs(first), ...seqs(second)]).toEqual([4, 3, 2, 1]);
    });

    it('filters by actor, action and date range (upper bound excluded)', async () => {
      const { log } = await seeded();
      expect(seqs(await log.list({ ...all, actor: 'bob' }))).toEqual([2]);
      expect(seqs(await log.list({ ...all, action: 'list.view' }))).toEqual([1]);
      const range = await log.list({
        ...all,
        from: '2026-01-16T10:00:00.000Z',
        to: '2026-01-18T10:00:00.000Z',
      });
      expect(seqs(range)).toEqual([3, 2]);
      expect(seqs(await log.list({ ...all, actor: 'bob', action: 'list.view' }))).toEqual([]);
    });

    it('treats filters as plain text', async () => {
      const { log } = await seeded();
      expect(await log.list({ ...all, actor: "x' OR '1'='1" })).toMatchObject({ total: 0 });
      expect(await log.list({ ...all, actor: '%' })).toMatchObject({ total: 0 });
    });

    it('verifies an untouched chain', async () => {
      const { log } = await seeded();
      expect(await log.verify()).toEqual({ ok: true, entries: 4 });
    });

    it('detects an altered entry and names it', async () => {
      const h = await seeded();
      await h.alterActor(2, 'mallory');
      expect(await h.log.verify()).toMatchObject({ ok: false, brokenAt: 2 });
    });

    it('detects a deleted entry in the middle of the chain', async () => {
      const h = await seeded();
      await h.deleteEntry(2);
      expect(await h.log.verify()).toMatchObject({ ok: false, brokenAt: 2 });
    });

    it('keeps the chain valid under concurrent appends', async () => {
      const { log } = await create();
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => log.record(event({ actor: `user-${i}` }))),
      );
      expect(await log.verify()).toEqual({ ok: true, entries: 20 });
    });

    it('rejects an invalid event without adding an entry', async () => {
      const { log } = await seeded();
      await expect(log.record(event({ at: 'pas une date' }))).rejects.toThrow();
      await expect(log.record(event({ action: 'nope' as never }))).rejects.toThrow();
      expect(await log.verify()).toEqual({ ok: true, entries: 4 });
    });
  });
}
