import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanWizard, PlansListView } from './PlansPage.js';
import {
  complianceView,
  createdMessage,
  emptyForm,
  fetchMailboxes,
  formFromPlan,
  justificationText,
  lastRunLabel,
  parseJustification,
  parsePlansHash,
  RETENTION_CHOICES,
  RTO_CHOICES,
  withCurrent,
  payloadOf,
  runPlan,
  summarySentence,
  validateStep,
  type PlanItem,
} from './plans.js';

const plan: PlanItem = {
  id: 'p1',
  name: 'Messagerie Direction',
  scope: 'all',
  dataTypes: ['mail', 'files', 'calendar', 'contacts'],
  selection: [],
  rpoHours: 12,
  rtoHours: 24,
  retentionDays: 365,
  gdprJustification: 'Obligation légale',
  createdAt: '2026-11-01T08:00:00.000Z',
  compliance: {
    state: 'compliant',
    lastSuccessAt: '2026-11-14T06:00:00.000Z',
    lastRestorePointAt: '2026-11-14T06:00:00.000Z',
  },
  running: false,
  lastRun: {
    status: 'success',
    startedAt: '2026-11-14T05:59:00.000Z',
    finishedAt: '2026-11-14T06:00:00.000Z',
    noSnapshotReason: null,
  },
};

const noop = () => undefined;
const list = (
  state: Parameters<typeof PlansListView>[0]['state'],
  admin: boolean,
  configured = true,
) =>
  renderToStaticMarkup(
    <PlansListView
      state={state}
      admin={admin}
      configured={configured}
      onRetry={noop}
      onRun={noop}
      onDelete={noop}
    />,
  );

describe('plan form', () => {
  it('starts with safe defaults and a payload the API accepts', () => {
    const form = { ...emptyForm(), name: ' Mails ', reasonKind: 'legal' as const };
    expect(payloadOf(form)).toEqual({
      name: 'Mails',
      scope: 'all',
      dataTypes: ['mail', 'files', 'calendar', 'contacts'],
      selection: [],
      rpoHours: 12,
      rtoHours: 24,
      retentionDays: 365,
      gdprJustification: 'Obligation légale',
    });
  });

  it('refuses a missing name, no data type, an empty selection and a missing justification', () => {
    expect(validateStep({ ...emptyForm(), dataTypes: [] }, 1)).toEqual({
      name: 'Indiquez un nom pour le plan.',
      dataTypes: 'Choisissez au moins un type de données.',
    });
    expect(
      validateStep({ ...emptyForm(), name: 'a', scope: 'selection' }, 1).selection,
    ).toBeDefined();
    expect(validateStep(emptyForm(), 2).justification).toBe(
      'Indiquez la justification de la durée de conservation.',
    );
    expect(validateStep({ ...emptyForm(), reasonKind: 'other' }, 2).justification).toBeDefined();
    expect(validateStep({ ...emptyForm(), reasonKind: 'other', reasonDetail: 'x' }, 2)).toEqual({});
  });

  it('writes and reads back the justification', () => {
    expect(justificationText('legal', '')).toBe('Obligation légale');
    expect(justificationText('business', ' Audit ')).toBe('Besoin métier : Audit');
    expect(justificationText('other', 'Contrat')).toBe('Autre : Contrat');
    expect(parseJustification('Besoin métier : Audit')).toEqual({
      kind: 'business',
      detail: 'Audit',
    });
    expect(parseJustification('Texte libre')).toEqual({ kind: 'other', detail: 'Texte libre' });
    expect(formFromPlan(plan).reasonKind).toBe('legal');
  });

  it('keeps the selection only for a chosen scope', () => {
    const form = { ...emptyForm(), selection: ['a'], reasonKind: 'legal' as const };
    expect(payloadOf(form).selection).toEqual([]);
    expect(payloadOf({ ...form, scope: 'selection' }).selection).toEqual(['a']);
  });

  it('states the plan in plain language', () => {
    expect(summarySentence(emptyForm())).toBe(
      'Vos mails, fichiers, calendriers et contacts de toute l’organisation seront sauvegardés toutes les 12 h et conservés 1 an.',
    );
    expect(
      summarySentence({ ...emptyForm(), dataTypes: ['mail'], rpoHours: 4, retentionDays: 1095 }),
    ).toContain(
      'Vos mails de toute l’organisation seront sauvegardés toutes les 4 h et conservés 3 ans.',
    );
  });

  it('announces the first planned backup', () => {
    expect(createdMessage({ id: 'p1', rpoHours: 12 })).toMatch(
      /^Plan créé\. Première sauvegarde prévue à \d\d:\d\d\.$/,
    );
  });
});

