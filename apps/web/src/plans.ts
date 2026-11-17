import {
  DATA_TYPES,
  nextRunAt,
  type ComplianceState,
  type DataType,
  type NoSnapshotReason,
  type PlanScope,
  type RpoHours,
  type RunStatus,
} from '@backup365/core';
import { UNREACHABLE, type Outcome } from './session.js';
import type { PillStatus } from './ui/index.js';

/** Plan tel que `GET /api/plans` le rend : le plan, sa conformité et sa dernière exécution. */
export interface PlanItem {
  id: string;
  name: string;
  scope: PlanScope;
  dataTypes: DataType[];
  selection: string[];
  rpoHours: RpoHours;
  rtoHours: number | null;
  retentionDays: number;
  gdprJustification: string;
  createdAt: string;
  compliance: {
    state: ComplianceState;
    lastSuccessAt: string | null;
    lastRestorePointAt: string | null;
  };
  running: boolean;
  lastRun: {
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    noSnapshotReason: NoSnapshotReason | null;
  } | null;
}

export interface Mailbox {
  id: string;
  displayName: string;
}

// ---- Libellés -------------------------------------------------------------------------------

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  mail: 'Messagerie',
  files: 'Fichiers',
  calendar: 'Calendriers',
  contacts: 'Contacts',
};

/** Complément du nom dans la phrase du récapitulatif (« vos mails, fichiers… »). */
const DATA_TYPE_PHRASES: Record<DataType, string> = {
  mail: 'mails',
  files: 'fichiers',
  calendar: 'calendriers',
  contacts: 'contacts',
};

export const RPO_CHOICES: readonly RpoHours[] = [12, 4, 24];
export const RTO_CHOICES: readonly number[] = [24, 8, 72];
/** Durées de conservation proposées, en jours. */
export const RETENTION_CHOICES: readonly number[] = [365, 1095, 180];

/** Les choix proposés, plus la valeur courante si elle n'en fait pas partie (plan créé par l'API). */
export function withCurrent(choices: readonly number[], current: number): number[] {
  return choices.includes(current) ? [...choices] : [...choices, current];
}

export function retentionLabel(days: number): string {
  if (days === 180) return '6 mois';
  if (days === 365) return '1 an';
  if (days % 365 === 0) return `${days / 365} ans`;
  return `${days} jours`;
}

export const REASON_CHOICES = [
  { value: 'legal', label: 'Obligation légale' },
  { value: 'business', label: 'Besoin métier' },
  { value: 'public', label: 'Intérêt public' },
  { value: 'other', label: 'Autre (préciser)' },
] as const;
export type ReasonKind = (typeof REASON_CHOICES)[number]['value'];

export const RUN_REASONS = [
  'Contrôle de conformité',
  'Avant une opération de maintenance',
  'Après un incident',
  'Autre (préciser)',
] as const;

export const MESSAGES = {
  loading: 'Chargement des plans…',
  loadError: 'Impossible de charger les plans.',
  forbidden: 'Action réservée aux administrateurs.',
  readOnly: 'Lecture seule : seul un administrateur peut modifier les plans.',
  emptyTitle: 'Aucun plan de protection',
  emptyAdmin: 'Vos données Microsoft 365 ne sont pas protégées.',
  emptyOperator: 'Aucun plan n’a encore été créé par un administrateur.',
  notConfigured: 'Sauvegarde non configurée',
  notConfiguredHelp: 'Connectez d’abord votre tenant Microsoft 365 pour créer un plan.',
  notConfiguredOperator: 'Demandez à un administrateur de la configurer',
  name: 'Indiquez un nom pour le plan.',
  dataTypes: 'Choisissez au moins un type de données.',
  selection: 'Choisissez au moins une boîte ou un compte.',
  justification: 'Indiquez la justification de la durée de conservation.',
  runReason: 'Indiquez un motif.',
  created: 'Plan créé.',
  updated: 'Plan modifié.',
  deleted: 'Plan supprimé.',
  runStarted: 'Sauvegarde lancée. Motif enregistré au journal d’audit.',
  auditTrail:
    'Toute consultation, export ou restauration demandera un motif et sera inscrit au journal d’audit.',
} as const;

// ---- Formulaire -----------------------------------------------------------------------------

export interface PlanForm {
  name: string;
  dataTypes: DataType[];
  scope: PlanScope;
  selection: string[];
  rpoHours: RpoHours;
  rtoHours: number;
  retentionDays: number;
  reasonKind: ReasonKind | '';
  reasonDetail: string;
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
    reasonKind: '',
    reasonDetail: '',
  };
}

