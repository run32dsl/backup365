import { describe, expect, it, vi } from 'vitest';
import {
  SHAREPOINT_MESSAGES,
  continueHint,
  restoredContentLabel,
  scopeOfKind,
  selectionLabel,
  failureCause,
  fetchScope,
  breadcrumbLevels,
  breadcrumbLink,
  followInApp,
  fetchSiteSnapshots,
  fetchSites,
  isOutcomeUncertain,
  parseSharePointHash,
  pathLabel,
  sharePointHash,
  startSiteRestore,
  summaryCountOf,
  confirmRowsOf,
  placementRows,
  siteWarningOf,
} from './sharepoint.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmStep, ContentTree, SiteDenied, SiteEntriesTable } from './SharePointPage.js';
import { navEntries, screenOf } from './App.js';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('SharePoint right refusal', () => {
  it('names the site, shows no error banner and leads back to the Choose step', () => {
    const html = renderToStaticMarkup(
      <SiteDenied site={{ id: 'abc', displayName: 'Équipe commerciale' }} />,
    );
    expect(html).toContain('le site « Équipe commerciale »');
    expect(html).toContain('Choisir un autre site');
    expect(html).not.toContain('alert-error');
    expect(html).toMatch(/<div class="alert alert-warning" role="alert">/u);
    expect(html).toContain('<strong class="alert-title">Restauration non autorisée</strong>');
    expect(html).not.toContain('class="empty');
    const href = /href="([^"]+)"/u.exec(html)?.[1];
    expect(href).toBe(sharePointHash('abc'));
    // Sans granularité : l'étape « Choisir » du site.
    expect(parseSharePointHash(href ?? '')).toEqual({ site: 'abc', scope: null, path: '/' });
  });
});

describe('SharePoint route', () => {
  it('parses #/sharepoint[/<site>[/<granularité>]] and round-trips', () => {
    const root = '/';
    expect(parseSharePointHash('#/sharepoint')).toEqual({ site: '', scope: null, path: root });
    expect(parseSharePointHash('#/sharepoint/site-1')).toEqual({
      site: 'site-1',
      scope: null,
      path: root,
    });
    expect(parseSharePointHash('#/sharepoint/a%2Cb/site')).toEqual({
      site: 'a,b',
      scope: 'site',
      path: root,
    });
    expect(parseSharePointHash('#/sharepoint/s/nimporte')).toEqual({
      site: 's',
      scope: null,
      path: root,
    });
    expect(parseSharePointHash(sharePointHash('a,b', 'library'))).toEqual({
      site: 'a,b',
      scope: 'library',
      path: root,
    });
    const deep = sharePointHash('a,b', 'item', '/Documents/Plans 2024');
    expect(deep).toBe('#/sharepoint/a%2Cb/item/Documents/Plans%202024');
    expect(parseSharePointHash(deep)).toEqual({
      site: 'a,b',
      scope: 'item',
      path: '/Documents/Plans 2024',
    });
    expect(parseSharePointHash('#/sharepointx')).toBeNull();
    expect(parseSharePointHash('#/sharepoint/%E0%A4%A')).toBeNull();
    expect(screenOf('#/sharepoint/s')).toBe('sharepoint');
  });

  it('carries the open folder after the scope, one segment per level', () => {
    const hash = sharePointHash('s', 'folder', '/Documents partagés/Plans 2024');
    expect(hash).toBe('#/sharepoint/s/folder/Documents%20partag%C3%A9s/Plans%202024');
    expect(parseSharePointHash(hash)).toEqual({
      site: 's',
      scope: 'folder',
      path: '/Documents partagés/Plans 2024',
    });
    expect(sharePointHash('s', 'folder', '/')).toBe('#/sharepoint/s/folder');
    // Sans granularité valide, pas de dossier : l'ancre ne sait pas quoi ouvrir.
    expect(sharePointHash('s', undefined, '/Docs')).toBe('#/sharepoint/s');
    expect(parseSharePointHash('#/sharepoint/s/nimporte/Docs')).toMatchObject({ path: '/' });
    // Aucun filtrage côté navigateur : le chemin part tel quel, le serveur refuse `..`.
    expect(parseSharePointHash('#/sharepoint/s/folder/Docs/..')).toMatchObject({
      path: '/Docs/..',
    });
  });

  it('keeps Restaurer current on the SharePoint screen, with no entry of its own', () => {
    const entries = navEntries('sharepoint', false);
    expect(entries.find((e) => e.label === 'SharePoint')).toBeUndefined();
    expect(entries.find((e) => e.label === 'Restaurer')).toMatchObject({ current: true });
  });
});

