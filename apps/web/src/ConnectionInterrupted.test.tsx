import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationNotice,
  ConnectionInterrupted,
  RUN_SUSPENDED_TEXT,
  connectionView,
  lastKnownRun,
} from './ConfigurationBlock.js';
import { OverviewView } from './Home.js';
import { HomeCoverage } from './HomeCoverage.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
import { PlansListView } from './plans/PlansListView.js';
import { RunBlocked } from './plans/RunDialog.js';
import type { PlanItem } from './plans.js';

const noop = () => undefined;
const unlinked = { microsoft: { connected: false }, workloads: ['mail'] };
const linked = { microsoft: { connected: true }, workloads: ['mail'] };

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
    lastSuccessAt: '2026-11-26T22:06:00.000Z',
    lastRestorePointAt: '2026-11-26T22:06:00.000Z',
  },
  running: false,
  lastRun: {
    status: 'success',
    startedAt: '2026-11-26T22:05:00.000Z',
    finishedAt: '2026-11-26T22:06:00.000Z',
    noSnapshotReason: null,
  },
};
const failedPlan: PlanItem = {
  ...okPlan,
  id: 'p2',
  name: 'Boîte direction, quotidien',
  compliance: { state: 'failed', lastSuccessAt: null, lastRestorePointAt: null },
  lastRun: {
    status: 'failed',
    startedAt: '2026-11-26T17:54:00.000Z',
    finishedAt: '2026-11-26T17:55:00.000Z',
    noSnapshotReason: null,
    failureCause: 'backup_errors',
  },
};
const neverRun: PlanItem = { ...okPlan, id: 'p3', lastRun: null };
const plans = [failedPlan, okPlan];

const failedOverview: Overview = {
  state: 'failed',
  plans: { total: 2, operational: 1, running: 0, queued: 0, failed: 1, late: 0, waiting: 0 },
  lastBackupAt: '2026-11-26T22:06:00.000Z',
  lastBackupPlan: 'Messagerie Direction',
  lastFailure: { plan: 'Boîte direction, quotidien', at: '2026-11-26T17:55:00.000Z' },
  lateBackups: [],
};
const data: HomeData = {
  coverage: { mail: 5, onedrive: 5, sharepoint: 3 },
  plans,
  events: [],
};

const SINCE = 'Aucune sauvegarde ne part depuis le 26/11/2026 22:06 UTC.';

/** L'accueil d'un administrateur tel que `Home` l'assemble, connexion interrompue. */
const interruptedHome = () =>
  renderToStaticMarkup(
    <main>
      <ConfigurationNotice config={unlinked} plans={plans} />
      <OverviewView
        state={failedOverview}
        admin
        onRetry={noop}
        interruptedSince={lastKnownRun(plans)}
      />
      <HomeCoverage
        overview={failedOverview}
        data={data}
        admin
        connected={false}
        interrupted
        now={new Date('2026-11-26T22:30:00.000Z')}
        onLaunched={noop}
        onRetryEvents={noop}
      />
    </main>,
  );

describe('connectionView: one reading of the Microsoft 365 connection (#604)', () => {
  it('takes the most recent run of all plans as the last known run', () => {
    expect(lastKnownRun(plans)).toBe('2026-11-26T22:06:00.000Z');
    expect(lastKnownRun([neverRun])).toBeNull();
    const running: PlanItem = {
      ...okPlan,
      lastRun: { ...okPlan.lastRun!, finishedAt: null, startedAt: '2026-11-26T23:00:00.000Z' },
    };
    expect(lastKnownRun([okPlan, running])).toBe('2026-11-26T23:00:00.000Z');
  });

  it('is interrupted once a run exists, to configure without any run', () => {
    expect(connectionView(unlinked, plans)).toEqual({
      interruptedSince: '2026-11-26T22:06:00.000Z',
    });
    expect(connectionView(unlinked, [neverRun])).toBe('unconfigured');
    expect(connectionView(unlinked, [])).toBe('unconfigured');
    expect(connectionView(unlinked, 'error')).toBe('unconfigured');
  });

  it('waits for the plans, and says nothing once connected', () => {
    expect(connectionView(unlinked, 'loading')).toBe('loading');
    expect(connectionView('loading', plans)).toBe('loading');
    expect(connectionView(linked, plans)).toBe('connected');
  });
});