/** Texte enregistré : le motif choisi, suivi de la précision s'il y en a une. */
export function justificationText(kind: ReasonKind, detail: string): string {
  const label = REASON_CHOICES.find((c) => c.value === kind)?.label ?? '';
  const base = kind === 'other' ? 'Autre' : label;
  const extra = detail.trim();
  return extra === '' ? base : `${base} : ${extra}`;
}

/** Relit le texte enregistré ; un texte d'une autre origine devient « Autre » avec lui pour précision. */
export function parseJustification(text: string): { kind: ReasonKind; detail: string } {
  for (const c of REASON_CHOICES) {
    const base = c.value === 'other' ? 'Autre' : c.label;
    if (text === base) return { kind: c.value, detail: '' };
    if (text.startsWith(`${base} : `))
      return { kind: c.value, detail: text.slice(base.length + 3) };
  }
  return { kind: 'other', detail: text };
}

export function formFromPlan(plan: PlanItem): PlanForm {
  const reason = parseJustification(plan.gdprJustification);
  return {
    name: plan.name,
    dataTypes: plan.dataTypes,
    scope: plan.scope,
    selection: plan.selection,
    rpoHours: plan.rpoHours,
    rtoHours: plan.rtoHours ?? 24,
    retentionDays: plan.retentionDays,
    reasonKind: reason.kind,
    reasonDetail: reason.detail,
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
    gdprJustification: justificationText(form.reasonKind || 'other', form.reasonDetail),
  };
}

export type FormErrors = Partial<
  Record<'name' | 'dataTypes' | 'selection' | 'justification', string>
>;

/** Erreurs de l'étape (1 ou 2) ; vide si elle peut être quittée. */
export function validateStep(form: PlanForm, step: 1 | 2): FormErrors {
  const errors: FormErrors = {};
  if (step === 1) {
    if (form.name.trim() === '') errors.name = MESSAGES.name;
    if (form.dataTypes.length === 0) errors.dataTypes = MESSAGES.dataTypes;
    if (form.scope === 'selection' && form.selection.length === 0) {
      errors.selection = MESSAGES.selection;
    }
  } else if (
    form.reasonKind === '' ||
    (form.reasonKind === 'other' && form.reasonDetail.trim() === '')
  ) {
    errors.justification = MESSAGES.justification;
  }
  return errors;
}

/** Liste « a, b et c » ; une seule entrée reste telle quelle. */
function enumerate(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1) ?? ''}`;
}

/** Phrase du récapitulatif, en langage clair. */
export function summarySentence(form: PlanForm): string {
  const what = enumerate(
    DATA_TYPES.filter((t) => form.dataTypes.includes(t)).map((t) => DATA_TYPE_PHRASES[t]),
  );
  const where =
    form.scope === 'all'
      ? 'de toute l’organisation'
      : form.selection.length === 1
        ? 'd’une boîte ou d’un compte choisi'
        : `de ${form.selection.length} boîtes ou comptes choisis`;
  return `Vos ${what} ${where} seront sauvegardés toutes les ${form.rpoHours} h et conservés ${retentionLabel(form.retentionDays)}.`;
}

export const rtoSentence = (hours: number): string =>
  `En cas de sinistre, la remise en service est visée sous ${hours} h.`;

export const rpoHelp = (hours: number): string =>
  `Si un incident survient, vous pouvez perdre au plus ${hours} h de données.`;

// ---- Affichage de la liste ------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/** `14/11 06:00`, à l'heure locale. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `18:00`, à l'heure locale. */
export const timeOf = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Conformité en pastille : jamais la couleur seule (icône et texte dans `StatusPill`). */
export function complianceView(plan: PlanItem): { status: PillStatus; label: string } {
  const { state, lastSuccessAt, lastRestorePointAt } = plan.compliance;
  if (state === 'compliant') {
    // Réussi, mais sans point de restauration : rien n'était à sauvegarder (issue #80).
    const label = lastRestorePointAt === null ? 'Conforme : rien à sauvegarder' : 'Conforme';
    return { status: 'compliant', label };
  }
  if (lastSuccessAt === null) {
    return { status: 'failed', label: 'Non conforme : aucune sauvegarde réussie' };
  }
  return { status: 'late', label: 'À vérifier : RPO dépassé' };
}

/** Dernière exécution en une ligne. */
export function lastRunLabel(plan: PlanItem): string {
  if (plan.running) return 'En cours…';
  const run = plan.lastRun;
  if (!run) return 'Pas encore sauvegardé';
  const at = shortDate(run.finishedAt ?? run.startedAt);
  if (run.status !== 'success') return `Échec, ${at}`;
  const outcome =
    run.noSnapshotReason === 'no_content' ? 'Réussie (rien à sauvegarder)' : 'Réussie';
  return `${outcome}, ${at}`;
}

/** Message de succès d'une création : l'heure du premier créneau planifié. */
export function createdMessage(plan: { id: string; rpoHours: RpoHours }, now = new Date()): string {
  return `${MESSAGES.created} Première sauvegarde prévue à ${timeOf(nextRunAt(plan, now))}.`;
}

// ---- Ancres ---------------------------------------------------------------------------------

export const PLANS_HASH = '#/plans';
export const NEW_PLAN_HASH = '#/plans/nouveau';
export const editHash = (id: string): string => `#/plans/${encodeURIComponent(id)}/modifier`;

