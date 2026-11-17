import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EntriesTable, Problem } from './OneDrivePage.js';
import {
  ONEDRIVE_MESSAGES,
  breadcrumbOf,
  copyNameOf,
  dateTimeOf,
  failureCause,
  fetchEntries,
  fetchSnapshots,
  isOutcomeUncertain,
  oneDriveHash,
  parseOneDriveHash,
  sizeOf,
  startDriveRestore,
  summaryOf,
} from './onedrive.js';
import { screenOf } from './App.js';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('OneDrive route', () => {
  it('parses #/onedrive/<compte>/<chemin> and round-trips encoded segments', () => {
    expect(parseOneDriveHash('#/onedrive')).toEqual({ account: '', path: '/' });
    expect(parseOneDriveHash('#/onedrive/a%40exemple.fr')).toEqual({
      account: 'a@exemple.fr',
      path: '/',
    });
    const hash = oneDriveHash('a@exemple.fr', '/Documents/Budget 2025');
    expect(hash).toBe('#/onedrive/a%40exemple.fr/Documents/Budget%202025');
    expect(parseOneDriveHash(hash)).toEqual({
      account: 'a@exemple.fr',
      path: '/Documents/Budget 2025',
    });
    expect(parseOneDriveHash('#/onedrivex')).toBeNull();
    expect(parseOneDriveHash('#/onedrive/%E0%A4%A')).toBeNull();
    expect(screenOf('#/onedrive/a')).toBe('onedrive');
  });

  it('builds the breadcrumb from Accueil', () => {
    expect(breadcrumbOf('/Documents/Budget')).toEqual([
      { label: 'Accueil', path: '/' },
      { label: 'Documents', path: '/Documents' },
      { label: 'Budget', path: '/Documents/Budget' },
    ]);
    expect(breadcrumbOf('/')).toHaveLength(1);
  });
});

describe('OneDrive wording', () => {
  it('formats dates in UTC and sizes in French units', () => {
    expect(dateTimeOf('2026-11-13T22:04:00.000Z')).toBe('13/11/2026 22:04');
    expect(dateTimeOf(null)).toBe('');
    expect(dateTimeOf('n’importe quoi')).toBe('');
    expect(sizeOf(null)).toBe('-');
    expect(sizeOf(84_000)).toBe('84 Ko');
    expect(sizeOf(1_240_000)).toBe('1,2 Mo');
  });

  it('names the copy without slashes, as the server does', () => {
    expect(copyNameOf('budget.xlsx', 'file', new Date('2026-11-14T10:00:00Z'))).toBe(
      'budget (restauré 14-11-2026).xlsx',
    );
  });

  it('writes the summary in plain language for a copy and for a replacement', () => {
    const base = {
      name: 'budget.xlsx',
      kind: 'file' as const,
      versionAt: '2026-11-10T18:30:00.000Z',
      folderLabel: 'Documents > Budget',
      copyName: 'budget (restauré 14-11-2026).xlsx',
    };
    expect(summaryOf({ ...base, mode: 'copy' })).toBe(
      'Vous allez restaurer le fichier « budget.xlsx », version du 10/11/2026 18:30, dans Documents > Budget, sous le nom « budget (restauré 14-11-2026).xlsx ». Aucun fichier existant ne sera modifié.',
    );
    expect(summaryOf({ ...base, mode: 'replace' })).toContain(
      'sera remplacé par la version du 10/11/2026. La version actuelle reste dans l’historique OneDrive.',
    );
    expect(summaryOf({ ...base, kind: 'folder', versionAt: null, mode: 'copy' })).toContain(
      'le dossier « budget.xlsx », dans',
    );
  });

  it('says when the outcome is uncertain', () => {
    expect(isOutcomeUncertain('restore_unreachable')).toBe(true);
    expect(isOutcomeUncertain('restore_error')).toBe(false);
    expect(failureCause('restore_error')).toContain('erreur');
  });
});

