import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OverviewView } from './Home.js';
import type { Overview } from './overview.js';
import { PlansIntro, PlansListView } from './PlansPage.js';
import { FAILED_PLANS_HASH, complianceView, parsePlansHash, type PlanItem } from './plans.js';

const noop = () => undefined;

const okPlan: PlanItem = {
  id: 'p1',
  name: 'Messagerie Direction',
  scope: 'all',
  dataTypes: ['mail'],
  rpoHours: 12,
  retentionDays: 365,
  createdAt: '2026-11-01T08:00:00.000Z',
  compliance: {
    state: 'compliant',
    lastSuccessAt: '2026-11-19T06:00:00.000Z',
    lastRestorePointAt: '2026-11-19T06:00:00.000Z',
  },
  running: false,
  lastRun: {
    status: 'success',
    startedAt: '2026-11-19T05:59:00.000Z',
    finishedAt: '2026-11-19T06:00:00.000Z',
    noSnapshotReason: null,
  },
};
const failedPlan: PlanItem = {
  ...okPlan,
  id: 'p2',
  name: 'Plan en échec',
  compliance: { state: 'failed', lastSuccessAt: null, lastRestorePointAt: null },
  lastRun: {
    status: 'failed',
    startedAt: '2026-11-19T17:54:00.000Z',
    finishedAt: '2026-11-19T17:55:00.000Z',
    noSnapshotReason: null,
    failureCause: 'interrupted',
  },
};

const list = (state: PlanItem[], failedOnly: boolean) =>
  renderToStaticMarkup(
    <PlansListView
      state={state}
      admin
      configured
      failedOnly={failedOnly}
      onRetry={noop}
      onRun={noop}
      onDelete={noop}
    />,
  );

describe('failure cause on the plans list', () => {
  it('writes the cause in French under the pill, with no code', () => {
    expect(complianceView(failedPlan)).toEqual({
      status: 'failed',
      label: 'En échec',
      note: 'Sauvegarde interrompue · Aucune sauvegarde réussie',
    });
    const html = list([failedPlan], false);
    expect(html).toContain('Sauvegarde interrompue');
    expect(html).not.toContain('interrupted');
  });

  it('opens on the failed plans only when asked, with a link to the whole list', () => {
    const html = list([okPlan, failedPlan], true);
    expect(html).toContain('Plan en échec');
    expect(html).not.toContain('Messagerie Direction');
    expect(html).not.toContain('Voir tous les plans');
    expect(list([okPlan, failedPlan], false)).toContain('Messagerie Direction');
    // Aucun plan en échec : la liste entière, pas une page vide.
    expect(list([okPlan], true)).toContain('Messagerie Direction');
  });

  it('counts a plan whose last run failed even when it is still up to date, and says why', () => {
    const recent: PlanItem = { ...failedPlan, compliance: okPlan.compliance };
    expect(complianceView(recent)).toMatchObject({
      status: 'compliant',
      note: 'Dernière exécution en échec : sauvegarde interrompue',
    });
    expect(list([okPlan, recent], true)).not.toContain('Messagerie Direction');
  });

  it.each([
    ['interrupted', 'Sauvegarde interrompue'],
    ['backup_errors', 'Des dossiers n’ont pas pu être sauvegardés'],
    ['no_result', 'Aucune donnée n’a été sauvegardée'],
    ['unknown', 'Cause non précisée'],
  ] as const)('shows an error banner with name, UTC date and cause for %s', (cause, label) => {
    const plan: PlanItem = {
      ...failedPlan,
      lastRun: { ...failedPlan.lastRun!, failureCause: cause },
    };
    const html = list([okPlan, plan], true);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Échec de « Plan en échec » le 19/11/2026 17:55 UTC');
    expect(html).toContain(`${label}.`);
    expect(html).toContain('Ces données ne sont pas encore protégées.');
    expect(html).toContain('prévenez l’exploitant du serveur');
    expect(html).not.toContain('Voir tous les plans');
  });

  it('offers a primary run button to an administrator only', () => {
    const html = list([failedPlan], true);
    expect(html).toContain('Relancez le plan');
    expect(html).toMatch(/class="btn btn-primary alert-run"[^>]*>Lancer maintenant/);
    const operator = renderToStaticMarkup(
      <PlansListView
        state={[failedPlan]}
        admin={false}
        configured
        failedOnly
        onRetry={noop}
        onRun={noop}
        onDelete={noop}
      />,
    );
    expect(operator).toContain('role="alert"');
    expect(operator).toContain('Demandez à un administrateur de relancer le plan');
    expect(operator).not.toContain('Lancer maintenant');
  });

  it('explains why the banner run button is unavailable while the plan runs', () => {
    const html = list([{ ...failedPlan, running: true }], true);
    expect(html).toContain('banner-run-hint-p2');
  });

  it('says nothing about protection when a backup has already succeeded', () => {
    const recent: PlanItem = { ...failedPlan, compliance: okPlan.compliance };
    expect(list([recent], true)).not.toContain('pas encore protégées');
  });

  it('Voir l’erreur targets the filtered list', () => {
    expect(parsePlansHash(FAILED_PLANS_HASH)).toEqual({ page: 'list', failedOnly: true });
  });
});

