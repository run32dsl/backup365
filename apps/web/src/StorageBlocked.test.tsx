import type { StatusReport } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RUN_SUSPENDED_TEXT } from './ConfigurationBlock.js';
import { OverviewView } from './Home.js';
import { HomeCoverage } from './HomeCoverage.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
import { PlansListView } from './plans/PlansListView.js';
import type { PlanItem } from './plans.js';
import { AUDIT_REMINDER, RestoreReminders } from './RestoreJourney.js';
import {
  HomeAlerts,
  RunHaltedAlerts,
  STORAGE_BLOCKED_ACTION,
  STORAGE_BLOCKED_TITLE,
  STORAGE_NEXT_TEXT,
  STORAGE_RUN_SUSPENDED_TEXT,
  StorageBlocked,
  storageBlocked,
} from './StorageBlocked.js';

const noop = () => undefined;
const linked = { microsoft: { connected: true }, workloads: ['mail'] };
const unlinked = { microsoft: { connected: false }, workloads: ['mail'] };

const plan: PlanItem = {
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
const overview: Overview = {
  state: 'operational',
  plans: { total: 1, operational: 1, running: 0, queued: 0, failed: 0, late: 0, waiting: 0 },
  lastBackupAt: '2026-11-26T22:06:00.000Z',
  lastBackupPlan: 'Messagerie Direction',
  lastFailure: null,
  lateBackups: [],
};
const data = (blocked: boolean): HomeData => ({
  coverage: { mail: 5, onedrive: 5, sharepoint: 3 },
  plans: [plan],
  events: [],
  storageBlocked: blocked,
});

/** L'accueil d'un administrateur tel que `Home` l'assemble, connexion Microsoft 365 reliée. */
const home = (blocked: boolean) =>
  renderToStaticMarkup(
    <main>
      <h1>Accueil</h1>
      <HomeAlerts blocked={blocked} config={linked} plans={[plan]} listed={[]} />
      <OverviewView
        state={overview}
        admin
        onRetry={noop}
        storageBlocked={blocked}
        onShowConnection={noop}
      />
      <HomeCoverage
        overview={overview}
        data={data(blocked)}
        admin
        now={new Date('2026-11-26T22:30:00.000Z')}
        onLaunched={noop}
        onRetryEvents={noop}
      />
    </main>,
  );

/** Premier `Alert` d'un fragment HTML, jusqu'à sa fin. */
const firstAlert = (html: string) => {
  const start = html.indexOf('<div class="alert');
  return start < 0 ? '' : html.slice(start, html.indexOf('</div></div>', start));
};

describe('storageBlocked: only a storage that ignores conditional writes (#612)', () => {
  it('is true for `ignored`, false otherwise or when the server says nothing', () => {
    const base = { storage: { conditionalWrites: 'ignored' } } as const;
    expect(storageBlocked(base)).toBe(true);
    for (const conditionalWrites of ['supported', 'not_probed', null] as const)
      expect(storageBlocked({ storage: { conditionalWrites } })).toBe(false);
    expect(storageBlocked({} as Pick<StatusReport, 'storage'>)).toBe(false);
    expect(storageBlocked(null)).toBe(false);
  });

  it('is an error Alert titled after the consequence, the course of action first', () => {
    const html = renderToStaticMarkup(<StorageBlocked />);
    expect(html).toMatch(/^<div class="alert alert-error" role="alert">/u);
    expect(html).toContain(`<strong class="alert-title">${STORAGE_BLOCKED_TITLE}</strong>`);
    expect(html).toContain(STORAGE_BLOCKED_ACTION);
    expect(html).not.toMatch(/stockage à vérifier/iu);
  });
});

describe('Home, blocked storage (#612)', () => {
  it('shows the error Alert right under the h1, even with a linked connection', () => {
    const html = home(true);
    expect(html.indexOf('<div class="alert')).toBe(html.indexOf('</h1>') + '</h1>'.length);
    expect(firstAlert(html)).toContain('role="alert"');
    expect(firstAlert(html)).toContain(STORAGE_BLOCKED_TITLE);
  });

  it('marks the Backup card « Interrompue », without a next backup nor « Sauvegarder maintenant »', () => {
    const html = home(true);
    const card = html.slice(html.indexOf('overview-backup'), html.indexOf('overview-plans'));
    expect(card).toContain('Interrompue');
    expect(card).toContain(`${STORAGE_BLOCKED_TITLE}.`);
    expect(card).toContain('Voir la conduite à tenir');
    expect(card).not.toContain('Opérationnelle');
    expect(html).toContain(STORAGE_NEXT_TEXT);
    expect(html).not.toContain('Prochaine sauvegarde dans');
    expect(html).not.toContain('Sauvegarder maintenant');
  });

  it('puts the storage before an interrupted connection, which keeps its own Alert', () => {
    const html = renderToStaticMarkup(
      <HomeAlerts blocked config={unlinked} plans={[plan]} listed={[]} />,
    );
    expect(html.indexOf(STORAGE_BLOCKED_TITLE)).toBeLessThan(
      html.indexOf('Connexion Microsoft 365 interrompue'),
    );
  });

  it('shows none of it when the storage is accepted', () => {
    const html = home(false);
    expect(html).not.toContain(STORAGE_BLOCKED_TITLE);
    expect(html).not.toContain(STORAGE_NEXT_TEXT);
    expect(html).not.toContain('Interrompue');
    expect(html).toContain('Prochaine sauvegarde dans');
    expect(html).toContain('Sauvegarder maintenant');
  });
});

describe('Plans, blocked storage (#612)', () => {
  it('leads with the error Alert, which says once that manual launches are suspended', () => {
    const alerts = renderToStaticMarkup(<RunHaltedAlerts blocked since={null} />);
    expect(firstAlert(alerts)).toContain('role="alert"');
    expect(firstAlert(alerts)).toContain(STORAGE_BLOCKED_TITLE);
    expect(alerts.split(STORAGE_RUN_SUSPENDED_TEXT)).toHaveLength(2);
    const list = renderToStaticMarkup(
      <PlansListView
        state={[plan]}
        admin
        configured
        runBlocked
        onRetry={noop}
        onRun={noop}
        onDelete={noop}
      />,
    );
    expect(list).not.toContain('Lancer maintenant');
    expect(list).not.toContain(STORAGE_RUN_SUSPENDED_TEXT);
  });

  it('says the suspension once, in the first Alert, when the connection is down too', () => {
    const html = renderToStaticMarkup(<RunHaltedAlerts blocked since="2026-11-26T22:06:00.000Z" />);
    expect(html.indexOf(STORAGE_BLOCKED_TITLE)).toBeLessThan(
      html.indexOf('Connexion Microsoft 365 interrompue'),
    );
    expect(html.split(STORAGE_RUN_SUSPENDED_TEXT)).toHaveLength(2);
    expect(html).not.toContain(RUN_SUSPENDED_TEXT);
  });

  it('shows no storage Alert when the storage is accepted', () => {
    expect(renderToStaticMarkup(<RunHaltedAlerts blocked={false} since={null} />)).toBe('');
  });
});

describe('Restore, blocked storage (#612)', () => {
  it('puts the error Alert before the audit reminder (OneDrive, SharePoint)', () => {
    const html = renderToStaticMarkup(<RestoreReminders blocked />);
    expect(firstAlert(html)).toContain('alert-error');
    expect(firstAlert(html)).toContain(STORAGE_BLOCKED_TITLE);
    expect(html.indexOf(STORAGE_BLOCKED_TITLE)).toBeLessThan(html.indexOf(AUDIT_REMINDER));
  });

  it('keeps the error Alert when the audit reminder is not shown (SharePoint, site link)', () => {
    const html = renderToStaticMarkup(<RestoreReminders blocked audit={false} />);
    expect(html).toContain(STORAGE_BLOCKED_TITLE);
    expect(html).not.toContain(AUDIT_REMINDER);
  });

  it('shows only the audit reminder when the storage is accepted', () => {
    const html = renderToStaticMarkup(<RestoreReminders blocked={false} />);
    expect(html).not.toContain(STORAGE_BLOCKED_TITLE);
    expect(html).toContain(AUDIT_REMINDER);
  });
});
