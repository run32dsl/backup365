import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleFooter } from './ConsoleFooter.js';
import {
  OverviewView,
  Home,
  agoLabel,
  announcementOf,
  focusAfterRetry,
  loadOverview,
  plansLabel,
  type OverviewState,
} from './Home.js';
import { fetchHealth } from './health.js';
import { fetchOverview, type Overview } from './overview.js';

const NOW = Date.parse('2026-11-18T17:02:00Z');
const retry = () => undefined;
const render = (state: Parameters<typeof OverviewView>[0]['state'], admin = true) =>
  renderToStaticMarkup(<OverviewView state={state} admin={admin} onRetry={retry} now={NOW} />);

const operational: Overview = {
  state: 'operational',
  plans: { total: 4, operational: 4 },
  lastBackupAt: '2026-11-18T14:02:00Z',
};
const unconfigured: Overview = {
  state: 'unconfigured',
  plans: { total: 0, operational: 0 },
  lastBackupAt: null,
};
const pending: Overview = {
  state: 'pending',
  plans: { total: 1, operational: 0 },
  lastBackupAt: null,
};
const failed: Overview = {
  state: 'failed',
  plans: { total: 4, operational: 2 },
  lastBackupAt: '2026-11-16T02:00:00Z',
};

describe('Home', () => {
  it('shows a loading state, with no figure, before the answer', () => {
    const html = renderToString(<Home />);
    expect(html).toContain('Tableau de bord');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement…');
    expect(html).not.toContain('Serveur');
    expect(html).not.toContain('Erreur inattendue');
  });
});