describe('list labels', () => {
  it('carries compliance by text, not by colour', () => {
    expect(complianceView(plan)).toEqual({ status: 'compliant', label: 'À jour' });
    expect(
      complianceView({
        ...plan,
        compliance: {
          state: 'late',
          lastSuccessAt: '2026-11-13T00:00:00Z',
          lastRestorePointAt: '2026-11-13T00:00:00Z',
        },
      }),
    ).toMatchObject({ label: 'En retard', note: 'Dernière sauvegarde plus ancienne que prévu' });
    expect(
      complianceView({
        ...plan,
        compliance: { state: 'failed', lastSuccessAt: null, lastRestorePointAt: null },
        lastRun: { ...plan.lastRun!, status: 'failed' },
      }),
    ).toMatchObject({ label: 'En échec', note: 'Aucune sauvegarde réussie' });
  });

  it('describes the last run', () => {
    expect(lastRunLabel(plan)).toMatch(/^Réussie, \d\d\/\d\d \d\d:\d\d$/);
    expect(lastRunLabel({ ...plan, lastRun: { ...plan.lastRun!, status: 'failed' } })).toMatch(
      /^Échec, \d\d\/\d\d \d\d:\d\d$/,
    );
    expect(
      lastRunLabel({ ...plan, lastRun: { ...plan.lastRun!, noSnapshotReason: 'no_content' } }),
    ).toMatch(/^Réussie \(rien à sauvegarder\), \d\d\/\d\d \d\d:\d\d$/);
    // « rien à sauvegarder » : une seule fois par ligne.
    const empty = { ...plan.compliance, lastRestorePointAt: null };
    expect(complianceView({ ...plan, compliance: empty }).note).toBe(
      'Rien à sauvegarder pour l’instant',
    );
    expect(
      complianceView({
        ...plan,
        compliance: empty,
        lastRun: { ...plan.lastRun!, noSnapshotReason: 'no_content' },
      }).note,
    ).toBeUndefined();
    expect(lastRunLabel({ ...plan, running: true })).toBe('En cours…');
    expect(lastRunLabel({ ...plan, lastRun: null })).toBe('Pas encore sauvegardé');
  });
});

describe('routes', () => {
  it('reads the plans anchors', () => {
    expect(parsePlansHash('#/plans')).toEqual({ page: 'list' });
    expect(parsePlansHash('#/plans/nouveau')).toEqual({ page: 'new' });
    expect(parsePlansHash('#/plans/a%20b/modifier')).toEqual({ page: 'edit', id: 'a b' });
    expect(parsePlansHash('#/plans/x')).toBeNull();
    expect(parsePlansHash('#/plans/%E0/modifier')).toBeNull();
    expect(parsePlansHash('#/audit')).toBeNull();
  });
});

describe('PlansListView', () => {
  it('shows the table with action buttons named after the plan for an administrator', () => {
    const html = list([plan], true);
    expect(html).toContain('Messagerie Direction');
    expect(html).toContain('À jour');
    expect(
      list(
        [{ ...plan, compliance: { ...plan.compliance, state: 'failed', lastSuccessAt: null } }],
        true,
      ),
    ).toContain('<small class="state-note">Aucune sauvegarde réussie</small>');
    expect(html).not.toMatch(/Conforme|Non conforme|RPO|Conformité/);
    expect(html).toContain('aria-label="Lancer Messagerie Direction maintenant"');
    expect(html).toContain('aria-label="Modifier Messagerie Direction"');
    expect(html).toContain('aria-label="Supprimer Messagerie Direction"');
  });

  it('is read-only for an operator: no Actions column, a notice', () => {
    const html = list([plan], false);
    expect(html).not.toContain('Actions');
    expect(html).not.toContain('Lancer');
    expect(html).toContain('Lecture seule : seul un administrateur peut modifier les plans.');
  });

  it('disables « Lancer maintenant » while a run is in progress', () => {
    const html = list([{ ...plan, running: true }], true);
    expect(html).toContain('En cours…');
    expect(html).toMatch(
      /aria-label="Lancer Messagerie Direction maintenant"[^>]*aria-disabled="true"/,
    );
  });

  it('handles loading, error and empty states', () => {
    expect(list('loading', true)).toContain('aria-busy="true"');
    expect(list('loading', true)).toContain('Chargement des plans…');
    expect(list('error', true)).toContain('role="alert"');
    expect(list('error', true)).toContain('Impossible de charger les plans.');
    expect(list('error', true)).toContain('Réessayer');
    const admin = list([], true);
    expect(admin).toContain('Aucun plan de protection');
    expect(admin).toContain('Vos données Microsoft 365 ne sont pas protégées.');
    expect(admin).toContain('Créer un plan');
    const operator = list([], false);
    expect(operator).toContain('Aucun plan n’a encore été créé par un administrateur.');
    expect(operator).not.toContain('Créer un plan');
  });

  it('explains that the backup is not configured', () => {
    const admin = list([], true, false);
    expect(admin).toContain('Sauvegarde non configurée');
    expect(admin).toContain('Connectez d’abord votre tenant Microsoft 365 pour créer un plan.');
    expect(admin).toContain('Configurer la sauvegarde');
    const operator = list([], false, false);
    expect(operator).toContain('Demandez à un administrateur de la configurer');
    expect(operator).not.toContain('Configurer la sauvegarde');
  });
});