describe('Home, connection interrupted', () => {
  it('shows an error Alert titled « Connexion Microsoft 365 interrompue » with the last run, never « pas encore »', () => {
    const notice = renderToStaticMarkup(<ConfigurationNotice config={unlinked} plans={plans} />);
    expect(notice).toContain('alert-error');
    expect(notice).toContain('role="alert"');
    expect(notice).toContain('Connexion Microsoft 365 interrompue');
    expect(notice).toContain(SINCE);
    expect(notice).toContain('<code>.env</code>');
    expect(notice).toContain('<code>secrets/m365_client_secret</code>');
    expect(notice).toContain('<code>docker compose up -d</code>');
    const html = interruptedHome();
    expect(html).not.toContain('pas encore');
    expect(html).not.toContain('à configurer');
    expect(html).toContain('n’est pas rétablie');
  });

  it('says the connection once, in the Alert under the h1, never again in the Backup card (#622)', () => {
    const html = interruptedHome();
    const card = html.indexOf('overview-backup');
    for (const said of [
      'Connexion Microsoft 365 interrompue',
      'Aucune sauvegarde ne part depuis',
    ]) {
      expect(html.split(said)).toHaveLength(2);
      expect(html.indexOf(said)).toBeLessThan(card);
    }
  });

  it('goes from the « Interrompue » pill straight to the failure, with « Voir les sources » as its only button (#622)', () => {
    const html = renderToStaticMarkup(
      <OverviewView
        state={failedOverview}
        admin
        onRetry={noop}
        interruptedSince={lastKnownRun(plans)}
      />,
    );
    const card = html.slice(0, html.indexOf('overview-plans'));
    expect(card).toMatch(/Interrompue<\/span><\/div><p>Échec de/u);
    expect(card).not.toContain('Voir la conduite à tenir');
    expect(card).not.toContain('Voir l’erreur');
    expect(card.match(/<button/gu)).toHaveLength(1);
    expect(card).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>Voir les sources<\/button>/u);
  });

  it('keeps « Voir l’erreur » when the connection is fine', () => {
    const html = renderToStaticMarkup(<OverviewView state={failedOverview} admin onRetry={noop} />);
    expect(html).toContain('Voir l’erreur');
    expect(html).not.toContain('interrompue');
  });
});

describe('Home, connection never configured', () => {
  it('keeps the warning « Connexion Microsoft 365 à configurer » and its three steps', () => {
    const html = renderToStaticMarkup(<ConfigurationNotice config={unlinked} plans={[neverRun]} />);
    expect(html).toContain('alert-warning');
    expect(html).toContain('Connexion Microsoft 365 à configurer');
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain('interrompue');
  });
});

describe('Plans, connection interrupted', () => {
  it('shows the Home Alert plus the suspended launch, once, after « Aucune sauvegarde ne part »', () => {
    const since = lastKnownRun(plans)!;
    const home = renderToStaticMarkup(<ConfigurationNotice config={unlinked} plans={plans} />);
    expect(home).toBe(renderToStaticMarkup(<ConnectionInterrupted since={since} />));
    expect(home).not.toContain(RUN_SUSPENDED_TEXT);
    const alert = renderToStaticMarkup(<ConnectionInterrupted since={since} runSuspended />);
    expect(alert.split(RUN_SUSPENDED_TEXT)).toHaveLength(2);
    expect(alert).toMatch(/Aucune sauvegarde ne part depuis le [^<]*UTC\. Le lancement manuel/u);
  });

  it('shows no « Lancer maintenant » and no connection sentence in any row or plan banner', () => {
    for (const failedOnly of [false, true]) {
      const html = renderToStaticMarkup(
        <PlansListView
          state={plans}
          admin
          configured
          failedOnly={failedOnly}
          runBlocked
          onRetry={noop}
          onRun={noop}
          onDelete={noop}
        />,
      );
      expect(html).not.toContain('Lancer maintenant');
      expect(html).not.toMatch(/aria-label="Lancer [^"]* maintenant"/u);
      expect(html).not.toContain(RUN_SUSPENDED_TEXT);
      expect(html).not.toMatch(/Lancement impossible|connexion Microsoft 365/iu);
      // Les actions de chaque ligne : « Modifier » et « Supprimer », rien d'autre.
      const actions = html.match(/<div class="button-row row-actions[^"]*">.*?<\/div>/gu) ?? [];
      expect(actions).toHaveLength(failedOnly ? 1 : plans.length);
      for (const cell of actions) {
        expect(
          cell
            .replace(/<[^>]+>/gu, '|')
            .split('|')
            .filter(Boolean),
        ).toEqual(['Modifier', 'Supprimer']);
      }
    }
  });

  it('keeps « Lancer maintenant » when the connection is fine', () => {
    const html = renderToStaticMarkup(
      <PlansListView state={plans} admin configured onRetry={noop} onRun={noop} onDelete={noop} />,
    );
    expect(html).toContain('Lancer maintenant');
    expect(html).not.toContain(RUN_SUSPENDED_TEXT);
  });
});

describe('« Lancement impossible » for want of a connection', () => {
  const problem = { message: 'Sauvegarde indisponible', code: 'backup_not_configured' };

  it('is an error Alert with the title and the sentence of the page, without « pas encore »', () => {
    const html = renderToStaticMarkup(
      <RunBlocked
        problem={problem}
        planName="Messagerie Direction"
        reason="Contrôle"
        since={lastKnownRun(plans)}
        onClose={noop}
      />,
    );
    expect(html).toContain('alert-error');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('alert-warning');
    expect(html).toContain('Connexion Microsoft 365 interrompue');
    expect(html).toContain(SINCE);
    expect(html).not.toContain('pas encore');
  });

  it('is an error Alert too when no run was ever made', () => {
    const html = renderToStaticMarkup(
      <RunBlocked problem={problem} planName="Plan" reason="Contrôle" onClose={noop} />,
    );
    expect(html).toContain('alert-error');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('alert-warning');
  });
});
