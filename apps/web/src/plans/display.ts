import {
  DATA_TYPES,
  effectiveState,
  isNightPlan,
  nextRunAt,
  serviceOfRow,
  type DataType,
  type PlanScope,
  type RpoHours,
  type Service,
  type StatusReport,
} from '@backup365/core';
import { dateTimeOf, plural, quoted, workloadLabel } from '../format.js';
import type { PillStatus } from '../ui/index.js';
import { FAILURE_LABELS, MESSAGES, type Mailbox, type PlanItem } from './model.js';

// ---- Affichage de la liste ------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/** `18:00`, à l'heure locale. */
export const timeOf = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Nom d'un élément hors boîte, dans les notes d'un plan vide. */
const nounOf = (t: DataType): string =>
  t === 'onedrive' ? 'compte OneDrive' : t === 'teams' ? 'équipe Teams' : 'site SharePoint';

/**
 * Note d'un plan qui n'a rien copié, selon son périmètre et ses services : un périmètre choisi
 * nomme l'élément (ou le nombre d'éléments) ; « toute l'organisation » renvoie à la connexion,
 * puisque rien n'y a été choisi.
 */
function emptyNote(
  plan: Pick<PlanItem, 'dataTypes' | 'scope' | 'selection'>,
  mailboxes: readonly Mailbox[],
): string {
  const types = DATA_TYPES.filter((t) => plan.dataTypes.includes(t));
  const mailOnly = types.length === 1 && types[0] === 'mail';
  // Messagerie, contacts et agenda vivent dans une boîte.
  const inMailbox = (t: DataType) => t === 'mail' || t === 'contacts' || t === 'calendar';
  if (plan.scope === 'all') {
    const found = (what: string, feminine: boolean) =>
      `${what} trouvé${feminine ? 'e' : ''} dans l’organisation : vérifiez la connexion Microsoft 365 et ses autorisations.`;
    if (types.every(inMailbox)) return found('Aucune boîte', true);
    if (types.some(inMailbox)) return found('Aucune source', true);
    const nouns = types.map(nounOf);
    return found(`Aucun ${nouns.join(' ni ')}`, false);
  }
  const ids = plan.selection ?? [];
  if (ids.length === 1 && mailOnly) {
    const name = mailboxes.find((m) => m.id === ids[0])?.displayName;
    if (name) {
      return `Rien à sauvegarder dans ${name} : vérifiez que cette boîte existe et contient des mails.`;
    }
  }
  if (mailOnly) {
    return ids.length > 1
      ? `Rien à sauvegarder dans les ${ids.length} boîtes choisies : vérifiez que ces boîtes existent et contiennent des mails.`
      : 'Rien à sauvegarder dans la boîte choisie : vérifiez qu’elle existe et contient des mails.';
  }
  const nouns = [...new Set(types.map((t) => (inMailbox(t) ? 'boîte' : nounOf(t))))].join(', ');
  return ids.length > 1
    ? `Rien à sauvegarder dans les ${ids.length} éléments choisis : vérifiez qu’ils existent (${nouns}) et contiennent des données.`
    : `Rien à sauvegarder dans l’élément choisi : vérifiez qu’il existe (${nouns}) et contient des données.`;
}

/**
 * État du plan : le libellé court de la charte (celui du tableau de bord) et, si elle apporte
 * plus que la colonne « Dernière exécution », une explication en texte secondaire.
 */
