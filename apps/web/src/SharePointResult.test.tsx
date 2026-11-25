import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrackStep } from './sharepoint/TrackStep.js';
import type { SiteJob } from './sharepoint.js';

const base: SiteJob = {
  id: 'j',
  siteId: 's',
  scope: 'item',
  path: '/Documents partagés/Plans 2024/plan-a.pdf',
  status: 'succeeded',
  startedAt: '2026-11-17T10:00:00.000Z',
  finishedAt: null,
  durationMs: 2000,
  total: 5,
  restored: 3,
  skipped: 0,
  errors: 0,
  copyName: null,
  error: null,
};

const render = (job: Partial<SiteJob>) =>
  renderToStaticMarkup(
    <TrackStep
      job={{ ...base, ...job }}
      siteName="Équipe commerciale"
      onJob={vi.fn()}
      onAgain={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

const renderWith = (job: Partial<SiteJob>, versionAt: string) =>
  renderToStaticMarkup(
    <TrackStep
      job={{ ...base, ...job }}
      versionAt={versionAt}
      siteName="Équipe commerciale"
      onJob={vi.fn()}
      onAgain={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

describe('SharePoint result', () => {
  it('recalls the site and the item, labelled Élément restauré only on success', () => {
    for (const status of ['running', 'succeeded', 'failed'] as const) {
      const html = render({ status, errors: status === 'failed' ? 1 : 0 });
      const label = status === 'succeeded' ? 'Élément restauré' : 'Élément';
      expect(html).toContain('<dt>Site</dt><dd>Équipe commerciale</dd>');
      expect(html).toContain(`<dt>${label}</dt><dd>plan-a.pdf</dd>`);
    }
  });

  it('recalls the whole site, and puts the errors after the labels', () => {
    for (const status of ['succeeded', 'failed'] as const) {
      const html = render({ status, scope: 'site', path: '/', errors: 1 });
      const label = status === 'succeeded' ? 'Élément restauré' : 'Élément';
      expect(html).toContain('<dt>Site</dt><dd>Équipe commerciale</dd>');
      expect(html).toContain(`<dt>${label}</dt><dd>Site entier</dd>`);
      expect(html.indexOf(`<dt>${label}`)).toBeLessThan(html.indexOf('Éléments en erreur'));
    }
  });

  it('names the kind of content for a folder and a library', () => {
    expect(render({ scope: 'folder', path: '/Documents partagés/Contrats' })).toContain(
      '<dt>Élément restauré</dt><dd>Dossier : Documents partagés &gt; Contrats</dd>',
    );
    expect(render({ scope: 'library', path: '/Archives' })).toContain(
      '<dt>Élément restauré</dt><dd>Bibliothèque : Archives</dd>',
    );
  });

  it('recalls the location and the kept files on every step, for each scope', () => {
    const where =
      '<dt>Emplacement</dt><dd>Équipe commerciale &gt; Documents partagés (emplacement d’origine)</dd>';
    const kept = '<dt>Fichiers déjà présents</dt><dd>conservés, non remplacés</dd>';
    for (const status of ['running', 'succeeded', 'failed'] as const) {
      const html = render({ status, errors: status === 'failed' ? 1 : 0 });
      expect(html).toContain(
        '<dt>Emplacement</dt><dd>Équipe commerciale &gt; Documents partagés &gt; Plans 2024 (emplacement d’origine)</dd>',
      );
      expect(html).toContain(kept);
    }
    expect(render({ scope: 'library', path: '/Documents partagés' })).toContain(where);
    expect(render({ scope: 'site', path: '/' })).toContain(
      '<dt>Emplacement</dt><dd>Emplacement d’origine de chaque élément</dd>',
    );
  });

  it('names the copy on success only, and does not repeat the banner', () => {
    expect(render({ copyName: 'plan-a (restauré le 14-11-2026).pdf' })).toContain(
      '<dt>Restauré sous</dt><dd>plan-a (restauré le 14-11-2026).pdf</dd>',
    );
    expect(render({ status: 'failed', copyName: 'x.pdf', errors: 1 })).not.toContain(
      'Restauré sous',
    );
    expect(render({ skipped: 1 })).not.toContain('n’a été écrasé');
    expect(render({})).toContain('n’a été écrasé');
  });

  it('writes the shared failure sentence, with no restored label', () => {
    const html = render({ status: 'failed', restored: 0, errors: 1, error: 'restore_error' });
    expect(html).toContain('Le service de restauration a signalé une erreur.');
    expect(html).toContain('Rien n’a été modifié.');
    expect(html).toContain('Réessayez ; si l’échec se répète');
    expect(html).not.toContain('Élément restauré');
    expect(html).not.toContain('Éléments restaurés');
  });

  it('counts the restored items and keeps "écrasé" on a partial failure', () => {
    const html = render({ status: 'failed', restored: 2, errors: 1, error: 'restore_error' });
    expect(html).toContain('<dt>Éléments restaurés</dt><dd>2</dd>');
    expect(html).toContain('2 éléments restaurés, 1 élément en erreur.');
  });

  it('shows a single failed file once, with its folder and version date, and no error counters', () => {
    const html = renderWith(
      { status: 'failed', restored: 0, errors: 1, error: 'restore_error' },
      '2026-11-10T08:30:00.000Z',
    );
    expect(html.split('plan-a.pdf').length - 1).toBe(2);
    expect(html).not.toContain('Éléments en erreur');
    expect(html).not.toContain('<dt>En erreur</dt>');
    expect(html).toContain('<dt>Date de la version (UTC)</dt><dd>10/11/2026\u00a008:30</dd>');
    expect(html).toContain('Plans 2024 (emplacement d’origine)');
  });

  it('names the folder holding the failed items', () => {
    const html = render({
      status: 'failed',
      scope: 'folder',
      path: '/Documents partagés/Contrats',
      restored: 2,
      errors: 2,
      error: 'restore_error',
    });
    expect(html).toContain('<dt>En erreur</dt><dd>dans Documents partagés &gt; Contrats</dd>');
  });

  it('says the state is uncertain when the outcome is unknown', () => {
    const html = render({ status: 'failed', error: 'restore_lost' });
    expect(html).toContain('L’état de SharePoint est incertain');
  });
});
