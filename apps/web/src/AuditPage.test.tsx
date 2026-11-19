import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenOf } from './App.js';
import { AuditPage, AuditView } from './AuditPage.js';
import { dateRange, fetchAudit, pageOffsets, queryFromForm, submitFilters } from './audit.js';

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
    expect(html).not.toContain('snap-1');
    expect(html).toContain('15/01/2026 10:00');
    expect(html).toContain('b'.repeat(12));
  });

  it('uses the regular card layout of DataTable', () => {
    const html = renderToString(
      <AuditView state={{ total: 1, limit: 50, offset: 0, items: [entry] }} />,
    );
    expect(html).toContain('class="data-table"');
    expect(html).not.toContain('data-table-compact');
  });

  it('leaves the target, count and reason cells empty when there is no value', () => {
    const base = { ...entry, target: undefined };
    const html = renderToString(
      <AuditView
        state={{
          total: 1,
          limit: 50,
          offset: 0,
          items: [{ ...base, action: 'auth.login' as const, resource: 'session' }],
        }}
      />,
    );
    for (const label of ['Cible', 'Éléments', 'Motif']) {
      expect(html).toMatch(new RegExp(`<td[^>]*data-label="${label}"[^>]*></td>`));
    }
    expect(html).not.toContain('>—<');
  });

  it('gives the reason, target and count columns their layout classes', () => {
    const html = renderToString(
      <AuditView state={{ total: 1, limit: 50, offset: 0, items: [entry] }} />,
    );
    const cls = (label: string) =>
      new RegExp(`<td[^>]*data-label="${label}"[^>]*class="([^"]*)"`).exec(html)?.[1] ?? '';
    expect(cls('Motif').split(' ')).toEqual(expect.arrayContaining(['keep-words', 'col-reason']));
    expect(cls('Cible').split(' ')).toEqual(expect.arrayContaining(['keep-words', 'address']));
    expect(cls('Éléments').split(' ')).toContain('num');
    expect(html).toMatch(/<th[^>]*class="[^"]*col-reason[^"]*"[^>]*>Motif/);
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

  it('requests 25 entries per page from the filter form', async () => {
    let url = '';
    const fake = ((u: string) => {
      url = u;
      return Promise.resolve(Response.json({ total: 0, limit: 25, offset: 0, items: [] }));
    }) as unknown as typeof fetch;
    await fetchAudit(queryFromForm(new FormData()), fake);
    expect(url).toContain('limit=25');
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchAudit({}, fake)).rejects.toThrow('HTTP 503');
  });
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('queryFromForm', () => {
  it('builds the query sent on submit, back on the first page', () => {
    const query = queryFromForm(
      form({ from: '15/01/2026', to: '', actor: '  alice ', action: 'access.denied' }),
    );
    expect(query).toEqual({
      limit: 25,
      offset: 0,
      from: '2026-01-15T00:00:00.000Z',
      to: '',
      actor: 'alice',
      action: 'access.denied',
    });
  });

  it('ignores an action outside the vocabulary and missing fields', () => {
    expect(queryFromForm(form({ action: 'drop table' }))).toEqual({
      limit: 25,
      offset: 0,
      from: '',
      to: '',
      actor: '',
    });
  });
});

describe('AuditView counter and pager', () => {
  const view = (total: number, limit = 25) =>
    renderToString(<AuditView state={{ total, limit, offset: 0, items: [entry] }} />).replace(
      /<!-- -->/g,
      '',
    );

  it('agrees the counter in the singular and the plural', () => {
    expect(view(1)).toContain('1 entrée');
    expect(view(1)).not.toContain('entrées');
    expect(view(28)).toContain('Entrées 1 à 1 sur 28');
    expect(view(28)).not.toContain('(s)');
  });

  it('shows Précédent and Suivant only when there is more than one page', () => {
    expect(view(25)).not.toContain('Suivant');
    expect(view(25)).not.toContain('Précédent');
    expect(view(120)).toContain('Suivant');
    expect(view(120).match(/Suivant/g)).toHaveLength(2);
    expect(view(120)).toContain('Précédent');
  });

  it('uses the shared filters container', () => {
    expect(renderToString(<AuditPage />)).toContain('class="filters"');
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
  it('turns jj/mm/aaaa in Du and Au into the UTC interval [00:00, next day 00:00[', () => {
    expect(dateRange('18/11/2026', '18/11/2026')).toEqual({
      from: '2026-11-18T00:00:00.000Z',
      to: '2026-11-19T00:00:00.000Z',
    });
    expect(queryFromForm(form({ from: '18/11/2026', to: '18/11/2026' }))).toMatchObject({
      from: '2026-11-18T00:00:00.000Z',
      to: '2026-11-19T00:00:00.000Z',
    });
    expect(dateRange('', '')).toEqual({ from: '', to: '' });
    expect(dateRange('', '31/12/2026').to).toBe('2027-01-01T00:00:00.000Z');
  });

  it.each(['31/02/2026', '2026-11-18', '18/11/26', 'nope'])('flags %s as invalid', (text) => {
    expect(dateRange(text, text)).toMatchObject({
      from: '',
      to: '',
      fromError: 'Date attendue au format jj/mm/aaaa',
      toError: 'Date attendue au format jj/mm/aaaa',
    });
  });

  it('refuses 31/12/9999 in Au, whose next day leaves the 4-digit years', () => {
    expect(dateRange('31/12/9999', '31/12/9999')).toEqual({
      from: '9999-12-31T00:00:00.000Z',
      to: '',
      toError: 'Date attendue au format jj/mm/aaaa',
    });
    expect(dateRange('', '30/12/9999').to).toBe('9999-12-31T00:00:00.000Z');
  });

  it('submits no query and reports the error under the field when a date is invalid', () => {
    const build = vi.fn(queryFromForm);
    const bad = submitFilters(form({ from: '31/02/2026', to: '18/11/2026' }), 'from', 'to', build);
    expect(bad.query).toBeNull();
    expect(bad.errors.fromError).toBe('Date attendue au format jj/mm/aaaa');
    expect(bad.errors.toError).toBeUndefined();
    expect(build).not.toHaveBeenCalled();
    const ok = submitFilters(form({ from: '18/11/2026', to: '' }), 'from', 'to', build);
    expect(ok.query).toMatchObject({ from: '2026-11-18T00:00:00.000Z' });
    expect(build).toHaveBeenCalledOnce();
  });

  it('renders text date fields with the jj/mm/aaaa help and no native date input', () => {
    const html = renderToString(<AuditPage />);
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('exclu');
    expect(html).toContain('Date au format jj/mm/aaaa, en UTC comme le tableau');
    expect(html).toMatch(/aria-describedby="[^"]+-help"/);
  });

  it('routes #/audit to the audit screen', () => {
    expect(screenOf('#/audit')).toBe('audit');
    expect(screenOf('')).toBe('home');
  });
});