describe('plans card of the dashboard', () => {
  const overview = (plans: Overview['plans']): Overview => ({
    state: 'failed',
    plans,
    lastBackupAt: null,
    lastBackupPlan: null,
    lastFailure: null,
    lateBackups: [],
  });
  const render = (plans: Overview['plans'], admin: boolean) =>
    renderToStaticMarkup(<OverviewView state={overview(plans)} admin={admin} onRetry={noop} />);

  it('names the failed and late plans with pills, not in the counter text', () => {
    const plans = { total: 4, operational: 2, running: 0, queued: 0, failed: 1, late: 1 };
    const page = render(plans, false);
    const html = page.slice(page.indexOf('>Plans<'), page.indexOf('>Dernière sauvegarde<'));
    expect(html).toContain('2 plans à jour sur 4</p>');
    expect(html).toContain('En échec</span> <strong>1</strong>');
    expect(html).toContain('En retard</span> <strong>1</strong>');
    expect(html).not.toContain('en échec');
    expect(html).not.toContain('en retard');
  });

  it('without plan: one plain line, no empty state and no button, for both roles', () => {
    const none = { total: 0, operational: 0, running: 0, queued: 0, failed: 0, late: 0 };
    for (const admin of [true, false]) {
      const html = render(none, admin);
      expect(html).toContain('<p>Aucun plan pour l’instant.</p>');
      expect(html).not.toContain('class="empty"');
    }
  });
});

describe('failed plans view, one run button per plan', () => {
  it('shows the run button once for a failed plan shown alone, and keeps Modifier and Supprimer', () => {
    const html = list([okPlan, failedPlan], true);
    expect(html.match(/Lancer maintenant/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Modifier Plan en échec"');
    expect(html).toContain('aria-label="Supprimer Plan en échec"');
    expect(html).toContain('row-actions-no-run');
  });

  it('keeps the three row actions on the full list', () => {
    const html = list([okPlan, failedPlan], false);
    expect(html.match(/Lancer maintenant/g)).toHaveLength(2);
    expect(html).not.toContain('row-actions-no-run');
  });

  it('says the filter and links to the full list on the same line', () => {
    const html = renderToStaticMarkup(<PlansIntro shown={1} total={4} />);
    expect(html).toContain('Plans en échec : 1 sur 4.');
    expect(html).toContain('Voir les 4 plans</a>');
    expect(renderToStaticMarkup(<PlansIntro shown={1} total={1} />)).not.toContain('<a ');
    expect(renderToStaticMarkup(<PlansIntro />)).toContain('Ce que chaque plan sauvegarde');
  });
});
