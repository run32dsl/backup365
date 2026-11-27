import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowseStep } from './onedrive/BrowseStep.js';
import { ConfirmStep } from './onedrive/ConfirmStep.js';
import { EntriesTable } from './onedrive/EntriesTable.js';
import { TrackStep } from './onedrive/TrackStep.js';
import {
  ONEDRIVE_MESSAGES,
  breadcrumbOf,
  copyNameOf,
  dateTimeOf,
  failureCause,
  fetchEntries,
  fetchSnapshots,
  isOutcomeUncertain,
  restoredSummary,
  oneDriveHash,
  parseOneDriveHash,
  restoreBlocked,
  sizeOf,
  startDriveRestore,
  confirmRowsOf,
  COPY_CONSEQUENCE,
  replaceWarningOf,
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

  it('roots the breadcrumb at the account, which leads back to the drive root', () => {
    expect(breadcrumbOf('/Documents/Budget', 'claire.durand@exemple.fr')).toEqual([
      { label: 'claire.durand@exemple.fr', path: '/' },
      { label: 'Documents', path: '/Documents' },
      { label: 'Budget', path: '/Documents/Budget' },
    ]);
    expect(breadcrumbOf('/', 'claire.durand@exemple.fr')).toEqual([
      { label: 'claire.durand@exemple.fr', path: '/' },
    ]);
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
      'budget (restauré le 14-11-2026).xlsx',
    );
  });

  it('lists the summary rows for a copy and for a replacement', () => {
    const base = {
      account: 'compte@exemple.test',
      name: 'budget.xlsx',
      backupAt: '2026-11-14T09:00:00.000Z',
      versionAt: '2026-11-10T18:30:00.000Z',
      folderLabel: 'Documents > Budget',
      copyName: 'budget (restauré le 14-11-2026).xlsx',
      reason: 'Reprise après incident',
    };
    expect(confirmRowsOf({ ...base, mode: 'copy' })).toEqual([
      ['Compte', 'compte@exemple.test'],
      ['Élément', 'budget.xlsx'],
      ['Date de la sauvegarde (UTC)', '14/11/2026 09:00'],
      ['Date de la version (UTC)', '10/11/2026 18:30'],
      ['Emplacement', 'Documents > Budget'],
      ['Restauré sous le nom', 'budget (restauré le 14-11-2026).xlsx'],
      ['Motif', 'Reprise après incident'],
    ]);
    const replace = confirmRowsOf({ ...base, mode: 'replace' });
    expect(replace).toContainEqual(['Fichier remplacé', 'budget.xlsx']);
    expect(replace.map(([label]) => label)).not.toContain('Restauré sous le nom');
    expect(confirmRowsOf({ ...base, versionAt: null, mode: 'copy' }).map(([l]) => l)).not.toContain(
      'Date de la version (UTC)',
    );
    expect(COPY_CONSEQUENCE).toBe('Aucun fichier existant ne sera modifié.');
    expect(replaceWarningOf('budget.xlsx', '2026-11-18T16:59:00Z')).toBe(
      'budget.xlsx sera remplacé par la version du 18/11/2026 16:59 UTC. L’actuel reste dans l’historique OneDrive.',
    );
    expect(confirmRowsOf({ ...base, copyName: '', mode: 'copy' })).toContainEqual([
      'Restauré sous le nom',
      'Nom choisi par OneDrive',
    ]);
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
    // Un journal d'audit en panne n'est pas «\u202Faucun compte connecté\u202F».
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
      versionAt: '2026-11-19T09:34:00.000Z',
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

  it('has no emoji, no «\u202FChoix\u202F» column and a UTC date header', () => {
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toContain('Choix');
    expect(html).toContain('Date de la version (UTC)');
    expect(html).toContain('dossier</span>');
    // The folder carries a version date in the data; the table shows « — » like its size.
    expect(html).not.toContain('19/11/2026');
  });

  it('shows «\u202F—\u202F» for absent values in the table; the mobile card shows none', () => {
    const folderRow = html.split('<tr').find((r) => r.includes('2025')) ?? '';
    expect(folderRow.match(/—/gu)).toHaveLength(3);
    // Les «\u202F—\u202F» et la colonne «\u202FDétail\u202F» vide sont masqués dans la carte (CSS `table-only`, `:empty`).
    expect(folderRow).toContain('class="table-only">—');
    expect(folderRow).toMatch(/data-label="Détail" class="card-only"><\/td>/u);
    const fileRow = html.split('<tr').find((r) => r.includes('budget.xlsx')) ?? '';
    expect(fileRow).toContain('Version du 13/11/2026 22:04 UTC · 84 Ko');
    expect(html).not.toContain('>-<');
  });

  it('shows the version picked in the dialog on the checked row only', () => {
    const picked = renderToString(
      <EntriesTable
        account="a"
        rows={rows}
        selected="/budget.xlsx"
        pickedVersion={{
          snapshotId: 's0',
          versionId: 'v0',
          at: '2026-11-16T23:17:00.000Z',
          sizeBytes: 81_000,
          current: false,
        }}
        emptyMessage="vide"
        onSelect={() => undefined}
        onVersions={() => undefined}
      />,
    );
    const fileRow = picked.split('<tr').find((r) => r.includes('budget.xlsx')) ?? '';
    expect(fileRow).toContain('16/11/2026 23:17');
    expect(fileRow).toMatch(/checked/u);
    expect(fileRow).not.toContain('13/11/2026 22:04</td>');
    expect(fileRow).toContain('81 Ko');
    expect(fileRow).not.toContain('84 Ko');
    expect(fileRow).toContain('Version du 16/11/2026 23:17 UTC · 81 Ko');
    const folderRow = picked.split('<tr').find((r) => r.includes('2025')) ?? '';
    expect(folderRow).not.toContain('81 Ko');
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
  it('is reached only by catalog_unavailable, never by backup_not_configured', async () => {
    // `backup_not_configured` est le code du dialogue «\u202FLancer\u202F» (POST d'exécution d'un plan) :
    // aucune route OneDrive ne l'émet, et s'il arrivait, la page n'afficherait pas cet état.
    const fetchFn = vi.fn();
    fetchFn.mockReturnValueOnce(json({ error: 'backup_not_configured' }, 503));
    expect((await fetchSnapshots('a', fetchFn)).status).toBe('error');
    fetchFn.mockReturnValueOnce(json({ error: 'catalog_unavailable' }, 503));
    expect((await fetchSnapshots('a', fetchFn)).status).toBe('unconfigured');
  });
});

describe('OneDrive replace confirmation', () => {
  it('keeps "Restaurer" inactive until the box is checked, in replace mode only', () => {
    expect(restoreBlocked('replace', false)).toBe(true);
    expect(restoreBlocked('replace', true)).toBe(false);
    expect(restoreBlocked('copy', false)).toBe(false);
  });

  it('renders "Restaurer" active in the default copy mode', () => {
    const entry = {
      name: 'budget.xlsx',
      kind: 'file' as const,
      path: '/Documents/Budget/budget.xlsx',
      versionAt: '2026-11-10T18:30:00.000Z',
    };
    const out = renderToString(
      <ConfirmStep
        account="a@exemple.fr"
        choice={{ entry: entry as never, snapshotId: 's1' }}
        backupAt="2026-11-14T09:00:00.000Z"
        reason="Ticket #1 : essai"
        onBack={() => undefined}
        onStarted={() => undefined}
      />,
    );
    const button = /<button[^>]*>Restaurer<\/button>/u.exec(out)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('aria-disabled');
    // Récapitulatif libellé : le motif entre dans la liste, après le choix du mode.
    expect(out).not.toContain('Vous allez restaurer');
    expect(out).not.toContain('Motif : ');
    expect(out).toContain('<dt>Motif</dt><dd>Ticket #1 : essai</dd>');
    expect(out).not.toContain('<h2>Récapitulatif</h2>');
    expect(out).toContain('Aucun fichier existant ne sera modifié.');
  });
});

describe('OneDrive result list', () => {
  const entry = {
    name: 'budget.xlsx',
    kind: 'file' as const,
    path: '/Documents/Budget/budget.xlsx',
    versionAt: '2026-11-10T18:30:00.000Z',
  };
  const job = {
    id: 'j1',
    ownerId: 'o1',
    path: entry.path,
    kind: 'file' as const,
    mode: 'copy' as const,
    versionAt: entry.versionAt,
    startedAt: '2026-11-14T10:00:00.000Z',
    finishedAt: null,
    durationMs: null,
    copyName: 'budget (restauré le 14-11-2026).xlsx',
    error: null,
  };
  it.each([
    ['running', null],
    ['succeeded', null],
    ['failed', 'restore_error'],
  ] as const)('recalls account, version and location when %s', (status, error) => {
    const out = renderToString(
      <TrackStep
        account="a@exemple.fr"
        choice={{ entry: entry as never, snapshotId: 's1' }}
        backupAt="2026-11-14T09:00:00.000Z"
        job={{ ...job, status, error }}
        onJob={() => undefined}
        onAgain={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(out).toContain('<dt>Compte</dt><dd>a@exemple.fr</dd>');
    expect(out).toContain('<dt>Date de la version (UTC)</dt><dd>10/11/2026\u00a018:30</dd>');
    const label = status === 'succeeded' ? 'Élément restauré' : 'Élément';
    const at = [
      'Compte',
      label,
      'Date de la sauvegarde (UTC)',
      'Date de la version (UTC)',
      'Emplacement',
    ].map((l) => out.indexOf(`<dt>${l}</dt>`));
    expect(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]!))).toBe(true);
    if (status === 'succeeded') {
      expect(out).toContain(
        '<dt>Élément restauré</dt><dd>budget.xlsx → budget (restauré le 14-11-2026).xlsx</dd>',
      );
    } else {
      expect(out).toContain('<dt>Élément</dt><dd>budget.xlsx</dd>');
      expect(out).not.toContain('Élément restauré');
      expect(out).not.toContain('→');
    }
    expect(out).toContain('<dt>Emplacement</dt><dd>Documents &gt; Budget</dd>');
  });

  function render(choice: object) {
    return renderToString(
      <TrackStep
        account="a@exemple.fr"
        choice={choice as never}
        backupAt="2026-11-14T09:00:00.000Z"
        job={{ ...job, status: 'succeeded' }}
        onJob={() => undefined}
        onAgain={() => undefined}
        onRetry={() => undefined}
      />,
    );
  }

  it('shows the date of the chosen version rather than the entry date', () => {
    const out = render({
      entry,
      snapshotId: 's1',
      version: { versionId: 'v1', at: '2026-10-01T08:00:00.000Z' },
    });
    expect(out).toContain('<dt>Date de la version (UTC)</dt><dd>01/10/2026\u00a008:00</dd>');
  });

  it('omits the version row when no version date is known', () => {
    const out = render({ entry: { ...entry, versionAt: null }, snapshotId: 's1' });
    expect(out).not.toContain('<dt>Date de la version (UTC)</dt>');
    expect(out).toContain('<dt>Compte</dt>');
    expect(out).toContain('<dt>Emplacement</dt>');
  });
});

describe('OneDrive breadcrumb', () => {
  it('starts at the selected account and never shows Accueil', () => {
    const out = renderToString(
      <BrowseStep
        route={{ account: 'u1', path: '/Documents/Budget' }}
        account="u1"
        accounts={[
          { id: 'u0', displayName: 'autre@exemple.fr' },
          { id: 'u1', displayName: 'claire.durand@exemple.fr' },
        ]}
        snapshots={[]}
        snapshotId=""
        onSnapshot={() => undefined}
        configured
        onChoose={() => undefined}
      />,
    );
    const nav = out.slice(out.indexOf('<nav'), out.indexOf('</nav>'));
    expect(nav).toMatch(/<a href="#\/onedrive\/u1">claire\.durand@exemple\.fr<\/a>/);
    expect(nav).not.toContain('Accueil');
    expect(nav).toContain('<span aria-current="location">Budget</span>');
    expect(nav.match(/aria-current/g)).toHaveLength(1);
  });
});

describe('OneDrive choose step without selection', () => {
  it('explains the inactive « Continuer » and links it by aria-describedby', () => {
    const out = renderToString(
      <BrowseStep
        route={{ account: 'u1', path: '/' }}
        account="u1"
        accounts={[{ id: 'u1', displayName: 'claire.durand@exemple.fr' }]}
        snapshots={[]}
        snapshotId=""
        onSnapshot={() => undefined}
        configured
        onChoose={() => undefined}
      />,
    );
    const help =
      /<p id="([^"]+)" class="field-help">Cochez un fichier ou un dossier pour continuer\./.exec(
        out,
      );
    expect(help).not.toBeNull();
    const button = /<button[^>]*>Continuer<\/button>/.exec(out)?.[0] ?? '';
    expect(button).toContain(`aria-describedby="${help?.[1] ?? ''}"`);
    expect(button).toContain('aria-disabled="true"');
  });

  it('still references the choose hint when the storage is not configured', () => {
    const out = renderToString(
      <BrowseStep
        route={{ account: 'u1', path: '/' }}
        account="u1"
        accounts={[{ id: 'u1', displayName: 'claire.durand@exemple.fr' }]}
        snapshots={[]}
        snapshotId=""
        onSnapshot={() => undefined}
        configured={false}
        onChoose={() => undefined}
      />,
    );
    const help = /<p id="([^"]+)" class="field-help">Cochez un fichier ou un dossier/.exec(out);
    const button = /<button[^>]*>Continuer<\/button>/.exec(out)?.[0] ?? '';
    expect(button).toContain(`aria-describedby="${help?.[1] ?? ''} `);
  });
});

describe('restoredSummary', () => {
  it('says what was restored, never the title of the box', () => {
    expect(restoredSummary('file', '2 s')).toBe('1 fichier restauré en 2 s.');
    expect(restoredSummary('folder', '2 s')).toBe('Dossier restauré en 2 s.');
  });
});
