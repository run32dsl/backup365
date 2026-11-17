import { describe, expect, it, vi } from 'vitest';
import {
  SHAREPOINT_MESSAGES,
  canContinue,
  continueHint,
  failureCause,
  fetchScope,
  fetchSiteSnapshots,
  fetchSites,
  isOutcomeUncertain,
  parseSharePointHash,
  pathLabel,
  sharePointHash,
  startSiteRestore,
  summaryCountOf,
  summaryOf,
} from './sharepoint.js';
import { navEntries, screenOf } from './App.js';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('SharePoint route', () => {
  it('parses #/sharepoint[/<site>[/<granularité>]] and round-trips', () => {
    expect(parseSharePointHash('#/sharepoint')).toEqual({ site: '', scope: null });
    expect(parseSharePointHash('#/sharepoint/site-1')).toEqual({ site: 'site-1', scope: null });
    expect(parseSharePointHash('#/sharepoint/a%2Cb/site')).toEqual({ site: 'a,b', scope: 'site' });
    expect(parseSharePointHash('#/sharepoint/s/nimporte')).toEqual({ site: 's', scope: null });
    expect(parseSharePointHash(sharePointHash('a,b', 'library'))).toEqual({
      site: 'a,b',
      scope: 'library',
    });
    expect(parseSharePointHash('#/sharepointx')).toBeNull();
    expect(parseSharePointHash('#/sharepoint/%E0%A4%A')).toBeNull();
    expect(screenOf('#/sharepoint/s')).toBe('sharepoint');
  });

  it('adds a SharePoint entry to the navigation', () => {
    expect(navEntries('sharepoint', false).find((e) => e.label === 'SharePoint')).toMatchObject({
      href: '#/sharepoint',
      current: true,
    });
  });
});

describe('SharePoint wording', () => {
  it('only lets a choice through when it fits the granularity', () => {
    expect(canContinue('site', '/', null)).toBe(true);
    expect(canContinue('library', '/', null)).toBe(false);
    expect(canContinue('library', '/Documents', null)).toBe(true);
    expect(canContinue('library', '/Documents/Plans', null)).toBe(false);
    expect(canContinue('folder', '/Documents', null)).toBe(false);
    expect(canContinue('folder', '/Documents/Plans', null)).toBe(true);
    expect(canContinue('item', '/Documents/Plans', null)).toBe(false);
    expect(canContinue('item', '/Documents/Plans', '/Documents/Plans/a.pdf')).toBe(true);
    expect(continueHint('item')).toMatch(/Choisissez un élément/);
  });

  it('formats counts and sizes in French', () => {
    expect(summaryCountOf({ items: 1240, sizeBytes: 3_200_000_000 })).toBe(
      '1 240 éléments, 3,2 Go',
    );
    expect(summaryCountOf({ items: 1, sizeBytes: 84_000 })).toBe('1 élément, 84 Ko');
    expect(pathLabel('/Documents partagés/Plans 2024')).toBe('Documents partagés > Plans 2024');
  });

  it('writes the summary in plain language, with the point of restoration', () => {
    const input = {
      scope: 'library' as const,
      siteName: 'Site Urbanisme (exemple)',
      path: '/Documents partagés',
      pointAt: '2026-11-12T02:00:00.000Z',
      summary: { items: 1240, sizeBytes: 3_200_000_000 },
    };
    expect(summaryOf(input)).toBe(
      'Vous allez restaurer la bibliothèque « Documents partagés » du site « Site Urbanisme (exemple) », tel qu’il était le 12/11/2026 à 02:00, à son emplacement d’origine. Les fichiers existants ne seront pas remplacés. 1 240 éléments, 3,2 Go.',
    );
    expect(summaryOf({ ...input, scope: 'item', summary: null, path: '/A/b.pdf' })).toContain(
      'l’élément « A > b.pdf »',
    );
  });

  it('says when the outcome is uncertain', () => {
    expect(isOutcomeUncertain('restore_lost')).toBe(true);
    expect(isOutcomeUncertain('restore_error')).toBe(false);
    expect(failureCause('restore_unreachable')).toContain('injoignable');
  });
});

describe('SharePoint requests', () => {
  it('maps catalog errors to the states of the mock-up', async () => {
    const fetchFn = vi.fn();
    fetchFn.mockReturnValueOnce(json({ error: 'catalog_unavailable' }, 503));
    expect((await fetchSites(fetchFn)).status).toBe('unconfigured');
    fetchFn.mockReturnValueOnce(json({ error: 'no_backup_found' }, 503));
    expect((await fetchSiteSnapshots('s', fetchFn)).status).toBe('no_backup');
    fetchFn.mockReturnValueOnce(json({ error: 'audit_unavailable' }, 503));
    expect((await fetchScope('s', 'p', '/', fetchFn)).status).toBe('error');
    fetchFn.mockRejectedValueOnce(new Error('réseau'));
    expect((await fetchSites(fetchFn)).status).toBe('error');
  });

  it('encodes the site and the path, and sends the reason trimmed with the typed name', async () => {
    const fetchFn = vi.fn().mockReturnValue(json({ items: 3, sizeBytes: 10 }));
    expect(await fetchScope('a,b', 'snap 1', '/Documents', fetchFn)).toEqual({
      status: 'ok',
      data: { items: 3, sizeBytes: 10 },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/sharepoint/a%2Cb/scope?snapshot=snap+1&path=%2FDocuments',
    );
    fetchFn.mockReset();
    fetchFn.mockReturnValueOnce(json({ job: { id: 'j1' } }, 202));
    const input = {
      snapshotId: 's',
      scope: 'site' as const,
      path: '/',
      reason: '  Ticket #1  ',
      confirmName: 'Site',
    };
    expect((await startSiteRestore('a,b', input, fetchFn)).ok).toBe(true);
    const init = fetchFn.mock.calls[0]?.[1] as { body: string; method: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      reason: 'Ticket #1',
      scope: 'site',
      confirmName: 'Site',
    });
  });

  it('translates server refusals into the words of the mock-up', async () => {
    const fetchFn = vi.fn();
    const input = { snapshotId: 's', scope: 'library' as const, path: '/D', reason: 'x y z' };
    for (const [status, error, message] of [
      [409, 'restore_in_progress', SHAREPOINT_MESSAGES.alreadyRunning],
      [403, 'admin_required', SHAREPOINT_MESSAGES.forbidden],
      [400, 'confirmation_mismatch', SHAREPOINT_MESSAGES.nameError],
      [400, 'reason_required', SHAREPOINT_MESSAGES.reasonError],
      [500, 'inconnu', SHAREPOINT_MESSAGES.generic],
    ] as const) {
      fetchFn.mockReturnValueOnce(json({ error }, status));
      expect(await startSiteRestore('a', input, fetchFn)).toEqual({ ok: false, message });
    }
  });
});
