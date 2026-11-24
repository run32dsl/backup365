import {
  DATA_TYPES,
  isNightPlan,
  nextRunAt,
  type ComplianceState,
  type DataType,
  type FailureCause,
  type NoSnapshotReason,
  type PlanScope,
  type RpoHours,
  type RunStatus,
} from '@backup365/core';
import { readFailure, requestError } from './apiError.js';
import { dateTimeOf } from './format.js';
import { UNREACHABLE, type Outcome } from './session.js';
import type { PillStatus } from './ui/index.js';

/**
 * Plan tel que `GET /api/plans` le rend : le plan, sa conformité et sa dernière exécution. Les
 * trois champs optionnels ne sont envoyés qu'à un administrateur : un opérateur ne reçoit ni
 * sélection, ni délai de remise en service, ni justification. Tout code partagé par les deux
 * rôles doit donc s'en passer.
 */
export interface PlanItem {
  id: string;
  name: string;
  scope: PlanScope;
  dataTypes: DataType[];
  selection?: string[];
  rpoHours: RpoHours;
  rtoHours?: number | null;
  retentionDays: number;
  gdprJustification?: string;
  createdAt: string;
  compliance: {
    state: ComplianceState;
    lastSuccessAt: string | null;
    lastRestorePointAt: string | null;
  };
  running: boolean;
  /** Lancement manuel en file derrière la sauvegarde en cours : ni échec, ni exécution. */
  queued?: boolean;
  lastRun: {
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    noSnapshotReason: NoSnapshotReason | null;
    /** Cause de l'échec, d'une liste fermée ; absente si la dernière exécution n'a pas échoué. */
    failureCause?: FailureCause;
  } | null;
}

export interface Mailbox {
  id: string;
  displayName: string;
}

// ---- Libellés -------------------------------------------------------------------------------

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  mail: 'Messagerie',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
};

/** Aide sous « Messagerie » : le SDK ne sépare pas calendrier et contacts de la boîte. */
export const MAIL_HELP = 'avec le calendrier et les contacts';

export const RPO_CHOICES: readonly RpoHours[] = [4, 12, 24];
export const RTO_CHOICES: readonly number[] = [8, 24, 72];
/** Durées de conservation proposées, en jours. */
export const RETENTION_CHOICES: readonly number[] = [180, 365, 1095];

/**
 * Les choix proposés, plus la valeur courante si elle n'en fait pas partie (plan créé par l'API),
 * en ordre croissant.
 */
export function withCurrent(choices: readonly number[], current: number): number[] {
  const all = choices.includes(current) ? [...choices] : [...choices, current];
  return all.sort((a, b) => a - b);
}

export function retentionLabel(days: number): string {
  if (days === 180) return '6\u00a0mois';
  if (days === 365) return '1\u00a0an';
  if (days % 365 === 0) return `${days / 365}\u00a0ans`;
  return `${days}\u00a0jour${days === 1 ? '' : 's'}`;
}

/** Aide et exemple du champ « Justification de cette durée ». */
export const JUSTIFICATION_HELP =
  'Les durées longues doivent rester justifiées au regard du RGPD. N’y saisissez pas de donnée personnelle.';
export const JUSTIFICATION_PLACEHOLDER = 'Obligation légale : courriers 1 an';

export const MESSAGES = {
  loading: 'Chargement des plans…',
  loadError: 'Impossible de charger les plans.',
  forbidden: 'Action réservée aux administrateurs.',
  readOnly: 'Lecture seule : seul un administrateur peut modifier les plans.',
  emptyTitle: 'Aucun plan de protection',
  emptyAdmin: 'Vos données Microsoft 365 ne sont pas protégées.',
  emptyOperator: 'Aucun plan n’a encore été créé par un administrateur.',
  notConfigured: 'Sauvegarde non configurée',
  notConfiguredHelp: 'Connectez d’abord Microsoft 365 pour créer un plan.',
  notConfiguredOperator: 'Demandez à un administrateur de la configurer',
  name: 'Indiquez un nom pour le plan.',
  dataTypes: 'Choisissez au moins un type de données.',
  selection: 'Choisissez au moins une boîte ou un compte.',
  justification: 'Indiquez la justification de la durée de conservation.',
  runReason: 'Indiquez un motif pour continuer.',
  created: 'Plan créé.',
  updated: 'Plan modifié.',
  deleted: 'Plan supprimé.',
  runStarted: 'Sauvegarde lancée. Motif enregistré au journal d’audit.',
  running: 'En cours',
  queued: 'En file d’attente',
  runBusy: 'Sauvegarde déjà en cours',
  runAlreadyQueued: 'Déjà en file d’attente',
} as const;

