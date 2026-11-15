import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { screenOf } from './App.js';
import { AuditPage, AuditView } from './AuditPage.js';
import { fetchAudit, pageOffsets, queryFromForm, toUtcIso } from './audit.js';

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
    await fetchAudit({ actor: 'alice', from: '', action: 'item.export', limit: 50 }, fake);
    expect(url).toBe('/api/audit?actor=alice&action=item.export&limit=50');
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchAudit({}, fake)).rejects.toThrow('HTTP 503');
  });
});

describe('queryFromForm', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it('builds the query sent on submit, back on the first page', () => {
    const query = queryFromForm(
      form({ from: '2026-01-15T10:00', to: '', actor: '  alice ', action: 'access.denied' }),
    );
    expect(query).toEqual({
      limit: 50,
      offset: 0,
      from: toUtcIso('2026-01-15T10:00'),
      to: '',
      actor: 'alice',
      action: 'access.denied',
    });
  });

  it('ignores an action outside the vocabulary and missing fields', () => {
    expect(queryFromForm(form({ action: 'drop table' }))).toEqual({
      limit: 50,
      offset: 0,
      from: '',
      to: '',
      actor: '',
    });
  });
});

describe('pageOffsets', () => {
  it('has no previous page at the start and no next page at the end', () => {
    expect(pageOffsets(0, 50, 120)).toEqual({ previous: null, next: 50 });
    expect(pageOffsets(50, 50, 120)).toEqual({ previous: 0, next: 100 });
    expect(pageOffsets(100, 50, 120)).toEqual({ previous: 50, next: null });
    expect(pageOffsets(0, 50, 50)).toEqual({ previous: null, next: null });
    expect(pageOffsets(0, 50, 0)).toEqual({ previous: null, next: null });
  });

  it('never goes below the first entry', () => {
    expect(pageOffsets(20, 50, 120).previous).toBe(0);
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
