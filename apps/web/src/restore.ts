import { API_ERRORS } from './apiError.js';
import { REASON } from './RestoreJourney.js';
import { UNREACHABLE } from './session.js';

export type RestoreStatus = 'running' | 'succeeded' | 'failed';

/** Restauration d'un mail telle que l'API la rend : état et durée, jamais de contenu. */
export interface RestoreJob {
  id: string;
  mailboxId: string;
  messageId: string;
  status: RestoreStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  folder: string;
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
}

export type RestoreResult =
  { ok: true; job: RestoreJob } | { ok: false; message: string; requestId?: string };

export const RESTORE_MESSAGES = {
  title: 'Restaurer ce mail',
  reasonError: REASON.error,
  sending: 'Envoi de la demande…',
  running: 'Restauration en cours…',
  runningTitle: 'Restauration en cours',
  keepsRunning: 'Vous pouvez fermer cette fenêtre, elle continue.',
  succeededTitle: 'Restauration réussie',
  failedTitle: 'Restauration échouée',
  untouched: 'Rien n’a été modifié.',
  uncertain:
    'L’état de la boîte est incertain : la restauration a peut-être abouti. Vérifiez le dossier daté avant de réessayer.',
  notAvailable: 'Ce mail n’est plus disponible dans la sauvegarde.',
  forbidden: 'Vous n’avez plus le droit de restaurer.',
  alreadyRunning: 'Une restauration de ce mail est déjà en cours.',
  auditUnavailable: 'Journal d’audit indisponible : restauration refusée.',
  restrictedHelp: 'Réservé aux opérateurs et administrateurs.',
  generic: 'La demande a échoué. Réessayez.',
} as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `Restauré par backup365 jj/mm/aaaa` : même date UTC que le serveur. */
export function restoreFolderName(at: Date): string {
  return `Restauré par backup365 ${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
}

/** `jj/mm/aaaa` d'une date ISO, en UTC. */
export function shortUtcDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Durée en phrase : `18 s`, `1 min 05 s`. Jamais moins d'une seconde. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${pad(seconds % 60)} s`;
}

/** Annonce vocale : au début, puis une fois toutes les 15 s écoulées. */
export function announcement(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 15_000) * 15;
  return seconds === 0
    ? RESTORE_MESSAGES.running
    : `${RESTORE_MESSAGES.running} ${formatDuration(seconds * 1000)}`;
}

/** Cause d'un échec, en une phrase. */
export function failureCause(error: RestoreJob['error']): string {
  if (error === 'restore_unreachable') return 'boîte injoignable pour le moment.';
  if (error === 'restore_lost')
    return 'le suivi de la restauration a été perdu (service redémarré).';
  return 'le service de restauration a signalé une erreur.';
}

/** Vrai si l'appel a pu aboutir malgré l'échec affiché : la boîte n'est alors pas garantie intacte. */
export function isOutcomeUncertain(error: RestoreJob['error']): boolean {
  return error === 'restore_unreachable' || error === 'restore_lost';
}

/** État de la dernière restauration pour la fiche : statut du badge et durée (`18 s`) s'il y en a une. */
export function lastRestoreSummary(
  job: RestoreJob | null,
): { status: 'running' | 'compliant' | 'failed'; label: string; duration: string | null } | null {
  if (!job) return null;
  if (job.status === 'running') return { status: 'running', label: 'En cours', duration: null };
  const duration = job.durationMs === null ? null : formatDuration(job.durationMs);
  return job.status === 'succeeded'
    ? { status: 'compliant', label: 'Réussie', duration }
    : { status: 'failed', label: 'En échec', duration };
}

const SERVER_MESSAGES: Record<string, string> = {
  reason_required: RESTORE_MESSAGES.reasonError,
  mail_not_found: RESTORE_MESSAGES.notAvailable,
  forbidden: RESTORE_MESSAGES.forbidden,
  restore_in_progress: RESTORE_MESSAGES.alreadyRunning,
  audit_unavailable: RESTORE_MESSAGES.auditUnavailable,
};

function restoreUrl(mailboxId: string, messageId: string): string {
  return `/api/mails/${encodeURIComponent(mailboxId)}/${encodeURIComponent(messageId)}/restore`;
}

/** La restauration est-elle configurée (droit d'écriture accordé) ? En cas d'erreur : oui, le serveur tranchera. */
export async function fetchRestoreConfigured(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/restore');
    if (!res.ok) return true;
    return ((await res.json()) as { configured: boolean }).configured;
  } catch {
    return true;
  }
}

/** Dernière restauration du mail, `null` s'il n'y en a pas ; lève si la réponse n'est pas en 2xx. */
export async function fetchLastRestore(
  mailboxId: string,
  messageId: string,
  fetchFn: typeof fetch = fetch,
): Promise<RestoreJob | null> {
  const res = await fetchFn(restoreUrl(mailboxId, messageId));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { last: RestoreJob | null }).last;
}

/** Lance la restauration avec son motif. `message` est en français, sans détail technique. */
export async function startRestore(
  mailboxId: string,
  messageId: string,
  reason: string,
  fetchFn: typeof fetch = fetch,
): Promise<RestoreResult> {
  try {
    const res = await fetchFn(restoreUrl(mailboxId, messageId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === 'string' ? body.error : '';
      const requestId = res.headers.get('x-request-id') ?? undefined;
      return {
        ok: false,
        message: SERVER_MESSAGES[code] ?? API_ERRORS[code] ?? RESTORE_MESSAGES.generic,
        ...(requestId ? { requestId } : {}),
      };
    }
    return { ok: true, job: ((await res.json()) as { job: RestoreJob }).job };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}
