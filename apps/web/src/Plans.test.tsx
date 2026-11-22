import { renderToStaticMarkup } from 'react-dom/server';
import { scheduleWindowLabel } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { PlanWizard, PlansListView } from './PlansPage.js';
import { AUDIT_REMINDER } from './RestoreJourney.js';
import { Alert } from './ui/index.js';
import {
  complianceView,
  createdMessage,
  emptyForm,
  fetchMailboxes,
  formFromPlan,
  lastRunLabel,
  queuedMessage,
  runFlashText,
  planSummary,
  parsePlansHash,
  RETENTION_CHOICES,
  RTO_CHOICES,
  withCurrent,
  payloadOf,
  runPlan,
  runReasonError,
  OBJECTIVE_LABELS,
  recapRows,
  validateStep,
  type PlanItem,
} from './plans.js';

const plan: PlanItem = {
  id: 'p1',
  name: 'Messagerie Direction',
  scope: 'all',
  dataTypes: ['mail', 'onedrive', 'sharepoint'],
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

/**
 * Le plan tel que `GET /api/plans` l'envoie à un opérateur : sans délai de remise en
 * service ni justification (le test de `plan-routes.ts` fige la même liste de champs).
 */
function asOperator(item: PlanItem): PlanItem {
  const visible = { ...item };
  delete visible.rtoHours;
  delete visible.gdprJustification;
  return visible;
}

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
    const form = { ...emptyForm(), name: ' Mails ', justification: 'Obligation légale' };
    expect(payloadOf(form)).toEqual({
      name: 'Mails',
      scope: 'all',
      dataTypes: ['mail', 'onedrive', 'sharepoint'],
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
    expect(validateStep({ ...emptyForm(), justification: '   ' }, 2).justification).toBeDefined();
    expect(validateStep({ ...emptyForm(), justification: 'x' }, 2)).toEqual({});
  });

  it('keeps the justification as typed in the form, the payload and the recap', () => {
    const text = 'Besoin métier : archives de projets';
    const form = formFromPlan({ ...plan, gdprJustification: text });
    expect(form.justification).toBe(text);
    expect(payloadOf(form).gdprJustification).toBe(text);
    expect(Object.fromEntries(recapRows(form))['Justification de cette durée']).toBe(text);
    expect(payloadOf({ ...form, justification: `  ${text} ` }).gdprJustification).toBe(text);
  });

  it('keeps the selection only for a chosen scope', () => {
    const form = { ...emptyForm(), selection: ['a'], justification: 'Obligation légale' };
    expect(payloadOf(form).selection).toEqual([]);
    expect(payloadOf({ ...form, scope: 'selection' }).selection).toEqual(['a']);
  });

  it('lists the plan in labelled rows, in order', () => {
    const rows = recapRows({
      ...emptyForm(),
      name: ' Messagerie Direction ',
      justification: 'Obligation légale',
    });
    expect(rows).toEqual([
      ['Nom du plan', 'Messagerie Direction'],
      ['Données', 'Messagerie, OneDrive, SharePoint'],
      ['Périmètre', 'Toute l’organisation'],
      ['Perte de données acceptable', '12\u00a0h (une sauvegarde toutes les 12\u00a0h)'],
      ['Remise en service souhaitée', '24\u00a0h'],
      ['Durée de conservation', '1 an'],
      ['Justification de cette durée', 'Obligation légale'],
    ]);
  });

  it('shows the justification as typed and counts a chosen selection', () => {
    const form = {
      ...emptyForm(),
      dataTypes: ['mail' as const],
      scope: 'selection' as const,
      justification: 'Besoin métier : Audit annuel',
    };
    const row = (f: typeof form, label: string) =>
      Object.fromEntries(recapRows(f))[label] as string;
    expect(row({ ...form, selection: ['a', 'b'] }, 'Données')).toBe('Messagerie');
    expect(row({ ...form, selection: ['a', 'b'] }, 'Périmètre')).toBe(
      '2 boîtes ou comptes choisis',
    );
    expect(row({ ...form, selection: ['a'] }, 'Périmètre')).toBe('1 boîte ou compte choisi');
    expect(row(form, 'Périmètre')).toBe('Aucune boîte ou compte choisi');
    expect(row(form, 'Justification de cette durée')).toBe('Besoin métier : Audit annuel');
    expect(row({ ...form, dataTypes: [] }, 'Données')).toBe('Aucune donnée choisie');
  });

  it('announces the first planned backup', () => {
    expect(createdMessage({ id: 'p1', rpoHours: 12 })).toMatch(
      /^Plan créé\. Première sauvegarde prévue à \d\d:\d\d\.$/,
    );
    expect(createdMessage({ id: 'p1', rpoHours: 24 })).toBe(
      'Plan créé. Première sauvegarde prévue cette nuit.',
    );
  });
});

