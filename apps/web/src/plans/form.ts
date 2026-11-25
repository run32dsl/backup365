import { DATA_TYPES, type DataType, type PlanScope, type RpoHours } from '@backup365/core';
import {
  DATA_TYPE_LABELS,
  MESSAGES,
  NBSP,
  retentionLabel,
  type Mailbox,
  type PlanItem,
} from './model.js';

// ---- Formulaire -----------------------------------------------------------------------------

export interface PlanForm {
  name: string;
  dataTypes: DataType[];
  scope: PlanScope;
  selection: string[];
  rpoHours: RpoHours;
  rtoHours: number;
  retentionDays: number;
  justification: string;
}

/** Valeurs par défaut sûres : tout protégé, 12 h, 24 h, 1 an. */
export function emptyForm(): PlanForm {
  return {
    name: '',
    dataTypes: [...DATA_TYPES],
    scope: 'all',
    selection: [],
    rpoHours: 12,
    rtoHours: 24,
    retentionDays: 365,
    justification: '',
  };
}

export function formFromPlan(plan: PlanItem): PlanForm {
  return {
    name: plan.name,
    dataTypes: plan.dataTypes,
    scope: plan.scope,
    selection: plan.selection ?? [],
    rpoHours: plan.rpoHours,
    rtoHours: plan.rtoHours ?? 24,
    retentionDays: plan.retentionDays,
    justification: plan.gdprJustification ?? '',
  };
}

/** Corps de `POST /api/plans` et `PUT /api/plans/:id`. */
export function payloadOf(form: PlanForm) {
  return {
    name: form.name.trim(),
    scope: form.scope,
    dataTypes: form.dataTypes,
    selection: form.scope === 'selection' ? form.selection : [],
    rpoHours: form.rpoHours,
    rtoHours: form.rtoHours,
    retentionDays: form.retentionDays,
    gdprJustification: form.justification.trim(),
  };
}

export type FormErrors = Partial<
  Record<'name' | 'dataTypes' | 'selection' | 'justification', string>
>;

/** Erreurs de l'étape (1 ou 2) ; vide si elle peut être quittée. */
export function validateStep(
  form: PlanForm,
  step: 1 | 2,
  /** Noms déjà pris par d'autres plans (casse et espaces ignorés, comme le serveur). */
  takenNames: readonly string[] = [],
): FormErrors {
  const errors: FormErrors = {};
  if (step === 1) {
    const name = form.name.trim().toLowerCase();
    if (name === '') errors.name = MESSAGES.name;
    else if (takenNames.some((n) => n.trim().toLowerCase() === name)) {
      errors.name = MESSAGES.nameTaken;
    }
    if (form.dataTypes.length === 0) errors.dataTypes = MESSAGES.dataTypes;
    if (form.scope === 'selection' && form.selection.length === 0) {
      errors.selection = MESSAGES.selection;
    }
  } else if (form.justification.trim() === '') {
    errors.justification = MESSAGES.justification;
  }
  return errors;
}

/** Périmètre du plan, en clair. */
function scopeLabel(form: PlanForm): string {
  if (form.scope === 'all') return 'Toute l’organisation';
  const n = form.selection.length;
  if (n === 0) return 'Aucune boîte ou compte choisi';
  return n === 1 ? '1 boîte ou compte choisi' : `${n} boîtes ou comptes choisis`;
}

/** Libellés de l'étape « Objectifs », repris tels quels par le récapitulatif. */
export const OBJECTIVE_LABELS = {
  rpo: 'Perte de données acceptable',
  rto: 'Remise en service souhaitée',
  retention: 'Durée de conservation',
  justification: 'Justification de cette durée',
} as const;

/** Lignes du récapitulatif (dernière étape de création) : libellé et valeur. */
export function recapRows(form: PlanForm): [string, string][] {
  const data = DATA_TYPES.filter((t) => form.dataTypes.includes(t)).map((t) => DATA_TYPE_LABELS[t]);
  return [
    ['Nom du plan', form.name.trim()],
    ['Données', data.length === 0 ? 'Aucune donnée choisie' : data.join(', ')],
    ['Périmètre', scopeLabel(form)],
    [
      OBJECTIVE_LABELS.rpo,
      `${form.rpoHours}${NBSP}h (une sauvegarde toutes les ${form.rpoHours}${NBSP}h)`,
    ],
    [OBJECTIVE_LABELS.rto, `${form.rtoHours}${NBSP}h`],
    [OBJECTIVE_LABELS.retention, retentionLabel(form.retentionDays)],
    [OBJECTIVE_LABELS.justification, form.justification],
  ];
}

/**
 * Périmètre restreint, nommé : l'adresse pour une ou deux boîtes, sinon la première et le nombre
 * des autres. Sans nom connu (catalogue indisponible), seul le nombre est dit.
 */
function selectionLabel(selection: readonly string[] | undefined, mailboxes: readonly Mailbox[]) {
  const ids = selection ?? [];
  const name = (id: string | undefined) => mailboxes.find((m) => m.id === id)?.displayName;
  const first = name(ids[0]);
  if (ids.length === 0) return 'aucune boîte choisie';
  if (first === undefined) {
    return ids.length === 1 ? '1 boîte choisie' : `${ids.length} boîtes choisies`;
  }
  if (ids.length === 1) return first;
  if (ids.length === 2) {
    const second = name(ids[1]);
    return second === undefined ? `${first} et 1 autre` : `${first} et ${second}`;
  }
  return `${first} et ${ids.length - 1} autres`;
}

/** Liste « a, b et c » ; une seule entrée reste telle quelle. */
function enumerate(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1) ?? ''}`;
}

/**
 * Synthèse d'un plan en une ligne pour la liste, avec les termes du récapitulatif de l'assistant :
 * « Messagerie, OneDrive et SharePoint · toute l'organisation · toutes les 12 h · conservés 1 an ».
 */
export function planSummary(
  plan: Pick<PlanItem, 'dataTypes' | 'scope' | 'selection' | 'rpoHours' | 'retentionDays'>,
  mailboxes: readonly Mailbox[] = [],
): string {
  const what = enumerate(
    DATA_TYPES.filter((t) => plan.dataTypes.includes(t)).map((t) => DATA_TYPE_LABELS[t]),
  );
  const where =
    plan.scope === 'all' ? 'toute l’organisation' : selectionLabel(plan.selection, mailboxes);
  return [
    what.charAt(0).toUpperCase() + what.slice(1),
    where,
    `toutes les ${plan.rpoHours}${NBSP}h`,
    `conservés ${retentionLabel(plan.retentionDays)}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

export const rpoHelp = (hours: number): string =>
  `Si un incident survient, vous pouvez perdre au plus ${hours} h de données.`;

export const rtoHelp = (hours: number): string =>
  `Le service doit être rétabli en ${hours} h au plus.`;

export const retentionHelp = (days: number): string =>
  `Les sauvegardes sont supprimées au bout de ${retentionLabel(days)}.`;
