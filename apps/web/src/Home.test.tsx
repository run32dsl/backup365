import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleFooter } from './ConsoleFooter.js';
import {
  BackupAction,
  PlansAction,
  OverviewView,
  Home,
  agoLabel,
  announcementOf,
  focusAfterRetry,
  lateMessage,
  loadOverview,
  plansLabel,
  waitingLabel,
  type OverviewState,
} from './Home.js';
import { fetchHealth } from './health.js';
import { fetchOverview, type Overview } from './overview.js';
import { MESSAGES as PLAN_MESSAGES, NEW_PLAN_HASH, PLANS_HASH } from './plans.js';

const NOW = Date.parse('2026-11-18T17:02:00Z');
const retry = () => undefined;
const render = (state: Parameters<typeof OverviewView>[0]['state'], admin = true) =>
  renderToStaticMarkup(<OverviewView state={state} admin={admin} onRetry={retry} now={NOW} />);

const operational: Overview = {
  state: 'operational',
  plans: { total: 4, operational: 4, running: 0, queued: 0, failed: 0, late: 0, waiting: 0 },
  lastBackupAt: '2026-11-18T14:02:00Z',
  lastBackupPlan: 'Boîtes mail, quotidien',
  lastFailure: null,
  lateBackups: [],
};
const unconfigured: Overview = {
  state: 'unconfigured',
  plans: { total: 0, operational: 0, running: 0, queued: 0, failed: 0, late: 0, waiting: 0 },
  lastBackupAt: null,
  lastBackupPlan: null,
  lastFailure: null,
  lateBackups: [],
};
const pending: Overview = {
  state: 'pending',
  plans: { total: 1, operational: 0, running: 0, queued: 0, failed: 0, late: 0, waiting: 1 },
  lastBackupAt: null,
  lastBackupPlan: null,
  lastFailure: null,
  lateBackups: [],
};
const failed: Overview = {
  state: 'failed',
  plans: { total: 4, operational: 2, running: 0, queued: 0, failed: 1, late: 1, waiting: 0 },
  lastBackupAt: '2026-11-16T02:00:00Z',
  lastBackupPlan: 'Boîtes mail, quotidien',
  lastFailure: { plan: 'Boîte direction, quotidien', at: '2026-11-24T18:58:30Z' },
  lateBackups: [],
};

describe('OverviewView, late backups', () => {
  const oneDrive = {
    service: 'onedrive' as const,
    name: 'paul.moreau@exemple.fr',
    lastSnapshotAt: '2026-11-15T18:19:00Z',
  };

  it('never says Opérationnelle with a late backup, and links to Sources', () => {
    const html = render({ ...operational, lateBackups: [oneDrive] });
    expect(html).toContain('En retard');
    expect(html).not.toContain('Opérationnelle');
    expect(html).toContain(
      '1 sauvegarde en retard : OneDrive, paul.moreau@exemple.fr, dernière réussite le 15/11/2026 18:19 UTC.',
    );
    expect(html).toMatch(/<button[^>]*btn-secondary[^>]*>Voir les sources<\/button>/);
  });

  it('summarises several late backups by service', () => {
    const late = [
      oneDrive,
      { ...oneDrive, name: 'x' },
      { ...oneDrive, service: 'sharepoint' as const },
    ];
    expect(lateMessage(late)).toBe('3 sauvegardes en retard (OneDrive, SharePoint).');
  });

  it('keeps the failure first: failed pill, full Voir l’erreur, late line and outline button', () => {
    const html = render({ ...failed, lateBackups: [oneDrive] });
    expect(html).toContain('Échec de');
    expect(html).toContain('1 sauvegarde en retard');
    expect(html).toMatch(/<button(?![^>]*btn-secondary)[^>]*>Voir l’erreur<\/button>/);
    expect(html).toMatch(/<button[^>]*btn-secondary[^>]*>Voir les sources<\/button>/);
  });

  it('counts the plan covering the late backup as late on the Plans card (#495)', () => {
    const html = render({
      ...operational,
      plans: { total: 2, operational: 1, running: 0, queued: 0, failed: 0, late: 1, waiting: 0 },
      lateBackups: [oneDrive],
    });
    expect(html).not.toContain('2 plans à jour sur 2');
    expect(html).toContain('1 plan à jour sur 2');
    expect(html).toMatch(/plan-counts[\s\S]*En retard[\s\S]*<strong>1<\/strong>/);
  });

  it('shows Opérationnelle and no Voir les sources without late backups', () => {
    const html = render(operational);
    expect(html).toContain('Opérationnelle');
    expect(html).not.toContain('Voir les sources');
  });
});