describe('OneDrive requests', () => {
  it('maps catalog and backup errors to the states of the mock-up', async () => {
    const fetchFn = vi.fn();
    fetchFn.mockReturnValueOnce(json({ error: 'catalog_unavailable' }, 503));
    expect((await fetchSnapshots('a', fetchFn)).status).toBe('unconfigured');
    fetchFn.mockReturnValueOnce(json({ error: 'no_backup_found' }, 503));
    expect((await fetchSnapshots('a', fetchFn)).status).toBe('no_backup');
    // Un journal d'audit en panne n'est pas « aucun compte connecté ».
    fetchFn.mockReturnValueOnce(json({ error: 'audit_unavailable' }, 503));
    expect((await fetchEntries('a', 's', '/', fetchFn)).status).toBe('error');
    fetchFn.mockRejectedValueOnce(new Error('réseau'));
    expect((await fetchEntries('a', 's', '/', fetchFn)).status).toBe('error');
  });

  it('encodes the account and the path in the query', async () => {
    const fetchFn = vi.fn().mockReturnValue(json({ entries: [] }));
    await fetchEntries('a@exemple.fr', 'snap 1', '/Documents/Budget', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/onedrive/a%40exemple.fr/items?snapshot=snap+1&path=%2FDocuments%2FBudget',
    );
  });

  it('sends the reason trimmed and translates server refusals', async () => {
    const fetchFn = vi.fn();
    fetchFn.mockReturnValueOnce(json({ job: { id: 'j1' } }, 202));
    const input = {
      snapshotId: 's',
      path: '/a.txt',
      kind: 'file' as const,
      mode: 'copy' as const,
      reason: '  Ticket #1  ',
    };
    expect((await startDriveRestore('a', input, fetchFn)).ok).toBe(true);
    const init = fetchFn.mock.calls[0]?.[1] as { body: string; method: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ reason: 'Ticket #1', mode: 'copy' });

    fetchFn.mockReturnValueOnce(json({ error: 'restore_in_progress' }, 409));
    expect(await startDriveRestore('a', input, fetchFn)).toEqual({
      ok: false,
      message: ONEDRIVE_MESSAGES.alreadyRunning,
    });
    fetchFn.mockReturnValueOnce(json({ error: 'forbidden' }, 403));
    expect(await startDriveRestore('a', input, fetchFn)).toMatchObject({
      message: ONEDRIVE_MESSAGES.noRights,
    });
    fetchFn.mockReturnValueOnce(json({ error: 'inconnu' }, 500));
    expect(await startDriveRestore('a', input, fetchFn)).toMatchObject({
      message: ONEDRIVE_MESSAGES.generic,
    });
  });
});

describe('OneDrive entries table', () => {
  const rows = [
    {
      name: '2025',
      path: '/Budget 2025/2025',
      kind: 'folder' as const,
      versionAt: null,
      sizeBytes: null,
    },
    {
      name: 'budget.xlsx',
      path: '/budget.xlsx',
      kind: 'file' as const,
      versionAt: '2026-11-13T22:04:00.000Z',
      sizeBytes: 84_000,
    },
  ];
  const html = renderToString(
    <EntriesTable
      account="a"
      rows={rows}
      selected={null}
      emptyMessage="vide"
      onSelect={() => undefined}
      onVersions={() => undefined}
    />,
  );

  it('has no emoji, no « Choix » column and a UTC date header', () => {
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toContain('Choix');
    expect(html).toContain('Version du (UTC)');
    expect(html).toContain('dossier</span>');
  });

  it('shows « — » for absent values, never an empty cell', () => {
    const folderRow = html.split('<tr').find((r) => r.includes('2025')) ?? '';
    expect(folderRow).not.toMatch(/<td[^>]*><\/td>/u);
    expect(folderRow.match(/—/gu)).toHaveLength(3);
    expect(html).not.toContain('>-<');
  });

  it('names each radio button after the item', () => {
    // Dossier : le bouton est nommé par le lien ; fichier : il est dans son libellé.
    const folderId = /<input[^>]*aria-labelledby="([^"]+)"/u.exec(html)?.[1];
    expect(html).toMatch(new RegExp(`<a id="${folderId}"[^>]*>2025</a>`, 'u'));
    expect(html).toMatch(
      /<label[^>]*><input[^>]*type="radio"[^>]*\/>(?: |<!-- -->)*budget\.xlsx<\/label>/u,
    );
  });
});

describe('OneDrive : stockage non configuré', () => {
  it('shows the message without a misleading link to the home page', () => {
    const html = renderToString(<Problem status="unconfigured" onRetry={() => undefined} />);
    expect(html).toContain('Aucun compte Microsoft 365 n’est connecté.');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('Configurer la connexion');
  });
});
