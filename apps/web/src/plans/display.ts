import { isNightPlan, nextRunAt, type RpoHours } from '@backup365/core';
import { dateTimeOf } from '../format.js';
import type { PillStatus } from '../ui/index.js';
import { FAILURE_LABELS, MESSAGES, type PlanItem } from './model.js';

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

/** Bandeau au-dessus d'un formulaire en erreur : le nombre de points, sans les répéter. */
export const errorSummary = (count: number): string =>
  `${count} ${count === 1 ? 'point' : 'points'} à corriger avant de continuer`;

/** Message de succès d'une création : l'heure du premier créneau planifié. */
export function createdMessage(
  plan: { id: string; name: string; rpoHours: RpoHours },
  now = new Date(),
): string {
  const head = `Le plan « ${plan.name} » a été créé.`;
  // Plan de nuit : le créneau suit le fuseau du serveur, que le navigateur ne connaît pas.
  if (isNightPlan(plan.rpoHours)) return `${head} Première sauvegarde prévue cette nuit.`;
  return `${head} Première sauvegarde prévue à ${timeOf(nextRunAt(plan, now))}.`;
}
