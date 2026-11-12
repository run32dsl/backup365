import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { screenOf } from './App.js';
import { AuditPage, AuditView } from './AuditPage.js';
import { fetchAudit, toUtcIso } from './audit.js';

const entry = {
  seq: 2,
  at: '2026-01-15T10:00:00.000Z',
  actor: 'alice',
  action: 'item.open' as const,
  resource: 'snapshot',
  target: 'snap-1',
  previousHash: 'a'.repeat(64),
  hash: 'b'.repeat(64),
};

describe('AuditView', () => {
  it('shows the entries with their action label and a short hash', () => {
    const html = renderToString(
      <AuditView state={{ total: 1, limit: 50, offset: 0, items: [entry] }} />,
    );
    expect(html).toContain('alice');
    expect(html).toContain('Ouverture d’une fiche');
    expect(html).toContain('snap-1');
    expect(html).toContain('b'.repeat(12));
  });

  it('shows an empty state, loading and error', () => {
    expect(
      renderToString(<AuditView state={{ total: 0, limit: 50, offset: 0, items: [] }} />),
    ).toContain('Aucune entrée');
    expect(renderToString(<AuditView state="loading" />)).toContain('Chargement');
    expect(renderToString(<AuditView state="error" />)).toContain('indisponible');
  });

  it('escapes entry content (no HTML injection)', () => {
    const html = renderToString(
      <AuditView
        state={{ total: 1, limit: 50, offset: 0, items: [{ ...entry, actor: '<img src=x>' }] }}
      />,
    );
    expect(html).not.toContain('<img');
  });
});

describe('AuditPage', () => {
  it('renders the filter form', () => {
    const html = renderToString(<AuditPage />);
    for (const name of ['from', 'to', 'actor', 'action']) expect(html).toContain(`name="${name}"`);
  });
});

describe('fetchAudit', () => {
  it('sends only the filters that are set', async () => {
    let url = '';
    const fake = ((u: string) => {
      url = u;
      return Promise.resolve(Response.json({ total: 0, limit: 50, offset: 0, items: [] }));
    }) as unknown as typeof fetch;
    await fetchAudit({ actor: 'alice', from: '', action: 'export' as never, limit: 50 }, fake);
    expect(url).toBe('/api/audit?actor=alice&action=export&limit=50');
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchAudit({}, fake)).rejects.toThrow('HTTP 503');
  });
});

describe('helpers', () => {
  it('converts a local date to UTC, and ignores an invalid one', () => {
    expect(toUtcIso('2026-01-15T10:00')).toMatch(/^2026-01-15T\d\d:00:00\.000Z$/);
    expect(toUtcIso('')).toBe('');
    expect(toUtcIso('nope')).toBe('');
  });

  it('routes #/audit to the audit screen', () => {
    expect(screenOf('#/audit')).toBe('audit');
    expect(screenOf('')).toBe('home');
  });
});