describe('SharePoint entries table', () => {
  const rows = [
    {
      name: 'Documents',
      path: '/Documents',
      kind: 'library' as const,
      versionAt: null,
      sizeBytes: null,
    },
    { name: 'Plans', path: '/Plans', kind: 'folder' as const, versionAt: null, sizeBytes: null },
    {
      name: 'plan-a.pdf',
      path: '/plan-a.pdf',
      kind: 'file' as const,
      versionAt: '2026-11-16T01:40:00.000Z',
      sizeBytes: 84_000,
    },
    {
      name: 'plan-b.pdf',
      path: '/plan-b.pdf',
      kind: 'file' as const,
      versionAt: '2026-11-16T01:41:00.000Z',
      sizeBytes: 1_000,
    },
  ];
  const render = (selected: { path: string; kind: 'library' | 'folder' | 'file' } | null) =>
    renderToStaticMarkup(
      <SiteEntriesTable
        siteId="s"
        rows={rows}
        selected={selected}
        onOpen={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

  it('is a table with the same columns as OneDrive, and no emoji', () => {
    const html = render(null);
    for (const h of ['Nom', 'Version du (UTC)', 'Taille']) {
      expect(html).toContain(`scope="col"`);
      expect(html).toContain(`>${h}</th>`);
    }
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(html).toContain('>bibliothèque</span>');
    expect(html).toContain('>dossier</span>');
    expect(html).toContain('href="#/sharepoint/s/item/Plans"');
  });

  it('gives every row a named radio button, library and folder included, and checks one only', () => {
    const html = render({ path: '/plan-b.pdf', kind: 'file' });
    const radios = html.match(/<input[^>]*type="radio"[^>]*\/>/gu) ?? [];
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => /aria-label="([^"]+)"/u.exec(r)?.[1])).toEqual([
      'Documents',
      'Plans',
      'plan-a.pdf',
      'plan-b.pdf',
    ]);
    expect(radios.filter((r) => r.includes('checked'))).toHaveLength(1);
    expect(radios[3]).toContain('checked');
  });

  it('checks a library or a folder without opening it, and keeps its name as a link', () => {
    const html = render({ path: '/Documents', kind: 'library' });
    expect(/<input[^>]*aria-label="Documents"[^>]*>/u.exec(html)?.[0]).toContain('checked');
    expect(html).toContain('href="#/sharepoint/s/item/Documents"');
  });
});