// Le bandeau d'envoi non parti se charge après rendu : un repère montre sa place dans la page.
vi.mock('./reports/ReportFailureNotice.js', () => ({
  ReportFailureNotice: () => <div id="report-failure-slot" />,
}));

describe('Home', () => {
  it('puts the Sauvegarde card first under the h1, and the report failure after the three cards', () => {
    const html = renderToStaticMarkup(<Home />);
    const afterH1 = html.slice(html.indexOf('</h1>'));
    expect(afterH1).toMatch(
      /^<\/h1><div role="status" class="sr-only"><\/div><div class="overview"/u,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at('id="overview-backup"')).toBeLessThan(at('id="overview-plans"'));
    expect(at('id="overview-plans"')).toBeLessThan(at('id="overview-last"'));
    expect(at('id="overview-last"')).toBeLessThan(at('id="report-failure-slot"'));
  });

  it('shows a loading state, with no figure, before the answer', () => {
    const html = renderToString(<Home />);
    expect(html).toContain('Accueil');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement…');
    expect(html).not.toContain('Serveur');
    expect(html).not.toContain('Erreur inattendue');
  });
});

describe('OverviewView', () => {
  it('operational: pill, plans count, date, one secondary Voir les plans button', () => {
    const html = render(operational);
    expect(html).toContain('Opérationnelle');
    expect(html).toContain('4 plans à jour sur 4');
    expect(html).not.toContain('<a ');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*btn-secondary[^>]*>Voir les plans<\/button>/);
    expect(html).toContain('il y a 3 h');
    expect(html).toContain('<time dateTime="2026-11-18T14:02:00Z">18/11/2026 14:02 UTC</time>');
    expect(html).toContain('Plan : Boîtes mail, quotidien');
    expect(html).not.toContain('Dernière sauvegarde réussie ;');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('unconfigured: one Créer un plan button in the Sauvegarde card, said once, plain lines', () => {
    const html = render(unconfigured);
    expect(html).toContain('Non configurée');
    expect(html.match(/protégée/g)).toHaveLength(1);
    expect(html).toContain('<p>Aucun plan pour l’instant.</p>');
    expect(html).toContain('<p>Aucune sauvegarde n’est encore terminée.</p>');
    expect(html.match(/<button/g)).toHaveLength(1);
    const backupCard = html.split('<section')[1] ?? '';
    expect(backupCard).toContain('Créer un plan</button>');
    expect(html).not.toContain('Configurer');
    expect(html).not.toContain('empty');
    expect(html).not.toContain('Voir les plans');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('Voir les plans opens the plans list', () => {
    const win = { location: { hash: '' } };
    vi.stubGlobal('window', win);
    try {
      const button = PlansAction() as { props: { onClick: () => void } };
      button.props.onClick();
      expect(win.location.hash).toBe(PLANS_HASH);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('unconfigured: Créer un plan opens the wizard, not the list', () => {
    const win = { location: { hash: '' } };
    vi.stubGlobal('window', win);
    try {
      const button = BackupAction({ state: 'unconfigured', admin: true }) as {
        props: { onClick: () => void };
      };
      button.props.onClick();
      expect(win.location.hash).toBe(NEW_PLAN_HASH);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('unconfigured, operator: no button, asks an administrator, plain plans line', () => {
    const html = render(unconfigured, false);
    expect(html).not.toContain('<button');
    expect(html).toContain('<p>Aucun plan pour l’instant.</p>');
    expect(html).not.toContain('empty');
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
      expect(html.match(/<button/g)).toHaveLength(1);
      expect(html).toContain('Aucune sauvegarde n’est encore terminée.');
      expect(html).toContain('Voir les plans');
      // #600 : les cartes ne se contredisent pas, une seule phrase pour la même absence.
      const cards = html.split('<section').slice(1);
      expect(cards[1]).toContain('<span aria-hidden="true">◷</span> En attente');
      expect(cards[1]).toContain('1 plan, en attente de sa première sauvegarde');
      expect(cards[1]).not.toContain('En retard');
      expect(cards[1]).not.toContain('à jour');
      expect(cards[2]).toContain('<p>Aucune sauvegarde n’est encore terminée.</p>');
      expect(html.match(/Aucune sauvegarde n’est encore terminée\./g)).toHaveLength(2);
      expect(html.match(/<section/g)).toHaveLength(3);
      expect(html).not.toContain('Erreur inattendue');
    }
  });

  it('a plan without any finished run beside others: counted En attente, never late (#600)', () => {
    const plans = { ...operational.plans, total: 2, operational: 1, waiting: 1 };
    const card = render({ ...operational, plans }).split('<section')[2] ?? '';
    expect(card).toContain('1 plan à jour sur 2');
    expect(card).toContain(
      '<span aria-hidden="true">◷</span> En attente</span> <strong>1</strong>',
    );
    expect(card).not.toContain('En retard');
  });

  it('failed: Voir l’erreur and Voir les plans buttons, a plain message, last success date', () => {
    const html = render(failed, false);
    expect(html).toContain('En échec');
    expect(html).toContain(
      'Échec de «\u202FBoîte direction, quotidien\u202F» le 24/11/2026 18:58 UTC.',
    );
    expect(html).not.toContain('La dernière exécution');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('Voir l’erreur');
    expect(html).toContain('2 plans à jour sur 4');
    expect(html).toContain('il y a 2 j');
    expect(html).not.toContain('(dernière réussie)');
    expect(html).not.toContain('un plan est en échec');
    expect(render({ ...failed, lastBackupPlan: null })).not.toContain('Plan : ');
    // Sans plan nommé (réponse d'un ancien serveur) : la phrase générique, jamais «\u202Fdernière exécution\u202F».
    expect(render({ ...failed, lastFailure: null })).toContain('Un plan est en échec.');
    expect(html).toContain('Plan : Boîtes mail, quotidien');
    expect(html).toContain('02:00 UTC</time>');
    expect(html).not.toContain('Erreur inattendue');
  });

  it('Plans card: running and queued plans with the pills and words of the plans list', () => {
    const busy = render({ ...failed, plans: { ...failed.plans, running: 1, queued: 2 } });
    const card = busy.slice(busy.indexOf('>Plans<'), busy.indexOf('>Dernière sauvegarde<'));
    expect(card).toContain(
      `<span aria-hidden="true">↻</span> ${PLAN_MESSAGES.running}</span> <strong>1</strong>`,
    );
    expect(card).toContain(
      `<span aria-hidden="true">◷</span> ${PLAN_MESSAGES.queued}</span> <strong>2</strong>`,
    );
    // Le dernier résultat reste dit : le décompte «\u202Fà jour\u202F» et l'état de la carte «\u202FSauvegarde\u202F».
    expect(card).toContain('2 plans à jour sur 4');
    expect(busy).toContain('Échec de «\u202FBoîte direction, quotidien\u202F»');
    const queuedOnly = render({ ...failed, plans: { ...failed.plans, queued: 1 } });
    expect(queuedOnly).toContain('En file d’attente');
    expect(queuedOnly).not.toContain('En cours');
    // Au repos : aucune pastille d'activité.
    expect(render(operational)).not.toContain('plan-counts');
  });

  it('Plans card: four states as pills, most serious first, none for a zero count', () => {
    const all = render({ ...failed, plans: { ...failed.plans, running: 1, queued: 2 } });
    const card = all.slice(all.indexOf('>Plans<'), all.indexOf('>Dernière sauvegarde<'));
    const order = ['En échec', 'En retard', PLAN_MESSAGES.running, PLAN_MESSAGES.queued].map((w) =>
      card.indexOf(`${w}</span> <strong>`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(card.match(/class="badge /g)).toHaveLength(4);
    expect(card).toContain('2 plans à jour sur 4</p>');
    const none = render({ ...failed, plans: { ...failed.plans, failed: 0, late: 0, waiting: 0 } });
    expect(none).not.toContain('plan-counts');
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
    expect(done).toContain('4 plans à jour sur 4');
  });

  it('shows the alert again, without «\u202FErreur inattendue\u202F», after a new error', async () => {
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
    expect(renderToStaticMarkup(<Home />)).toContain('<h1 tabindex="-1">Accueil</h1>');
  });
});

describe('labels', () => {
  it('writes the plans count in the singular and plural', () => {
    expect(plansLabel(1, 1)).toBe('1 plan à jour sur 1');
    expect(plansLabel(0, 3)).toBe('0 plan à jour sur 3');
    expect(plansLabel(3, 4)).toBe('3 plans à jour sur 4');
    expect(waitingLabel(1)).toBe('1 plan, en attente de sa première sauvegarde');
    expect(waitingLabel(2)).toBe('2 plans, en attente de leur première sauvegarde');
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
