import type { StatusReport } from '@backup365/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RUN_SUSPENDED_TEXT } from './ConfigurationBlock.js';
import { OverviewView } from './Home.js';
import { HomeCoverage } from './HomeCoverage.js';
import type { HomeData } from './HomeData.js';
import type { Overview } from './overview.js';
import { PlansListView } from './plans/PlansListView.js';
import type { PlanItem } from './plans.js';
import { ReasonStep } from './restore/ReasonStep.js';
import { AUDIT_REMINDER, REASON, RESTORE_BUTTONS, RestoreReminders } from './RestoreJourney.js';
import {
  BlockedRestore,
  HomeAlerts,
  RESTORE_UNAVAILABLE_TEXT,
  RunHaltedAlerts,
  STORAGE_BLOCKED_ACTION,
  STORAGE_BLOCKED_TITLE,
  STORAGE_NEXT_TEXT,
  STORAGE_RESTORE_SUSPENDED_TEXT,
  STORAGE_RUN_SUSPENDED_TEXT,
  StorageBlocked,
  restoreBlocked,
  storageBlocked,
} from './StorageBlocked.js';
import { forgetStorageRequest, goToStorage, revealStorage } from './status/StorageCheck.js';

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
      <OverviewView state={overview} admin onRetry={noop} storageBlocked={blocked} />
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
    expect(card).not.toContain('Opérationnelle');
    expect(html).toContain(STORAGE_NEXT_TEXT);
    expect(html).not.toContain('Prochaine sauvegarde dans');
    expect(html).not.toContain('Sauvegarder maintenant');
  });

  it('says the blocked storage once, in the Alert under the h1 (#616)', () => {
    const html = home(true);
    expect(html.split(STORAGE_BLOCKED_TITLE)).toHaveLength(2);
    expect(firstAlert(html)).toContain(STORAGE_BLOCKED_TITLE);
  });

  it('leads the Backup card to the storage section, not to the Alert above it (#616)', () => {
    const late = {
      ...overview,
      lateBackups: [
        {
          service: 'mail' as const,
          name: 'Boîte A',
          lastSnapshotAt: '2026-11-20T22:06:00.000Z',
        },
      ],
    };
    for (const interruptedSince of [null, '2026-11-26T22:06:00.000Z']) {
      const html = renderToStaticMarkup(
        <OverviewView
          state={late}
          admin
          onRetry={noop}
          storageBlocked
          interruptedSince={interruptedSince}
        />,
      );
      const card = html.slice(0, html.indexOf('overview-plans'));
      expect(card).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>Voir le stockage<\/button>/u);
      expect(card).not.toContain('Voir la conduite à tenir');
      expect(card).not.toContain('Voir les sources');
    }
    const location = { hash: '#/' };
    goToStorage(location);
    expect(location.hash).toBe('#/sources');
    // La section « Stockage » d'État des sources prend alors le focus, une seule fois.
    const title = { scrollIntoView: vi.fn(), focus: vi.fn() };
    expect(revealStorage(title)).toBe(true);
    expect(title.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(title.focus).toHaveBeenCalledOnce();
    expect(revealStorage(title)).toBe(false);
    // Demande non servie (État des sources en erreur, sans section) : oubliée, pas de focus plus tard.
    goToStorage(location);
    forgetStorageRequest();
    expect(revealStorage(title)).toBe(false);
    expect(title.focus).toHaveBeenCalledOnce();
  });

  it('puts the storage before an interrupted connection, which keeps its own Alert', () => {
    const html = renderToStaticMarkup(
      <HomeAlerts blocked config={unlinked} plans={[plan]} listed={[]} />,
    );
    expect(html.indexOf(STORAGE_BLOCKED_TITLE)).toBeLessThan(
      html.indexOf('Connexion Microsoft 365 interrompue'),
    );
  });

  it('says each outage once, in its own Alert, when the connection is down too (#622)', () => {
    const html = renderToStaticMarkup(
      <main>
        <h1>Accueil</h1>
        <HomeAlerts blocked config={unlinked} plans={[plan]} listed={[]} />
        <OverviewView
          state={overview}
          admin
          onRetry={noop}
          storageBlocked
          interruptedSince="2026-11-26T22:06:00.000Z"
        />
        <HomeCoverage
          overview={overview}
          data={data(true)}
          admin
          connected={false}
          interrupted
          now={new Date('2026-11-26T22:30:00.000Z')}
          onLaunched={noop}
          onRetryEvents={noop}
        />
      </main>,
    );
    const card = html.indexOf('overview-backup');
    expect(html.slice(0, card).match(/<div class="alert alert-error"/gu)).toHaveLength(2);
    for (const said of [
      STORAGE_BLOCKED_TITLE,
      'Connexion Microsoft 365 interrompue',
      'Aucune sauvegarde ne part depuis',
    ]) {
      expect(html.split(said)).toHaveLength(2);
      expect(html.indexOf(said)).toBeLessThan(card);
    }
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

/** Nombre d'occurrences de `needle` dans `html`. */
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('Restore, blocked storage (#612, #614)', () => {
  it('says the restore is suspended in the error Alert, without the audit reminder (OneDrive, SharePoint)', () => {
    for (const audit of [true, false]) {
      const html = renderToStaticMarkup(<RestoreReminders blocked admin audit={audit} />);
      expect(firstAlert(html)).toContain('alert-error');
      expect(firstAlert(html)).toContain(STORAGE_BLOCKED_TITLE);
      expect(firstAlert(html)).toContain(STORAGE_RESTORE_SUSPENDED_TEXT);
      expect(count(html, 'class="alert alert-')).toBe(1);
      expect(html).not.toContain(AUDIT_REMINDER);
    }
  });

  it('shows only the audit reminder when the storage is accepted', () => {
    const html = renderToStaticMarkup(<RestoreReminders blocked={false} admin />);
    expect(html).not.toContain(STORAGE_BLOCKED_TITLE);
    expect(html).toContain(AUDIT_REMINDER);
  });

  it('mail dialog, administrator: the Alert and « Fermer », nothing else', () => {
    const html = renderToStaticMarkup(<BlockedRestore admin onClose={noop} />);
    expect(firstAlert(html)).toContain('role="alert"');
    expect(firstAlert(html)).toContain(STORAGE_BLOCKED_TITLE);
    expect(html).toContain(STORAGE_RESTORE_SUSPENDED_TEXT);
    for (const absent of [
      'Restaurer vers',
      AUDIT_REMINDER,
      REASON.label,
      '<form',
      '<input',
      '>Restaurer<',
    ])
      expect(html).not.toContain(absent);
    expect(count(html, '<button')).toBe(1);
    expect(html).toMatch(/<button[^>]*class="btn btn-secondary"[^>]*>Fermer<\/button>/u);
  });

  it.each([
    ['OneDrive', true],
    ['SharePoint', false],
  ])('%s « Motif » step: no reason field nor « Continuer », only « Précédent »', (_, admin) => {
    const html = renderToStaticMarkup(
      <>
        <RestoreReminders blocked admin={admin} />
        <ReasonStep initial="Ticket" blocked onBack={noop} onContinue={noop} />
      </>,
    );
    expect(html).not.toContain(REASON.label);
    expect(html).not.toContain('<input');
    expect(html).not.toContain(RESTORE_BUTTONS.next);
    expect(count(html, '<button')).toBe(1);
    expect(html).toContain(`>${RESTORE_BUTTONS.back}</button>`);
  });

  it('operator: the same block without operating detail, in the dialog and both journeys', () => {
    const dialog = renderToStaticMarkup(<BlockedRestore admin={false} onClose={noop} />);
    const journey = renderToStaticMarkup(
      <>
        <RestoreReminders blocked admin={false} />
        <ReasonStep initial="" blocked onBack={noop} onContinue={noop} />
      </>,
    );
    for (const html of [dialog, journey]) {
      expect(firstAlert(html)).toContain('alert-error');
      expect(html).toContain(RESTORE_UNAVAILABLE_TEXT);
      expect(html).not.toContain(STORAGE_BLOCKED_TITLE);
      expect(html).not.toMatch(/stockage/iu);
      expect(html).not.toContain(REASON.label);
      expect(html).not.toContain('>Restaurer<');
      expect(html).not.toContain(RESTORE_BUTTONS.next);
      expect(count(html, '<button')).toBe(1);
    }
  });

  it('sends no restore request and writes nothing to the audit log while blocked', () => {
    const calls: string[] = [];
    const fake = vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response('{}'));
    });
    vi.stubGlobal('fetch', fake);
    try {
      for (const admin of [true, false]) {
        const html = renderToStaticMarkup(
          <>
            <BlockedRestore admin={admin} onClose={noop} />
            <RestoreReminders blocked admin={admin} />
            <ReasonStep initial="Ticket INC-1" blocked onBack={noop} onContinue={noop} />
          </>,
        );
        // Aucun formulaire ni bouton d'envoi : rien ne peut partir vers `…/restore` ni l'audit.
        expect(html).not.toContain('<form');
        expect(html).not.toContain('type="submit"');
      }
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the block for any role: storage for an administrator, restoreSuspended otherwise', () => {
    expect(restoreBlocked({ storage: { conditionalWrites: 'ignored' } })).toBe(true);
    expect(restoreBlocked({ restoreSuspended: true })).toBe(true);
    expect(restoreBlocked({ restoreSuspended: false })).toBe(false);
    expect(restoreBlocked({ storage: { conditionalWrites: 'supported' } })).toBe(false);
    expect(restoreBlocked(null)).toBe(false);
  });
});