export type PlansRoute = { page: 'list' } | { page: 'new' } | { page: 'edit'; id: string };

/** Écran des plans demandé par l'ancre, ou `null` si l'ancre est autre. */
export function parsePlansHash(hash: string): PlansRoute | null {
  if (hash === PLANS_HASH) return { page: 'list' };
  if (hash === NEW_PLAN_HASH) return { page: 'new' };
  const m = /^#\/plans\/([^/]+)\/modifier$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    return { page: 'edit', id: decodeURIComponent(m[1]) };
  } catch {
    return null;
  }
}

// ---- Réseau ---------------------------------------------------------------------------------

/** Liste des plans ; lève si la réponse n'est pas en 2xx. */
export async function fetchPlans(fetchFn: typeof fetch = fetch): Promise<PlanItem[]> {
  const res = await fetchFn('/api/plans');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { items: PlanItem[] }).items;
}

/**
 * Boîtes du catalogue pour le périmètre choisi. `configured: false` quand le stockage n'est pas
 * configuré (503 `catalog_unavailable`) ; toute autre erreur laisse `configured` à `true`.
 */
export async function fetchMailboxes(
  fetchFn: typeof fetch = fetch,
): Promise<{ configured: boolean; mailboxes: Mailbox[] }> {
  try {
    const res = await fetchFn('/api/mailboxes');
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === 'catalog_unavailable') return { configured: false, mailboxes: [] };
    }
    if (!res.ok) return { configured: true, mailboxes: [] };
    const body = (await res.json()) as { mailboxes: Mailbox[] };
    return { configured: true, mailboxes: body.mailboxes };
  } catch {
    return { configured: true, mailboxes: [] };
  }
}

const SERVER_MESSAGES: Record<string, string> = {
  plan_name_taken: 'Ce nom de plan existe déjà.',
  plan_not_found: 'Ce plan n’existe plus.',
  run_in_progress: 'Une sauvegarde est déjà en cours pour ce plan.',
  no_items: 'Ce plan ne couvre aucune boîte : rien à sauvegarder.',
  reason_required: MESSAGES.runReason,
  invalid_plan: 'Le plan n’est pas valide : vérifiez les champs.',
  forbidden: MESSAGES.forbidden,
};

async function send<T>(
  fetchFn: typeof fetch,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  read?: (res: Response) => Promise<T>,
): Promise<Outcome<T>> {
  try {
    const res = await fetchFn(url, {
      method,
      ...(payload
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
        : {}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === 'string' ? body.error : '';
      return {
        ok: false,
        message: SERVER_MESSAGES[code] ?? `Erreur inattendue (HTTP ${res.status}).`,
      };
    }
    return { ok: true, value: (await read?.(res)) as T };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export const createPlan = (form: PlanForm, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'POST', '/api/plans', payloadOf(form), async (r) => (await r.json()) as PlanItem);

export const updatePlan = (id: string, form: PlanForm, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'PUT', `/api/plans/${encodeURIComponent(id)}`, payloadOf(form));

export const deletePlan = (id: string, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'DELETE', `/api/plans/${encodeURIComponent(id)}`);

export const runPlan = (id: string, reason: string, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'POST', `/api/plans/${encodeURIComponent(id)}/run`, { reason: reason.trim() });

/** Motif d'un lancement manuel : le choix, suivi de la précision. */
export function runReasonText(choice: string, detail: string): string {
  const extra = detail.trim();
  const base = choice === 'Autre (préciser)' ? 'Autre' : choice;
  return extra === '' ? base : `${base} : ${extra}`;
}