describe('run reason', () => {
  it('refuses an empty reason with the shared message and accepts any free text', () => {
    expect(runReasonError('')).toBe('Indiquez un motif pour continuer.');
    expect(runReasonError('   ')).toBe('Indiquez un motif pour continuer.');
    expect(runReasonError('x'.repeat(120))).toBeUndefined();
  });

  it('sends the typed reason as is', async () => {
    const reason = 'Ticket INC-1 : ' + 'x'.repeat(105);
    let body = '';
    const fetchFn = ((_url: string, init: RequestInit) => {
      body = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ queued: true })));
    }) as unknown as typeof fetch;
    await runPlan('p1', reason, fetchFn);
    expect(JSON.parse(body)).toEqual({ reason });
    expect(reason).toHaveLength(120);
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
    expect(lastRunLabel(plan)).toBe('Réussie, 14/11/2026 06:00');
    expect(lastRunLabel({ ...plan, lastRun: { ...plan.lastRun!, status: 'failed' } })).toBe(
      'Échec, 14/11/2026 06:00',
    );
    // Rien copié : jamais « Réussie ».
    const empty = { ...plan.compliance, lastRestorePointAt: null };
    const emptyRun = { ...plan.lastRun!, noSnapshotReason: 'no_content' as const };
    expect(lastRunLabel({ ...plan, lastRun: emptyRun })).toBe('Rien copié, 14/11/2026 06:00');
    expect(lastRunLabel({ ...plan, compliance: empty })).toBe('Rien copié, 14/11/2026 06:00');
    expect(complianceView({ ...plan, compliance: empty }).status).toBe('pending');
    expect(complianceView({ ...plan, compliance: empty, lastRun: emptyRun })).toEqual({
      status: 'pending',
      label: 'En attente',
      note: 'Rien à sauvegarder dans le périmètre : vérifiez la boîte, le compte ou le site choisi.',
    });
    // En cours ou en file : la colonne garde le dernier résultat terminé.
    expect(lastRunLabel({ ...plan, running: true })).toBe(lastRunLabel(plan));
    expect(lastRunLabel({ ...plan, queued: true })).toBe(lastRunLabel(plan));
    expect(complianceView({ ...plan, running: true })).toEqual({
      status: 'running',
      label: 'En cours',
    });
    expect(complianceView({ ...plan, queued: true }, 'Boîte direction')).toEqual({
      status: 'pending',
      label: 'En file d’attente',
      note: 'Démarrera après « Boîte direction »',
    });
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
  it('gives the columns their mobile card classes', () => {
    const html = list([plan], true);
    expect(html).toMatch(/<th[^>]*class="card-title"[^>]*>Plan</);
    expect(html).toMatch(/<th[^>]*class="card-action"[^>]*>Actions</);
    expect(html).toMatch(/<td[^>]*data-label="Plan"[^>]*class="card-title"/);
    expect(html).toContain('card-wide plan-last-run');
    expect(html).toContain('compliance-cell card-nolabel');
  });

  it('shows the table with action buttons named after the plan for an administrator', () => {
    const html = list([plan], true);
    expect(html).toContain('Messagerie Direction');
    expect(html).toContain('À jour');
    expect(html).toContain('Dernière exécution (UTC)');
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

  it('shows a neutral pill and a note for a plan whose last run copied nothing', () => {
    const empty = {
      ...plan,
      compliance: { ...plan.compliance, lastRestorePointAt: null },
      lastRun: { ...plan.lastRun!, noSnapshotReason: 'no_content' as const },
    };
    const html = list([empty], false);
    expect(html).toContain('◷</span> En attente');
    expect(html).toContain(
      '<small class="state-note">Rien à sauvegarder dans le périmètre : vérifiez la boîte, le compte ou le site choisi.</small>',
    );
    expect(html).not.toContain('À jour');
    expect(html).not.toContain('rien à sauvegarder)');
  });

  it('summarises what each plan protects, for both roles', () => {
    const other: PlanItem = {
      ...plan,
      id: 'p2',
      name: 'OneDrive et SharePoint Services',
      scope: 'selection',
      selection: ['a', 'b'],
      dataTypes: ['onedrive'],
      rpoHours: 24,
      retentionDays: 1095,
    };
    const all =
      '<small class="state-note plan-summary">Messagerie, OneDrive et SharePoint · toute l’organisation · toutes les 12 h · conservés 1 an</small>';
    const html = list([plan, other], true);
    expect(html).toContain(all);
    expect(html).toContain(
      '<small class="state-note plan-summary">OneDrive · 2 boîtes choisies · toutes les 24 h · conservés 3 ans</small>',
    );
    // Les deux rôles reçoivent la sélection : même plan, même synthèse.
    const operatorHtml = list([plan, other].map(asOperator), false);
    expect(operatorHtml).toContain(all);
    expect(operatorHtml).toContain('OneDrive · 2 boîtes choisies ·');
  });

  it('never splits a number from its unit in a plan description', () => {
    for (const retentionDays of [90, 180, 365, 1095, 400]) {
      for (const rpoHours of [4, 12, 24] as const) {
        const text = [
          planSummary({ ...plan, rpoHours, retentionDays }),
          scheduleWindowLabel(rpoHours) ?? '',
        ].join(' ');
        expect(text).not.toMatch(/\d (h|jours|mois|ans?)\b/);
        expect(text).toMatch(/\d\u00a0(h|jours|mois|ans?)/);
      }
    }
  });

  it('names the mailboxes of a restricted plan, the same way for both roles', () => {
    const boxes = [
      { id: 'a', displayName: 'claire.durand@exemple.fr' },
      { id: 'b', displayName: 'paul.martin@exemple.fr' },
    ];
    const tail = 'toutes les 24 h · conservés 3 ans';
    const restricted: PlanItem = {
      ...plan,
      scope: 'selection',
      dataTypes: ['onedrive'],
      rpoHours: 24,
      retentionDays: 1095,
    };
    const summary = (selection: string[], names = boxes) =>
      planSummary({ ...restricted, selection }, names);
    expect(summary(['a'])).toBe(`OneDrive · claire.durand@exemple.fr · ${tail}`);
    expect(summary(['a', 'b'])).toBe(
      `OneDrive · claire.durand@exemple.fr et paul.martin@exemple.fr · ${tail}`,
    );
    expect(summary(['a', 'b', 'c', 'd', 'e'])).toBe(
      `OneDrive · claire.durand@exemple.fr et 4 autres · ${tail}`,
    );
    // Catalogue indisponible : le nombre, jamais un gabarit.
    expect(summary([])).toBe(`OneDrive · aucune boîte choisie · ${tail}`);
    expect(summary(['a', 'b'], boxes.slice(0, 1))).toBe(
      `OneDrive · claire.durand@exemple.fr et 1 autre · ${tail}`,
    );
    expect(summary(['a'], [])).toBe(`OneDrive · 1 boîte choisie · ${tail}`);
    expect(summary(['a', 'b', 'c'], [])).toBe(`OneDrive · 3 boîtes choisies · ${tail}`);
    // Mêmes données pour les deux rôles, avec ou sans champs d'administrateur.
    const admin = { ...restricted, selection: ['a'] };
    expect(planSummary(asOperator(admin), boxes)).toBe(planSummary(admin, boxes));
    const html = list([{ ...admin, selection: ['a', 'b', 'c'] }], false);
    expect(html).not.toContain('une boîte ou un compte');
  });

  it('is read-only for an operator: no Actions column, a notice', () => {
    const html = list([asOperator(plan)], false);
    expect(html).toContain('Messagerie Direction');
    expect(html).not.toContain('Actions');
    expect(html).not.toContain('Lancer');
    expect(html).toContain('Lecture seule : seul un administrateur peut modifier les plans.');
  });

  it('disables « Lancer maintenant » while a run is in progress', () => {
    const html = list([{ ...plan, running: true }], true);
    expect(html).toContain('En cours');
    expect(html).not.toContain('En échec');
    expect(html).toMatch(
      /aria-label="Lancer Messagerie Direction maintenant"[^>]*aria-disabled="true"[^>]*aria-describedby="run-hint-/,
    );
    expect(html).toContain('Sauvegarde déjà en cours');
  });

  it('puts the three actions in one row of outline buttons, the hint below the row', () => {
    const html = list([{ ...plan, running: true }], true);
    const row = /<div class="row-actions-buttons">(.*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(row).toMatch(/aria-label="Lancer [^>]*btn btn-secondary/);
    expect(row).toMatch(/<a class="btn btn-secondary"[^>]*aria-label="Modifier /);
    expect(row).toMatch(/aria-label="Supprimer [^>]*btn btn-danger/);
    expect(html.indexOf('id="run-hint-')).toBeGreaterThan(
      html.indexOf('</div>', html.indexOf(row)),
    );
  });

  it('shows a queued plan and the plan it waits for', () => {
    const other = { ...plan, id: 'p2', name: 'Boîte direction', running: true };
    const html = list([other, { ...plan, queued: true }], true);
    expect(html).toContain('En file d’attente');
    expect(html).toContain('Démarrera après « Boîte direction »');
    expect(html).toContain('Déjà en file d’attente');
  });

  it('falls back when the running plan is unknown', () => {
    expect(complianceView({ ...plan, queued: true })).toEqual({
      status: 'pending',
      label: 'En file d’attente',
    });
    expect(queuedMessage('Boîtes mail')).toBe(
      'Sauvegarde de « Boîtes mail » mise en file : elle démarrera à la fin de la sauvegarde en cours.',
    );
    expect(list([{ ...plan, queued: true }], true)).toContain('Déjà en file d’attente');
  });

  it('names both plans in the queued confirmation', () => {
    expect(queuedMessage('Boîtes mail', 'Boîte direction')).toBe(
      'Sauvegarde de « Boîtes mail » mise en file : elle démarrera à la fin de « Boîte direction ».',
    );
  });

  it('picks the confirmation text after a run is sent', () => {
    const current = { ...plan, id: 'p0', name: 'Boîte direction', running: true };
    expect(runFlashText(true, 'Boîtes mail', [current, plan])).toBe(
      queuedMessage('Boîtes mail', 'Boîte direction'),
    );
    expect(runFlashText(true, 'Boîtes mail', undefined)).toBe(queuedMessage('Boîtes mail'));
    expect(runFlashText(false, 'Boîtes mail', [current])).toContain('Sauvegarde lancée');
  });

  it('renders the queued confirmation as a status banner naming both plans', () => {
    const current = { ...plan, id: 'p0', name: 'Boîte direction', running: true };
    // Le même rendu que la page : `Alert` au ton `success`, avec le texte choisi après l'envoi.
    const html = renderToStaticMarkup(
      <Alert tone="success">{runFlashText(true, 'Boîtes mail', [current, plan])}</Alert>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('« Boîtes mail »');
    expect(html).toContain('« Boîte direction »');
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
    expect(admin).toContain('Connectez d’abord Microsoft 365 pour créer un plan.');
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

  it('asks for the justification in one free text field with help and counter', () => {
    const html = renderToStaticMarkup(
      <PlanWizard
        initial={emptyForm()}
        editing={false}
        mailboxes={[]}
        onSubmit={() => Promise.resolve(undefined)}
        initialStep={2}
      />,
    );
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Précision');
    expect(html).toContain('Justification de cette durée (obligatoire)');
    expect(html).toContain('placeholder="Obligation légale : conservation des courriers 1 an"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('0 / 120');
    expect(html).toMatch(/aria-describedby="[^"]*-help"/);
    expect(html).toMatch(
      /-help"[^>]*>Les durées longues doivent rester justifiées au regard du RGPD\. N’y saisissez pas de donnée personnelle\.</,
    );
    expect(html).not.toContain('<p>Les durées longues');
  });

  it('recaps the plan on step 3 as a labelled list without the audit reminder', () => {
    const html = renderToStaticMarkup(
      <PlanWizard
        initial={{
          ...emptyForm(),
          name: 'Messagerie Direction',
          justification: 'Contrat client',
        }}
        editing={false}
        mailboxes={[]}
        onSubmit={() => Promise.resolve(undefined)}
        initialStep={3}
      />,
    );
    expect(html).toContain('<h2>Récapitulatif</h2>');
    expect(html).toContain('<dl class="meta-list">');
    expect(html).toContain('<dd>Messagerie Direction</dd>');
    expect(html).toContain('<dd>Contrat client</dd>');
    expect(html).not.toContain(AUDIT_REMINDER);
    expect(html).not.toContain('recap-sentence');
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

  it('names the recap rows like the objectives step, and marks no label with an asterisk', () => {
    const html = step2();
    const recapLabels = recapRows(emptyForm())
      .map(([label]) => label)
      .slice(3);
    expect(recapLabels).toEqual(Object.values(OBJECTIVE_LABELS));
    const legends = [...html.matchAll(/<legend>([^<]*)<\/legend>/g)].map((m) => m[1]);
    expect(legends).toEqual(recapLabels.slice(0, 3));
    expect(html).toContain('Justification de cette durée (obligatoire)');
    const labels = [...html.matchAll(/<(?:label|legend)[^>]*>([^<]*)</g)].map((m) => m[1]);
    for (const label of labels) expect(label).not.toMatch(/\*\s*$/);
    expect(html).not.toContain('*');
  });

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
    expect(taken).toMatchObject({
      ok: false,
      message: 'Une sauvegarde est déjà en cours pour ce plan.',
    });
    const down = await runPlan('p', 'x', (() => Promise.reject(new Error('net'))) as typeof fetch);
    expect(down.ok).toBe(false);
  });
});