describe('SharePoint breadcrumb', () => {
  const click = (over: Partial<Parameters<typeof followInApp>[0]> = {}) => {
    const ev = {
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      ...over,
    };
    const navigate = vi.fn();
    followInApp(ev, navigate);
    return { ev, navigate };
  };

  it('gives each level its own deep link', () => {
    const html = renderToStaticMarkup(
      <ContentTree
        siteId="a,b"
        siteName="Commerce"
        snapshotId="s1"
        path="/Documents/Plans 2024"
        selected={null}
        onPath={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain('href="#/sharepoint/a%2Cb/item"');
    expect(html).toContain('href="#/sharepoint/a%2Cb/item/Documents"');
    expect(html).toContain('<span aria-current="location">Plans 2024</span>');
  });

  it('navigates in the page on a plain click', () => {
    const { ev, navigate } = click();
    expect(ev.preventDefault).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('opens the clicked level, not another one', () => {
    const levels = breadcrumbLevels('Commerce', '/Documents/Plans 2024');
    expect(levels).toEqual([
      { label: 'Commerce', path: '/' },
      { label: 'Documents', path: '/Documents' },
      { label: 'Plans 2024', path: '/Documents/Plans 2024' },
    ]);
    const onPath = vi.fn();
    const link = breadcrumbLink(levels[1] ?? { path: '' }, 'a,b', 'item', onPath);
    expect(link.href).toBe('#/sharepoint/a%2Cb/item/Documents');
    link.onClick({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });
    expect(onPath).toHaveBeenCalledExactlyOnceWith('/Documents');
  });

  it('ignores the path when the link has no granularity', () => {
    expect(sharePointHash('s', undefined, '/Documents')).toBe('#/sharepoint/s');
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
  ])('leaves a modified click %j to the browser', (over) => {
    const { ev, navigate } = click(over);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('SharePoint wording', () => {
  it('deduces the restored kind from the checked row', () => {
    expect(scopeOfKind('library')).toBe('library');
    expect(scopeOfKind('folder')).toBe('folder');
    expect(scopeOfKind('file')).toBe('item');
    expect(selectionLabel({ path: '/Documents partagés', kind: 'library' })).toBe(
      'Bibliothèque Documents partagés',
    );
    expect(selectionLabel({ path: '/Docs/Plans', kind: 'folder' })).toBe('Dossier Docs > Plans');
    expect(selectionLabel({ path: '/Docs/a.pdf', kind: 'file' })).toBe('Fichier Docs > a.pdf');
    expect(restoredContentLabel('library', '/Documents partagés')).toBe(
      'Bibliothèque : Documents partagés',
    );
    expect(continueHint()).toBe(
      'Cochez un fichier, un dossier ou une bibliothèque pour continuer.',
    );
  });

  it('formats counts and sizes in French', () => {
    expect(summaryCountOf({ items: 1240, sizeBytes: 3_200_000_000 })).toBe(
      '1 240 éléments, 3,2 Go',
    );
    expect(summaryCountOf({ items: 1, sizeBytes: 84_000 })).toBe('1 élément, 84 Ko');
    expect(pathLabel('/Documents partagés/Plans 2024')).toBe('Documents partagés > Plans 2024');
  });

  it('lists the summary rows, with the point of restoration and the reason', () => {
    const input = {
      scope: 'library' as const,
      siteName: 'Site Urbanisme (exemple)',
      path: '/Documents partagés',
      pointAt: '2026-11-12T02:00:00.000Z',
      summary: { items: 1240, sizeBytes: 3_200_000_000 },
      reason: 'Reprise après incident',
    };
    expect(confirmRowsOf(input)).toEqual([
      ['Site', 'Site Urbanisme (exemple)'],
      ['Élément', 'Bibliothèque : Documents partagés'],
      ['Sauvegarde du (UTC)', '12/11/2026 02:00'],
      ['Emplacement', 'Site Urbanisme (exemple) > Documents partagés (emplacement d’origine)'],
      ['Fichiers déjà présents', 'conservés, non remplacés'],
      ['Volume', '1 240 éléments, 3,2 Go'],
      ['Motif', 'Reprise après incident'],
    ]);
    const item = confirmRowsOf({ ...input, scope: 'item', summary: null, path: '/A/b.pdf' });
    expect(item).toContainEqual(['Élément', 'Fichier : A > b.pdf']);
    expect(item.map(([label]) => label)).not.toContain('Volume');
    expect(item).toContainEqual([
      'Emplacement',
      'Site Urbanisme (exemple) > A (emplacement d’origine)',
    ]);
    const folder = confirmRowsOf({ ...input, scope: 'folder', path: '/Documents partagés/Plans' });
    expect(folder).toContainEqual([
      'Emplacement',
      'Site Urbanisme (exemple) > Documents partagés (emplacement d’origine)',
    ]);
    expect(placementRows('item', 'S', '/L/x')[1]).toEqual([
      'Fichiers déjà présents',
      'conservés, non remplacés',
    ]);
  });

  it('lists the whole-site summary with the item count only', () => {
    const rows = confirmRowsOf({
      scope: 'site',
      siteName: 'Équipe commerciale',
      path: '/',
      pointAt: '2026-11-17T14:01:00Z',
      summary: { items: 6, sizeBytes: 1_600_000 },
      reason: 'Reprise',
    });
    expect(rows).toContainEqual(['Élément', 'Site entier']);
    expect(rows).toContainEqual(['Volume', '6 éléments']);
    expect(rows).toContainEqual(['Emplacement', 'Emplacement d’origine de chaque élément']);
    expect(rows).toContainEqual(['Fichiers déjà présents', 'conservés, non remplacés']);
    expect(siteWarningOf('Équipe commerciale')).toBe(
      'Les contenus manquants du site Équipe commerciale seront recréés. Les fichiers existants ne sont pas modifiés.',
    );
  });

  it('orders the whole-site confirmation and ties the hint to the name field', () => {
    const html = renderToStaticMarkup(
      <ConfirmStep
        site={{ id: 'abc', displayName: 'Équipe commerciale' }}
        choice={{ scope: 'site', path: '/', snapshotId: 's1', pointAt: '2026-11-17T14:01:00Z' }}
        reason="Reprise après incident"
        onBack={() => undefined}
        onStarted={() => undefined}
      />,
    );
    expect(html).not.toContain('Vous allez restaurer');
    expect(html).not.toContain('Motif : ');
    const order = [
      '<h2>Récapitulatif</h2>',
      '<dt>Motif</dt><dd>Reprise après incident</dd>',
      'Restauration du site entier',
      'du site Équipe commerciale seront recréés.',
      'Je comprends',
      'Tapez le nom du site',
      'Le bouton reste inactif',
      'wizard-actions',
    ].map((text) => html.indexOf(text));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const help = /<input[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(help).toBeDefined();
    expect(html).toContain(`id="${help ?? ''}"`);
    expect(html.slice(html.indexOf('wizard-actions'))).not.toContain('Le bouton reste inactif');
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Restaurer/);
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
