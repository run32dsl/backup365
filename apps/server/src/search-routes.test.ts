import { describe, expect, it } from 'vitest';
import { buildApp, LOG_SERIALIZERS } from './app.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';

async function appWithData() {
  const searchIndex = SqliteSearchIndex.open(':memory:');
  const mails = Array.from({ length: 5 }, (_, i) => ({
    messageId: `m${i}`,
    sender: i % 2 === 0 ? 'alice@example.test' : 'carol@example.test',
    recipients: ['bob@example.test'],
    subject: `Facture ${i}`,
    date: `2026-01-0${i + 1}T10:00:00.000Z`,
    folder: 'Inbox',
    size: 10,
    attachments: [],
  }));
  await searchIndex.indexSnapshot('mbx-1', 'snap-1', mails);
  return buildApp({ version: '1', searchIndex });
}

describe('GET /api/search', () => {
  it('searches, filters and paginates', async () => {
    const app = await appWithData();
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=facture&mailbox=mbx-1&from=alice&to=bob&limit=2&offset=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ total: number; limit: number; offset: number; items: unknown[] }>();
    expect(body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(body.items).toHaveLength(2);
  });

  it('filters by date range', async () => {
    const app = await appWithData();
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?after=2026-01-02T00:00:00Z&before=2026-01-04T00:00:00Z',
    });
    expect(res.json<{ total: number }>().total).toBe(2);
  });

  it.each(['limit=0', 'limit=101', 'offset=-1', 'after=hier', 'q=', `q=${'a'.repeat(257)}`])(
    'rejects invalid parameters (%s)',
    async (qs) => {
      const app = await appWithData();
      const res = await app.inject({ method: 'GET', url: `/api/search?${qs}` });
      expect(res.statusCode).toBe(400);
    },
  );

  it('answers 400 on a date Ajv accepts but JavaScript rejects', async () => {
    const app = await appWithData();
    const res = await app.inject({ method: 'GET', url: '/api/search?after=2026-12-31T23:59:60Z' });
    expect(res.statusCode).toBe(400);
  });

  it('answers 503 without index', async () => {
    const res = await buildApp({ version: '1' }).inject({ method: 'GET', url: '/api/search' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'search_unavailable' });
  });

  it('keeps search terms out of request logs', () => {
    const logged = LOG_SERIALIZERS.req({
      method: 'GET',
      url: '/api/search?q=secret&from=x',
      id: 'r1',
    });
    expect(JSON.stringify(logged)).not.toContain('secret');
  });
});