describe('OverviewView', () => {
  it('operational: pill, plans count with link, date, and no button', () => {
    const html = render(operational);
    expect(html).toContain('Opérationnelle');
    expect(html).toContain('4 plans opérationnels sur 4');
    expect(html).toContain('href="#/plans"');
    expect(html).toContain('il y a 3 h');
    expect(html).toContain('<time dateTime="2026-11-18T14:02:00Z">18/11/2026 14:02</time>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('unconfigured: one Configurer button, no plan link, no backup', () => {
    const html = render(unconfigured);
    expect(html).toContain('Non configurée');
    expect(html).toContain('Aucune donnée Microsoft 365 n’est encore protégée.');
    expect(html).toContain('Aucun plan');
    expect(html).toContain('Aucune sauvegarde');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Configurer');
    expect(html).not.toContain('Voir les plans');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('unconfigured, operator: no button, asks an administrator', () => {
    const html = render(unconfigured, false);
    expect(html).not.toContain('<button');
    expect(html).toContain(
      'Demandez à un administrateur de la console de configurer la sauvegarde.',
    );
  });

  it('pending (plans without any result): En attente pill, never Non configurée, no button', () => {
    for (const admin of [true, false]) {
      const html = render(pending, admin);
      expect(html).not.toContain('Non configurée');
      expect(html).not.toContain('Configurer');
      expect(html).toContain('<span aria-hidden="true">◷</span> En attente');
      expect(html).toContain('role="status"');
      expect(html).not.toContain('<button');
      expect(html).toContain('Aucune sauvegarde n’est encore terminée.');
      expect(html).toContain('0 plan opérationnel sur 1');
      expect(html).toContain('Voir les plans');
      expect(html.match(/<section/g)).toHaveLength(3);
      expect(html).not.toContain('Erreur inattendue');
    }
  });

  it('failed: one Voir l’erreur button, a plain message, last success date', () => {
    const html = render(failed, false);
    expect(html).toContain('En échec');
    expect(html).toContain('La dernière exécution a échoué.');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Voir l’erreur');
    expect(html).toContain('2 plans opérationnels sur 4');
    expect(html).toContain('il y a 2 j');
    expect(html).toContain('(dernière réussie)');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('request error: an alert with Réessayer as the only action', () => {
    const html = render('error');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Impossible d’afficher l’état de la sauvegarde.');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('has three titled sections in reading order', () => {
    const html = render(operational);
    expect(html.match(/<section[^>]*aria-labelledby/g)).toHaveLength(3);
    expect(html.indexOf('>Sauvegarde<')).toBeLessThan(html.indexOf('>Plans<'));
    expect(html.indexOf('>Plans<')).toBeLessThan(html.indexOf('>Dernière sauvegarde<'));
  });
});

describe('retry after an error', () => {
  const run = async (fetcher: () => Promise<Overview>) => {
    const states: OverviewState[] = [];
    await loadOverview((s) => states.push(s), fetcher);
    return states;
  };
  const fail = () => Promise.reject(new Error('HTTP 503'));

  it('goes back to loading (aria-busy) then shows the data', async () => {
    expect(await run(fail)).toEqual(['loading', 'error']);
    const states = await run(() => Promise.resolve(operational));
    expect(states).toEqual(['loading', operational]);
    const html = render(states[0]!);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="alert"');
    const done = render(states[1]!);
    expect(done).not.toContain('aria-busy');
    expect(done).toContain('4 plans opérationnels sur 4');
  });

  it('shows the alert again, without « Erreur inattendue », after a new error', async () => {
    const states = await run(fail);
    expect(states.at(-1)).toBe('error');
    const html = render('error');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('announces the new state inside a role="status" zone', () => {
    expect(renderToString(<Home />)).toMatch(/<div role="status"[^>]*><\/div>/);
    expect(announcementOf('loading')).toBe('Chargement de l’état de la sauvegarde…');
    expect(announcementOf(operational)).toBe('État de la sauvegarde mis à jour.');
    expect(announcementOf('error')).toBe('');
  });

  it('puts the focus on the Sauvegarde title, else on the h1, never on body', () => {
    const focused: string[] = [];
    const el = (name: string) => ({ focus: () => focused.push(name) });
    focusAfterRetry({ querySelector: (q) => (q === '#overview-backup' ? el('card') : el('h1')) });
    focusAfterRetry({ querySelector: (q) => (q === 'h1' ? el('h1') : null) });
    expect(focused).toEqual(['card', 'h1']);
    expect(render(operational)).toContain('<h2 id="overview-backup" tabindex="-1">Sauvegarde</h2>');
    expect(renderToStaticMarkup(<Home />)).toContain('<h1 tabindex="-1">Tableau de bord</h1>');
  });
});

describe('labels', () => {
  it('writes the plans count in the singular and plural', () => {
    expect(plansLabel(1, 1)).toBe('1 plan opérationnel sur 1');
    expect(plansLabel(0, 3)).toBe('0 plan opérationnel sur 3');
    expect(plansLabel(3, 4)).toBe('3 plans opérationnels sur 4');
  });

  it('writes the age in hours then days', () => {
    expect(agoLabel('2026-11-18T16:40:00Z', NOW)).toBe('il y a moins d’1 h');
    expect(agoLabel('2026-11-18T14:02:00Z', NOW)).toBe('il y a 3 h');
    expect(agoLabel('2026-11-16T02:00:00Z', NOW)).toBe('il y a 2 j');
  });
});

describe('fetchOverview', () => {
  it('reads /api/overview', async () => {
    let url = '';
    const fake = ((input: string) => {
      url = input;
      return Promise.resolve(Response.json(operational));
    }) as typeof fetch;
    await expect(fetchOverview(fake)).resolves.toEqual(operational);
    expect(url).toBe('/api/overview');
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    await expect(fetchOverview(fake)).rejects.toThrow('HTTP 503');
  });
});

describe('ConsoleFooter', () => {
  it('shows the server version', () => {
    expect(renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo={false} />)).toContain(
      'Version 1.4.2',
    );
  });

  it('shows a version built from the image', () => {
    expect(
      renderToStaticMarkup(<ConsoleFooter version="0.1.0 · abc1234" demo={false} />),
    ).toContain('Version 0.1.0 · abc1234');
  });

  it('links to the components page in demo mode only', () => {
    const demo = renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo />);
    expect(demo).toContain('href="#/composants"');
    expect(demo).toContain(
      '<span class="console-footer-item console-footer-link"><a href="#/composants">Composants</a> (démo seulement)</span>',
    );
    expect(renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo={false} />)).not.toContain(
      'Composants',
    );
  });

  it('renders nothing before the version is known', () => {
    expect(renderToStaticMarkup(<ConsoleFooter demo={false} />)).toBe('');
  });
});

describe('fetchHealth', () => {
  it('parses the health response', async () => {
    const fake = (() =>
      Promise.resolve(Response.json({ status: 'ok', version: '2.0.0' }))) as typeof fetch;
    await expect(fetchHealth(fake)).resolves.toEqual({ status: 'ok', version: '2.0.0' });
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch;
    await expect(fetchHealth(fake)).rejects.toThrow('HTTP 500');
  });
});