export function complianceView(
  plan: PlanItem,
  runningName?: string,
  sources?: SourcesReport | null,
  mailboxes: readonly Mailbox[] = [],
): {
  status: PillStatus;
  label: string;
  note?: string;
  /** Le retard touche plusieurs sources : « Voir les sources » les liste. */
  seeSources?: boolean;
} {
  // Une exécution ou une mise en file prime : le dernier résultat terminé reste lisible dans
  // la colonne « Dernière exécution ».
  if (plan.running) return { status: 'running', label: MESSAGES.running };
  if (plan.queued) {
    return {
      status: 'pending',
      label: MESSAGES.queued,
      ...(runningName && { note: `Démarrera après ${quoted(runningName)}` }),
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
        note: emptyNote(plan, mailboxes),
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
  const fromSources =
    state === 'late' ? lateSourcesNote({ ...plan, lastSuccessAt }, sources) : undefined;
  const base = fromSources?.text ?? lateNote(state, lastSuccessAt);
  const cause =
    state === 'failed' && plan.lastRun?.failureCause
      ? FAILURE_LABELS[plan.lastRun.failureCause]
      : undefined;
  const note = [cause, base].filter(Boolean).join(' · ') || undefined;
  return state === 'failed'
    ? { status: 'failed', label: 'En échec', ...(note && { note }) }
    : {
        status: 'late',
        label: 'En retard',
        ...(note && { note }),
        ...(fromSources?.seeSources && { seeSources: true }),
      };
}

/** Ce que le rapport d'état dit des sources : leurs lignes et le seuil de retard. */
export type SourcesReport = Pick<StatusReport, 'rows' | 'maxAgeHours' | 'generatedAt'>;

/** Le service d'une ligne du catalogue : un site est SharePoint, une équipe Teams (même règle que le serveur). */
export const serviceOf = (r: StatusReport['rows'][number]): Service => serviceOfRow(r);

export const UNIT_NAMES: Record<DataType, string> = {
  mail: 'boîte',
  contacts: 'boîte',
  calendar: 'boîte',
  onedrive: 'compte',
  sharepoint: 'site',
  teams: 'équipe',
};

/**
 * Note d'un plan en retard dont la dernière réussite est récente : le retard vient de sources.
 * Une source est nommée avec sa dernière réussite ; au-delà, le décompte et `seeSources`.
 * `undefined` si la réussite du plan est elle-même trop ancienne (`lateNote` le dit alors) ou si
 * aucune source de ses services n'est en retard.
 */
export function lateSourcesNote(
  plan: {
    dataTypes?: readonly DataType[];
    scope?: PlanScope;
    selection?: readonly string[];
    lastSuccessAt: string | null;
  },
  report: SourcesReport | null | undefined,
): { text: string; seeSources: boolean } | undefined {
  if (!report || plan.lastSuccessAt === null) return undefined;
  const age = Date.parse(report.generatedAt) - Date.parse(plan.lastSuccessAt);
  if (!(age <= report.maxAgeHours * 3_600_000)) return undefined;
  const types = plan.dataTypes ?? [];
  // Un périmètre restreint ne compte que ses sources ; sans la sélection (opérateur), on ne
  // devine pas : la note d'origine reste.
  if (plan.scope === 'selection' && plan.selection === undefined) return undefined;
  const picked = plan.scope === 'selection' ? new Set(plan.selection) : null;
  const own = report.rows.filter(
    (r) =>
      types.includes(serviceOf(r)) &&
      (picked === null || r.kind === 'team' || picked.has(r.sourceId)),
  );
  const late = own.filter((r) => effectiveState(r) !== 'ok');
  const [first] = late;
  if (!first) return undefined;
  const unit = types.length === 1 && types[0] ? UNIT_NAMES[types[0]] : 'source';
  const count = `${plural(late.length, unit)} sur ${own.length} en retard`;
  if (late.length > 1) return { text: count, seeSources: true };
  const at = first.lastSnapshotAt ? dateTimeOf(first.lastSnapshotAt) : '';
  return {
    text: `${count} : ${workloadLabel(first.workload)}, ${first.displayName}${at && `, dernière réussite le ${at} UTC`}`,
    seeSources: false,
  };
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
  `Sauvegarde de ${quoted(plan)} mise en file : elle démarrera à la fin de ${
    running ? quoted(running) : 'la sauvegarde en cours'
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

/**
 * Conséquence d'un échec quand chaque source dont ce plan a échoué a une sauvegarde réussie par un
 * autre plan ; `undefined` sinon (ou sans rapport d'état des sources).
 */
function coveredByOthers(planId: string, sources: SourcesReport | null | undefined) {
  const own = (sources?.rows ?? []).filter((r) => r.failure?.planId === planId);
  const by = own.map((r) => r.failure?.coveredBy);
  if (own.length === 0 || by.some((c) => c === undefined)) return undefined;
  const found = by.flatMap((c) => (c ? [c] : []));
  const names = [...new Set(found.map((c) => quoted(c.plan)))].join(', ');
  const latest = found.map((c) => c.at).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? '';
  return `Ces données restent couvertes par ${names} (dernière réussite ${dateTimeOf(latest)} UTC).`;
}

/** Contenu du bandeau d'un plan en échec : titre daté (UTC), cause, conséquence, conduite à tenir. */
export function failureBanner(
  plan: PlanItem,
  admin: boolean,
  sources?: SourcesReport | null,
): { title: string; cause: string; consequence?: string; advice: string } {
  const run = plan.lastRun;
  const at = run?.status === 'failed' ? dateTimeOf(run.finishedAt ?? run.startedAt) : '';
  return {
    title: `Échec de ${quoted(plan.name)}${at && ` le ${at} UTC`}`,
    cause: `${FAILURE_LABELS[run?.failureCause ?? 'unknown']}.`,
    ...(plan.compliance.lastSuccessAt === null && {
      consequence: coveredByOthers(plan.id, sources) ?? 'Ces données ne sont pas encore protégées.',
    }),
    advice: `${admin ? 'Relancez' : 'Demandez à un administrateur de relancer'} le plan ; si l’échec se répète, prévenez l’exploitant du serveur.`,
  };
}

/** Bandeau au-dessus d'un formulaire en erreur : le nombre de points, sans les répéter. */
export const errorSummary = (count: number): string =>
  `${count} ${count === 1 ? 'point' : 'points'} à corriger avant de continuer`;

/** Message de succès d'une création : l'heure du premier créneau planifié. */
export function createdMessage(
  plan: { id: string; name: string; rpoHours: RpoHours },
  now = new Date(),
): string {
  const head = `Le plan ${quoted(plan.name)} a été créé.`;
  // Plan de nuit : le créneau suit le fuseau du serveur, que le navigateur ne connaît pas.
  if (isNightPlan(plan.rpoHours)) return `${head} Première sauvegarde prévue cette nuit.`;
  return `${head} Première sauvegarde prévue à ${timeOf(nextRunAt(plan, now))}.`;
}
