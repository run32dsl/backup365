import {
  DATA_TYPES,
  chargeScope,
  type DataType,
  type PlanScope,
  type RpoHours,
} from '@backup365/core';
import {
  DATA_TYPE_LABELS,
  MESSAGES,
  NBSP,
  hoursLabel,
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
  /**
   * Charges limitées à la sélection ; les autres couvrent tout le tenant (issue #545). Absent :
   * toutes suivent `scope`. `setChargeScope` tient les deux d'accord.
   */
  selectionTypes?: DataType[];
  rpoHours: RpoHours;
  rtoHours: number;
  retentionDays: number;
  justification: string;
}

/** Charges du formulaire limitées à la sélection, dans l'ordre de `DATA_TYPES`. */
export function limitedTypes(form: Pick<PlanForm, 'dataTypes' | 'scope' | 'selectionTypes'>) {
  return DATA_TYPES.filter(
    (t) => form.dataTypes.includes(t) && chargeScope(form, t) === 'selection',
  );
}

/** Change le périmètre d'une charge ; le périmètre du plan suit (sélection si une est limitée). */
export function setChargeScope(
  form: PlanForm,
  type: DataType,
  scope: PlanScope,
): Partial<PlanForm> {
  const others = limitedTypes(form).filter((t) => t !== type);
  const selectionTypes = DATA_TYPES.filter(
    (t) => others.includes(t) || (t === type && scope === 'selection'),
  );
  return { selectionTypes, scope: selectionTypes.length > 0 ? 'selection' : 'all' };
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
    ...(plan.selectionTypes && { selectionTypes: plan.selectionTypes }),
    rpoHours: plan.rpoHours,
    rtoHours: plan.rtoHours ?? 24,
    retentionDays: plan.retentionDays,
    justification: plan.gdprJustification ?? '',
  };
}

/** Corps de `POST /api/plans` et `PUT /api/plans/:id`. */
export function payloadOf(form: PlanForm) {
  const limited = limitedTypes(form);
  return {
    name: form.name.trim(),
    scope: limited.length > 0 ? ('selection' as const) : ('all' as const),
    dataTypes: form.dataTypes,
    selection: limited.length > 0 ? form.selection : [],
    selectionTypes: limited,
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
    if (limitedTypes(form).length > 0 && form.selection.length === 0) {
      errors.selection = MESSAGES.selection;
    }
  } else if (form.justification.trim() === '') {
    errors.justification = MESSAGES.justification;
  }
  return errors;
}

/** « nouveaux comptes et sites compris » selon les charges qui couvrent tout le tenant. */
export function newcomersLabel(types: readonly DataType[]): string {
  const accounts = types.some((t) => t !== 'sharepoint');
  const sites = types.includes('sharepoint');
  return `nouveaux ${[accounts ? 'comptes' : '', sites ? 'sites' : ''].filter(Boolean).join(' et ')} compris`;
}

/** Libellés des charges, « Messagerie et OneDrive ». */
export const chargesLabel = (types: readonly DataType[]): string =>
  enumerate(types.map((t) => DATA_TYPE_LABELS[t]));

/**
 * Périmètre du plan, en clair, charge par charge quand elles diffèrent : « Messagerie : Claire
 * Durand ; OneDrive : toute l'organisation, nouveaux comptes compris ».
 */
function scopeLabel(form: PlanForm, names: readonly Mailbox[]): string {
  const limited = limitedTypes(form);
  const all = DATA_TYPES.filter((t) => form.dataTypes.includes(t) && !limited.includes(t));
  const whole = `toute l’organisation, ${newcomersLabel(all)}`;
  if (limited.length === 0) return whole.charAt(0).toUpperCase() + whole.slice(1);
  const picked = selectionScopeLabel(form, names);
  if (all.length === 0) return picked;
  return `${chargesLabel(limited)} : ${picked} ; ${chargesLabel(all)} : ${whole}`;
}

function selectionScopeLabel(form: PlanForm, names: readonly Mailbox[]): string {
  const n = form.selection.length;
  if (n === 0) return 'Aucune boîte, compte ou site choisi';
  // Les noms connus sont dits tels quels, dans l'ordre du catalogue ; sinon les éléments sont comptés.
  const known = names.filter((m) => form.selection.includes(m.id)).map((m) => m.displayName);
  if (known.length === n) return enumerate(known);
  return n === 1 ? '1 élément choisi' : `${n} éléments choisis`;
}

/** Libellés de l'étape « Objectifs », repris tels quels par le récapitulatif. */
export const OBJECTIVE_LABELS = {
  rpo: 'Perte de données acceptable',
  rto: 'Remise en service souhaitée',
  retention: 'Durée de conservation',
  justification: 'Justification de cette durée',
} as const;

/** Lignes du récapitulatif (dernière étape de création) : libellé et valeur. */
export function recapRows(form: PlanForm, names: readonly Mailbox[] = []): [string, string][] {
  const data = DATA_TYPES.filter((t) => form.dataTypes.includes(t)).map((t) => DATA_TYPE_LABELS[t]);
  return [
    ['Nom du plan', form.name.trim()],
    ['Données', data.length === 0 ? 'Aucune donnée choisie' : data.join(', ')],
    ['Périmètre', scopeLabel(form, names)],
    [
      OBJECTIVE_LABELS.rpo,
      `${hoursLabel(form.rpoHours)} au plus (une sauvegarde toutes les ${hoursLabel(form.rpoHours)})`,
    ],
    [OBJECTIVE_LABELS.rto, `${hoursLabel(form.rtoHours)} au plus`],
    [OBJECTIVE_LABELS.retention, `${retentionLabel(form.retentionDays)}, puis suppression`],
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
  plan: Pick<PlanItem, 'dataTypes' | 'scope' | 'selection' | 'rpoHours' | 'retentionDays'> &
    Partial<Pick<PlanItem, 'selectionTypes'>>,
  mailboxes: readonly Mailbox[] = [],
): string {
  const what = enumerate(
    DATA_TYPES.filter((t) => plan.dataTypes.includes(t)).map((t) => DATA_TYPE_LABELS[t]),
  );
  // Charges mêlées : chaque groupe dit son périmètre (« Messagerie : Claire Durand ; … »).
  const limited = limitedTypes(plan);
  const all = DATA_TYPES.filter((t) => plan.dataTypes.includes(t) && !limited.includes(t));
  const picked = selectionLabel(plan.selection, mailboxes);
  const where =
    limited.length === 0
      ? 'toute l’organisation'
      : all.length === 0
        ? picked
        : `${chargesLabel(limited)} : ${picked} ; ${chargesLabel(all)} : toute l’organisation`;
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
  `Si un incident survient, vous pouvez perdre au plus ${hoursLabel(hours)} de données.`;

export const rtoHelp = (hours: number): string =>
  `Le service doit être rétabli en ${hoursLabel(hours)} au plus.`;

export const retentionHelp = (days: number): string =>
  `Les sauvegardes sont supprimées au bout de ${retentionLabel(days)}.`;