/** Cause d'un échec en une phrase, sans code ni détail technique. */
export const FAILURE_LABELS: Record<FailureCause, string> = {
  interrupted: 'Sauvegarde interrompue',
  backup_errors: 'Des dossiers n’ont pas pu être sauvegardés',
  no_result: 'Aucune donnée n’a été sauvegardée',
  unknown: 'Cause non précisée',
};

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
export function validateStep(form: PlanForm, step: 1 | 2): FormErrors {
  const errors: FormErrors = {};
  if (step === 1) {
    if (form.name.trim() === '') errors.name = MESSAGES.name;
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
      `${form.rpoHours}\u00a0h (une sauvegarde toutes les ${form.rpoHours}\u00a0h)`,
    ],
    [OBJECTIVE_LABELS.rto, `${form.rtoHours}\u00a0h`],
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
    `toutes les ${plan.rpoHours}\u00a0h`,
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

// ---- Affichage de la liste ------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/** `18:00`, à l'heure locale. */
export const timeOf = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/**
 * État du plan : le libellé court de la charte (celui du tableau de bord) et, si elle apporte
 * plus que la colonne « Dernière exécution », une explication en texte secondaire.
 */
export function complianceView(
  plan: PlanItem,
  runningName?: string,
): {
  status: PillStatus;
  label: string;
  note?: string;
} {
  // Une exécution ou une mise en file prime : le dernier résultat terminé reste lisible dans
  // la colonne « Dernière exécution ».
  if (plan.running) return { status: 'running', label: MESSAGES.running };
  if (plan.queued) {
    return {
      status: 'pending',
      label: MESSAGES.queued,
      ...(runningName && { note: `Démarrera après « ${runningName} »` }),
    };
  }
  const { state, lastSuccessAt, lastRestorePointAt } = plan.compliance;
  if (state === 'compliant') {
    // Réussi, mais sans point de restauration : rien n'a été copié, donc rien n'est protégé
    // (issues #80, #289). Pastille neutre, jamais le vert.
    if (lastRestorePointAt === null) {
      return {
        status: 'pending',
        label: 'En attente',
        note: 'Rien à sauvegarder dans le périmètre : vérifiez la boîte, le compte ou le site choisi.',
      };
    }
    // Une réussite récente, puis un échec : la cause reste dite (le plan est dans « en échec »).
    const failure = plan.lastRun?.failureCause;
    return {
      status: 'compliant',
      label: 'À jour',
      ...(failure && {
        note: `Dernière exécution en échec : ${FAILURE_LABELS[failure].toLowerCase()}`,
      }),
    };
  }
  // Même état que le tableau de bord (`state` du plan), jamais déduit d'ailleurs.
  const base = lateNote(state, lastSuccessAt);
  const cause =
    state === 'failed' && plan.lastRun?.failureCause
      ? FAILURE_LABELS[plan.lastRun.failureCause]
      : undefined;
  const note = [cause, base].filter(Boolean).join(' · ') || undefined;
  return state === 'failed'
    ? { status: 'failed', label: 'En échec', ...(note && { note }) }
    : { status: 'late', label: 'En retard', ...(note && { note }) };
}

/**
 * Ligne secondaire d'un plan en retard ou en échec : partagée par Plans et Sources. `hasBackups` :
 * des sauvegardes de son périmètre existent déjà (Sources les liste) ; le plan n'a alors jamais
 * réussi, mais « aucune sauvegarde » serait faux.
 */
export const lateNote = (
  state: string,
  lastSuccessAt: string | null,
  hasBackups = false,
): string | undefined =>
  lastSuccessAt === null
    ? hasBackups
      ? 'Aucune exécution du plan réussie, sauvegardes déjà présentes'
      : 'Aucune sauvegarde réussie'
    : state === 'late'
      ? 'Dernière sauvegarde plus ancienne que prévu'
      : undefined;

/** Plan « en échec » : conformité en échec ou dernière exécution en échec (règle de l'accueil). */
export const isFailed = (plan: PlanItem): boolean =>
  plan.compliance.state === 'failed' || plan.lastRun?.status === 'failed';

/** Confirmation d'un lancement mis en file : le plan lancé et celui qui le précède. */
export const queuedMessage = (plan: string, running?: string): string =>
  `Sauvegarde de « ${plan} » mise en file : elle démarrera à la fin de ${
    running ? `« ${running} »` : 'la sauvegarde en cours'
  }.`;

/** Message affiché après l'envoi d'un lancement : mis en file (deux plans nommés) ou démarré. */
export function runFlashText(
  queued: boolean,
  plan: string,
  list: readonly PlanItem[] | undefined,
): string {
  if (!queued) return MESSAGES.runStarted;
  return queuedMessage(plan, list?.find((p) => p.running)?.name);
}

/** Dernier résultat terminé en une ligne, même si le plan tourne ou attend son tour. */
export const lastRunLabel = (plan: PlanItem): string =>
  runLabel(plan.lastRun, plan.compliance.lastRestorePointAt === null);

/** Libellé d'une dernière exécution ; `noRestorePoint` : aucun point de restauration n'existe. */
export function runLabel(run: PlanItem['lastRun'] | undefined, noRestorePoint: boolean): string {
  if (!run) return 'Pas encore sauvegardé';
  const at = dateTimeOf(run.finishedAt ?? run.startedAt);
  if (run.status !== 'success') return `Échec, ${at}`;
  // Même constat que la pastille « En attente » : rien copié n'est pas une réussite.
  if (run.noSnapshotReason !== null || noRestorePoint) {
    return `Rien copié, ${at}`;
  }
  return `Réussie, ${at}`;
}

/** Contenu du bandeau d'un plan en échec : titre daté (UTC), cause, conséquence, conduite à tenir. */
export function failureBanner(
  plan: PlanItem,
  admin: boolean,
): { title: string; cause: string; consequence?: string; advice: string } {
  const run = plan.lastRun;
  const at = run?.status === 'failed' ? dateTimeOf(run.finishedAt ?? run.startedAt) : '';
  return {
    title: `Échec de « ${plan.name} »${at && ` le ${at} UTC`}`,
    cause: `${FAILURE_LABELS[run?.failureCause ?? 'unknown']}.`,
    ...(plan.compliance.lastSuccessAt === null && {
      consequence: 'Ces données ne sont pas encore protégées.',
    }),
    advice: `${admin ? 'Relancez' : 'Demandez à un administrateur de relancer'} le plan ; si l’échec se répète, prévenez l’exploitant du serveur.`,
  };
}

/** Message de succès d'une création : l'heure du premier créneau planifié. */
export function createdMessage(plan: { id: string; rpoHours: RpoHours }, now = new Date()): string {
  // Plan de nuit : le créneau suit le fuseau du serveur, que le navigateur ne connaît pas.
  if (isNightPlan(plan.rpoHours))
    return `${MESSAGES.created} Première sauvegarde prévue cette nuit.`;
  return `${MESSAGES.created} Première sauvegarde prévue à ${timeOf(nextRunAt(plan, now))}.`;
}

// ---- Ancres ---------------------------------------------------------------------------------

export const PLANS_HASH = '#/plans';
/** Liste des plans réduite à ceux en échec (bouton « Voir l'erreur » de l'accueil). */
export const FAILED_PLANS_HASH = '#/plans?etat=echec';
export const NEW_PLAN_HASH = '#/plans/nouveau';
export const editHash = (id: string): string => `#/plans/${encodeURIComponent(id)}/modifier`;

export type PlansRoute =
  { page: 'list'; failedOnly?: boolean } | { page: 'new' } | { page: 'edit'; id: string };

/** Écran des plans demandé par l'ancre, ou `null` si l'ancre est autre. */
export function parsePlansHash(hash: string): PlansRoute | null {
  if (hash === PLANS_HASH) return { page: 'list' };
  if (hash === FAILED_PLANS_HASH) return { page: 'list', failedOnly: true };
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
  if (!res.ok) throw requestError(res);
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
      const failure = await readFailure(res, SERVER_MESSAGES);
      return { ok: false, ...failure };
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

export const deletePlan = (id: string, reason: string, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'DELETE', `/api/plans/${encodeURIComponent(id)}`, { reason: reason.trim() });

/** Motif d'un lancement manuel : le même texte libre que partout, refusé s'il est vide. */
export const runReasonError = (reason: string): string | undefined =>
  reason.trim() === '' ? MESSAGES.runReason : undefined;

export const runPlan = (id: string, reason: string, fetchFn: typeof fetch = fetch) =>
  send(
    fetchFn,
    'POST',
    `/api/plans/${encodeURIComponent(id)}/run`,
    { reason: reason.trim() },
    async (r) => ({ queued: ((await r.json()) as { queued?: boolean }).queued === true }),
  );