describe('PlanWizard', () => {
  it('opens on step 1 with fieldsets, labels and the numbered steps', () => {
    const html = renderToStaticMarkup(
      <PlanWizard
        initial={emptyForm()}
        editing={false}
        mailboxes={[]}
        onSubmit={() => Promise.resolve(undefined)}
      />,
    );
    expect(html).toContain('Étape 1 sur 3 : Quoi protéger');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('<legend>Données à sauvegarder</legend>');
    expect(html).toContain('<legend>Périmètre</legend>');
    expect(html).toContain('Nom du plan');
    expect(html).toContain('Continuer');
    expect(html).not.toContain('Précédent');
  });

  const step2 = (form = emptyForm()) =>
    renderToStaticMarkup(
      <PlanWizard
        initial={form}
        editing={false}
        mailboxes={[]}
        onSubmit={() => Promise.resolve(undefined)}
        initialStep={2}
      />,
    );
  const radios = (html: string, name: string) =>
    [...html.matchAll(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'g'))].map(
      (m) => [/value="(\d+)"/.exec(m[0])?.[1], m[0].includes('checked=""')] as const,
    );

  it('lists the objectives in ascending order, defaults checked, without acronyms', () => {
    const html = step2();
    expect(radios(html, 'rpo')).toEqual([
      ['4', false],
      ['12', true],
      ['24', false],
    ]);
    expect(radios(html, 'rto')).toEqual([
      ['8', false],
      ['24', true],
      ['72', false],
    ]);
    expect(radios(html, 'retention')).toEqual([
      ['180', false],
      ['365', true],
      ['1095', false],
    ]);
    expect(html).not.toMatch(/RPO|RTO/);
  });

  it('links one help sentence per group with aria-describedby, following the choice', () => {
    const html = step2();
    for (const name of ['rpo', 'rto', 'retention']) {
      expect(html).toContain(`aria-describedby="${name}-help"`);
      expect(html).toContain(`id="${name}-help"`);
    }
    expect(html).toContain('perdre au plus 12 h');
    expect(html).toContain('rétabli en 24 h au plus');
    expect(html).toContain('supprimées au bout de 1\u00a0an');
    const other = step2({ ...emptyForm(), rpoHours: 4, rtoHours: 8, retentionDays: 180 });
    expect(other).toContain('perdre au plus 4 h');
    expect(other).toContain('rétabli en 8 h au plus');
    expect(other).toContain('supprimées au bout de 6\u00a0mois');
  });

  it('keeps the options sorted when the current value is outside the list', () => {
    expect(withCurrent(RETENTION_CHOICES, 730)).toEqual([180, 365, 730, 1095]);
    expect(withCurrent(RETENTION_CHOICES, 30)).toEqual([30, 180, 365, 1095]);
    expect(withCurrent(RTO_CHOICES, 48)).toEqual([8, 24, 48, 72]);
    const html = step2({ ...emptyForm(), retentionDays: 730 });
    expect(radios(html, 'retention').map(([v]) => v)).toEqual(['180', '365', '730', '1095']);
  });
});

describe('network helpers', () => {
  const reply = (status: number, body: unknown) => () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('detects an unconfigured backup only from the catalog_unavailable code', async () => {
    const off = await fetchMailboxes(reply(503, { error: 'catalog_unavailable' }) as typeof fetch);
    expect(off.configured).toBe(false);
    const other = await fetchMailboxes(reply(503, { error: 'no_backup_found' }) as typeof fetch);
    expect(other.configured).toBe(true);
    const ok = await fetchMailboxes(
      reply(200, { mailboxes: [{ id: 'a', displayName: 'A' }] }) as typeof fetch,
    );
    expect(ok).toEqual({ configured: true, mailboxes: [{ id: 'a', displayName: 'A' }] });
  });

  it('turns API errors into readable messages, without a network call in tests', async () => {
    const taken = await runPlan('p', 'x', reply(409, { error: 'run_in_progress' }) as typeof fetch);
    expect(taken).toEqual({ ok: false, message: 'Une sauvegarde est déjà en cours pour ce plan.' });
    const down = await runPlan('p', 'x', (() => Promise.reject(new Error('net'))) as typeof fetch);
    expect(down.ok).toBe(false);
  });
});
